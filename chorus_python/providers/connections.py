"""Couche multi-tenant : connexions providers + coffre de tokens chiffré.

Fondation SaaS : chaque tenant possède sa **connexion** à un provider (ex. son
``customer-id`` Iopole + ses credentials), isolée des autres. Les tokens et
secrets sont **chiffrés au repos** (``TokenCipher``) et **scopés par tenant**
(clé de token = ``"<tenant_id>:<provider>"``), pour qu'aucun tenant ne puisse
accéder au contexte d'un autre.

Modèle Iopole : *opérateur (toi) → customers (tes tenants)*. Le mapping
``tenant_id ↔ customer-id Iopole`` vit dans ``ProviderConnection``.

Les backends de persistance sont injectables : implémentations en mémoire ici
(dev/tests), à remplacer par des tables PostgreSQL (chiffrées) en production.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional, Protocol

from .base import ProviderAuthError
from .crypto import TokenCipher
from .iopole.config import (
    IOPOLE_ENV_PROD,
    IOPOLE_PPD_HOST,
    IOPOLE_PPD_TOKEN_URL,
    IOPOLE_PROD_HOST,
    IOPOLE_PROD_TOKEN_URL,
    IopoleConfig,
)
from .iopole.provider import IopolePdpProvider
from .oauth import OAuth2Config, OAuth2Token, OAuth2TokenManager, TokenStore


# ---------------------------------------------------------------------------
# Connexion provider d'un tenant
# ---------------------------------------------------------------------------
@dataclass
class ProviderConnection:
    tenant_id: str
    provider: str  # ex. "iopole"
    environment: str  # "ppd" | "prod"
    customer_id: str  # côté Iopole : le customer-id du tenant
    client_id: str
    client_secret: str  # en clair en mémoire ; persisté chiffré par le ConnectionStore


class ConnectionStore(Protocol):
    """Persistance des connexions providers (à chiffrer en base en production)."""

    def get(self, tenant_id: str, provider: str) -> Optional[ProviderConnection]: ...

    def put(self, connection: ProviderConnection) -> None: ...


class InMemoryConnectionStore:
    """Stockage volatil — dev/tests uniquement."""

    def __init__(self) -> None:
        self._data: dict[tuple[str, str], ProviderConnection] = {}

    def get(self, tenant_id: str, provider: str) -> Optional[ProviderConnection]:
        return self._data.get((tenant_id, provider))

    def put(self, connection: ProviderConnection) -> None:
        self._data[(connection.tenant_id, connection.provider)] = connection


# ---------------------------------------------------------------------------
# Coffre de tokens chiffré (implémente TokenStore)
# ---------------------------------------------------------------------------
class EncryptedTokenStore(TokenStore):
    """Persiste les ``OAuth2Token`` **chiffrés au repos**, par clé.

    Le backend est un simple ``dict`` clé->ciphertext (en mémoire par défaut ;
    à remplacer par une table PostgreSQL partagée entre workers en production —
    indispensable pour que le verrou de refresh protège réellement).
    """

    def __init__(self, cipher: TokenCipher, backend: Optional[dict[str, str]] = None) -> None:
        self._cipher = cipher
        self._backend: dict[str, str] = backend if backend is not None else {}

    def load(self, key: str) -> Optional[OAuth2Token]:
        blob = self._backend.get(key)
        if not blob:
            return None
        data = json.loads(self._cipher.decrypt(blob))
        return OAuth2Token(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", ""),
            expires_at=float(data["expires_at"]),
        )

    def save(self, key: str, token: OAuth2Token) -> None:
        payload = json.dumps(
            {
                "access_token": token.access_token,
                "refresh_token": token.refresh_token,
                "expires_at": token.expires_at,
            }
        )
        self._backend[key] = self._cipher.encrypt(payload)


# ---------------------------------------------------------------------------
# Registre : construit un provider scopé pour un tenant
# ---------------------------------------------------------------------------
class ProviderRegistry:
    """Fabrique des providers **isolés par tenant** à partir des connexions."""

    def __init__(self, connections: ConnectionStore, token_store: TokenStore) -> None:
        self._connections = connections
        self._tokens = token_store

    @staticmethod
    def _connection_key(tenant_id: str, provider: str) -> str:
        # Isolation : la clé de token est scopée au tenant + provider.
        return f"{tenant_id}:{provider}"

    def iopole_for(self, tenant_id: str) -> IopolePdpProvider:
        conn = self._connections.get(tenant_id, "iopole")
        if conn is None:
            raise ProviderAuthError(
                f"Aucune connexion Iopole pour le tenant {tenant_id!r} : onboarding requis.",
                provider="iopole",
            )
        is_prod = conn.environment == IOPOLE_ENV_PROD
        token_url = IOPOLE_PROD_TOKEN_URL if is_prod else IOPOLE_PPD_TOKEN_URL
        host = IOPOLE_PROD_HOST if is_prod else IOPOLE_PPD_HOST

        cfg = IopoleConfig(
            client_id=conn.client_id,
            client_secret=conn.client_secret,
            customer_id=conn.customer_id,
            token_url=token_url,
            host=host,
            environment=conn.environment,
        )
        oauth = OAuth2Config(
            authorization_url="",
            token_url=token_url,
            client_id=conn.client_id,
            client_secret=conn.client_secret,
            redirect_uri="",
        )
        manager = OAuth2TokenManager(oauth, self._tokens)
        return IopolePdpProvider(
            cfg, manager, connection_key=self._connection_key(tenant_id, "iopole")
        )
