"""Stores providers adossés à PostgreSQL (chiffrés) + fabrique de registre.

- ``SqlAlchemyConnectionStore`` / ``SqlAlchemyTokenStore`` : persistance chiffrée
  (Fernet) des connexions et tokens, par tenant.
- ``build_provider_registry`` : utilise la DB si ``PROVIDERS_ENCRYPTION_KEY`` est
  défini **et** que les tables existent ; sinon retombe sur le bridge ``.env.local``
  (mono-tenant). Robuste : toute erreur DB -> fallback bridge.

Sécurité : secrets/tokens chiffrés au repos ; jamais journalisés.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

from .connections import (
    ConnectionStore,
    EncryptedTokenStore,
    InMemoryConnectionStore,
    ProviderConnection,
    ProviderRegistry,
)
from .crypto import TokenCipher
from .iopole.config import load_iopole_config
from .oauth import InMemoryTokenStore, OAuth2Token, TokenStore

logger = logging.getLogger("providers.db_stores")


# ---------------------------------------------------------------------------
# Stores SQLAlchemy
# ---------------------------------------------------------------------------
class SqlAlchemyConnectionStore(ConnectionStore):
    def __init__(self, cipher: TokenCipher) -> None:
        self._cipher = cipher

    def get(self, tenant_id: str, provider: str) -> Optional[ProviderConnection]:
        from ..db.entities import ProviderConnectionRecord
        from ..db.session import get_session

        with get_session() as session:
            row = session.get(ProviderConnectionRecord, f"{tenant_id}:{provider}")
            if row is None or not row.active:
                return None
            return ProviderConnection(
                tenant_id=row.tenant_id,
                provider=row.provider,
                environment=row.environment,
                customer_id=row.customer_id,
                client_id=row.client_id,
                client_secret=self._cipher.decrypt(row.client_secret_enc),
            )

    def put(self, connection: ProviderConnection) -> None:
        from ..db.entities import ProviderConnectionRecord
        from ..db.session import get_session

        rid = f"{connection.tenant_id}:{connection.provider}"
        enc = self._cipher.encrypt(connection.client_secret)
        with get_session() as session:
            row = session.get(ProviderConnectionRecord, rid)
            if row is None:
                session.add(ProviderConnectionRecord(
                    id=rid,
                    tenant_id=connection.tenant_id,
                    provider=connection.provider,
                    environment=connection.environment,
                    customer_id=connection.customer_id,
                    client_id=connection.client_id,
                    client_secret_enc=enc,
                ))
            else:
                row.environment = connection.environment
                row.customer_id = connection.customer_id
                row.client_id = connection.client_id
                row.client_secret_enc = enc
                row.active = True


class SqlAlchemyTokenStore(TokenStore):
    def __init__(self, cipher: TokenCipher) -> None:
        self._cipher = cipher

    def load(self, key: str) -> Optional[OAuth2Token]:
        from ..db.entities import ProviderTokenRecord
        from ..db.session import get_session

        with get_session() as session:
            row = session.get(ProviderTokenRecord, key)
            if row is None:
                return None
            data = json.loads(self._cipher.decrypt(row.token_enc))
            return OAuth2Token(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", ""),
                expires_at=float(data["expires_at"]),
            )

    def save(self, key: str, token: OAuth2Token) -> None:
        from ..db.entities import ProviderTokenRecord
        from ..db.session import get_session

        enc = self._cipher.encrypt(json.dumps({
            "access_token": token.access_token,
            "refresh_token": token.refresh_token,
            "expires_at": token.expires_at,
        }))
        with get_session() as session:
            row = session.get(ProviderTokenRecord, key)
            if row is None:
                session.add(ProviderTokenRecord(key=key, token_enc=enc))
            else:
                row.token_enc = enc


# ---------------------------------------------------------------------------
# Composition + fabrique
# ---------------------------------------------------------------------------
class _CompositeConnectionStore(ConnectionStore):
    """DB d'abord ; repli sur la connexion ``.env.local`` (tenant par défaut)."""

    def __init__(self, db_store: ConnectionStore, fallback: Optional[ProviderConnection]) -> None:
        self._db = db_store
        self._fallback = fallback

    def get(self, tenant_id: str, provider: str) -> Optional[ProviderConnection]:
        try:
            found = self._db.get(tenant_id, provider)
            if found is not None:
                return found
        except Exception as exc:  # noqa: BLE001
            logger.warning("Lecture connexion DB échouée, fallback bridge: %s", exc)
        fb = self._fallback
        if fb and fb.tenant_id == tenant_id and fb.provider == provider:
            return fb
        return None

    def put(self, connection: ProviderConnection) -> None:
        self._db.put(connection)


def _env_iopole_connection(tenant_id: str) -> Optional[ProviderConnection]:
    cfg = load_iopole_config()
    if cfg.client_id and cfg.client_secret and cfg.customer_id:
        return ProviderConnection(
            tenant_id=tenant_id, provider="iopole", environment=cfg.environment,
            customer_id=cfg.customer_id, client_id=cfg.client_id, client_secret=cfg.client_secret,
        )
    return None


def _db_tables_ready() -> bool:
    try:
        from sqlalchemy import select

        from ..db.entities import ProviderConnectionRecord
        from ..db.session import get_session

        with get_session() as session:
            session.execute(select(ProviderConnectionRecord.id).limit(1))
        return True
    except Exception:  # noqa: BLE001 - DB/migration absente -> bridge
        return False


def build_provider_registry() -> ProviderRegistry:
    default_tenant = (os.getenv("CHORUS_DEFAULT_TENANT_ID") or "default").strip() or "default"
    key = (os.getenv("PROVIDERS_ENCRYPTION_KEY") or "").strip()
    cipher = TokenCipher(key) if key else None
    env_conn = _env_iopole_connection(default_tenant)

    if cipher is not None and _db_tables_ready():
        logger.info("Providers: mode multi-tenant DB (chiffré).")
        connections = _CompositeConnectionStore(SqlAlchemyConnectionStore(cipher), env_conn)
        return ProviderRegistry(connections, SqlAlchemyTokenStore(cipher))

    # Bridge mono-tenant (.env.local)
    logger.info("Providers: mode bridge .env.local (mono-tenant).")
    mem = InMemoryConnectionStore()
    if env_conn is not None:
        mem.put(env_conn)
    token_store: TokenStore = EncryptedTokenStore(cipher) if cipher else InMemoryTokenStore()
    return ProviderRegistry(mem, token_store)


def provision_connection(connection: ProviderConnection) -> None:
    """Écrit (chiffré) une connexion provider en DB. Nécessite la clé + les tables."""
    key = (os.getenv("PROVIDERS_ENCRYPTION_KEY") or "").strip()
    if not key:
        raise RuntimeError("PROVIDERS_ENCRYPTION_KEY requis pour provisionner une connexion.")
    SqlAlchemyConnectionStore(TokenCipher(key)).put(connection)
