"""Token manager OAuth2 réutilisable (authorization code) pour les providers.

Contrainte qui justifie ce module : certains providers (notamment **Sage
Accounting**) émettent des access tokens de courte durée (~5 min) et **font
tourner le refresh token à chaque usage** : chaque refresh invalide le
précédent. Deux refresh concurrents cassent donc définitivement la chaîne de
tokens et déconnectent le client.

Parade : le refresh est **sérialisé par clé** (un verrou par tenant/connexion)
avec **double-vérification** après acquisition du verrou. Le stockage des tokens
est délégué à un ``TokenStore`` (l'app fournit une implémentation chiffrée et
persistée ; ``InMemoryTokenStore`` est réservé au dev/tests).

Sécurité : aucun token n'est journalisé ; les erreurs n'exposent pas les
credentials.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol
from urllib.parse import urlencode

import requests

from .base import ProviderAuthError


# ---------------------------------------------------------------------------
# Modèle de token + stockage
# ---------------------------------------------------------------------------
@dataclass
class OAuth2Token:
    access_token: str
    refresh_token: str
    expires_at: float  # epoch (secondes)
    raw: dict[str, Any] = field(default_factory=dict)

    def is_expired(self, *, skew_seconds: float = 30.0, now: float | None = None) -> bool:
        """Vrai si le token est expiré (avec marge de sécurité ``skew_seconds``)."""
        current = time.time() if now is None else now
        return current >= (self.expires_at - skew_seconds)


class TokenStore(Protocol):
    """Persistance des tokens par clé (clé = tenant/connexion provider).

    L'implémentation de production doit chiffrer au repos et être partagée
    entre workers (DB/secret store), sinon le verrou de refresh ne protège que
    le process courant.
    """

    def load(self, key: str) -> Optional[OAuth2Token]: ...

    def save(self, key: str, token: OAuth2Token) -> None: ...


class InMemoryTokenStore:
    """Stockage volatil — **dev/tests uniquement** (ni chiffré, ni persistant)."""

    def __init__(self) -> None:
        self._tokens: dict[str, OAuth2Token] = {}

    def load(self, key: str) -> Optional[OAuth2Token]:
        return self._tokens.get(key)

    def save(self, key: str, token: OAuth2Token) -> None:
        self._tokens[key] = token


# ---------------------------------------------------------------------------
# Configuration OAuth2
# ---------------------------------------------------------------------------
@dataclass
class OAuth2Config:
    authorization_url: str
    token_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scope: str = ""


# ---------------------------------------------------------------------------
# Token manager
# ---------------------------------------------------------------------------
class OAuth2TokenManager:
    """Gère le cycle de vie des tokens OAuth2 avec refresh sérialisé par clé."""

    def __init__(
        self,
        config: OAuth2Config,
        store: TokenStore,
        *,
        session: requests.Session | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._config = config
        self._store = store
        self._session = session or requests.Session()
        self._timeout = timeout
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # --- Verrou par clé ----------------------------------------------------
    def _lock_for(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    # --- Étape 1 : URL de consentement -------------------------------------
    def authorization_url(self, state: str) -> str:
        """Construit l'URL vers laquelle rediriger l'utilisateur (consentement)."""
        params = {
            "response_type": "code",
            "client_id": self._config.client_id,
            "redirect_uri": self._config.redirect_uri,
            "state": state,
        }
        if self._config.scope:
            params["scope"] = self._config.scope
        separator = "&" if "?" in self._config.authorization_url else "?"
        return f"{self._config.authorization_url}{separator}{urlencode(params)}"

    # --- Étape 2 : échange du code -----------------------------------------
    def exchange_code(self, key: str, code: str) -> OAuth2Token:
        """Échange le ``code`` d'autorisation contre des tokens, puis les stocke."""
        token = self._post_token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._config.redirect_uri,
            }
        )
        self._store.save(key, token)
        return token

    # --- Étape 3 : obtenir un access token valide --------------------------
    def get_access_token(self, key: str) -> str:
        """Retourne un access token valide, en rafraîchissant si nécessaire."""
        token = self._store.load(key)
        if token is None:
            raise ProviderAuthError(
                "Aucune connexion OAuth2 pour cette clé : connexion requise.",
            )
        if not token.is_expired():
            return token.access_token
        return self._refresh(key).access_token

    # --- Refresh sérialisé + double-vérification ---------------------------
    def _refresh(self, key: str) -> OAuth2Token:
        lock = self._lock_for(key)
        with lock:
            # Un autre thread a pu rafraîchir pendant l'attente du verrou.
            current = self._store.load(key)
            if current is not None and not current.is_expired():
                return current
            if current is None:
                raise ProviderAuthError("Connexion OAuth2 introuvable au refresh.")

            token = self._post_token(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": current.refresh_token,
                }
            )
            # Sage fait tourner le refresh token : on persiste le nouveau couple.
            self._store.save(key, token)
            return token

    # --- Appel HTTP token endpoint -----------------------------------------
    def _post_token(self, data: dict[str, str]) -> OAuth2Token:
        payload = {
            **data,
            "client_id": self._config.client_id,
            "client_secret": self._config.client_secret,
        }
        try:
            response = self._session.post(
                self._config.token_url,
                data=payload,
                headers={"Accept": "application/json"},
                timeout=self._timeout,
            )
        except requests.RequestException as exc:  # pas de contenu sensible loggé
            raise ProviderAuthError("Échec réseau lors de l'échange OAuth2.") from exc

        if response.status_code >= 400:
            raise ProviderAuthError(
                "Échec de l'échange OAuth2 (code/refresh invalide ou expiré).",
                status_code=response.status_code,
            )

        body = response.json()
        access_token = body.get("access_token")
        refresh_token = body.get("refresh_token") or data.get("refresh_token")
        if not access_token or not refresh_token:
            raise ProviderAuthError("Réponse OAuth2 incomplète (token manquant).")

        expires_in = float(body.get("expires_in", 0) or 0)
        return OAuth2Token(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=time.time() + expires_in,
            raw=body,
        )
