"""Configuration Sage Accounting.

Endpoints OAuth2 et API confirmés via le context pack (``context_pack_sage.md``).
Les credentials sont lus dans l'environnement (jamais en dur, jamais côté
navigateur). Une seule base URL couvre tous les pays supportés (dont la France).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..oauth import OAuth2Config

# --- Constantes connues (source : doc Sage / context_pack_sage.md) ----------
SAGE_AUTHORIZATION_URL = "https://www.sageone.com/oauth2/auth/central"
SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token"
SAGE_API_BASE_URL = "https://api.accounting.sage.com/v3.1"
SAGE_SCOPE = "full_access"

# Access token ~5 min ; refresh rotatif. Voir OAuth2TokenManager (verrou refresh).
SAGE_ACCESS_TOKEN_TTL_SECONDS = 300

# Limites (indicatives) : 1 296 000 req/app/jour, 150 simultanées, 429 + backoff.
SAGE_MAX_CONCURRENT_REQUESTS = 150


@dataclass
class SageAccountingConfig:
    client_id: str
    client_secret: str
    redirect_uri: str
    base_url: str = SAGE_API_BASE_URL
    scope: str = SAGE_SCOPE

    def to_oauth2_config(self) -> OAuth2Config:
        return OAuth2Config(
            authorization_url=SAGE_AUTHORIZATION_URL,
            token_url=SAGE_TOKEN_URL,
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            scope=self.scope,
        )


def _env(env: dict[str, str], *names: str, default: str = "") -> str:
    for name in names:
        value = env.get(name)
        if value:
            return value.strip()
    return default


def load_sage_config(env: dict[str, str] | None = None) -> SageAccountingConfig:
    """Charge la configuration Sage depuis l'environnement.

    Variables attendues dans ``.env.local`` :
        SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, SAGE_REDIRECT_URI
        SAGE_API_BASE_URL (optionnel)
    """
    if env is None:
        try:
            from dotenv import load_dotenv

            load_dotenv(dotenv_path=Path(__file__).resolve().parents[3] / ".env.local")
        except Exception:  # noqa: BLE001 - dotenv optionnel
            pass
        env = dict(os.environ)

    return SageAccountingConfig(
        client_id=_env(env, "SAGE_CLIENT_ID"),
        client_secret=_env(env, "SAGE_CLIENT_SECRET"),
        redirect_uri=_env(env, "SAGE_REDIRECT_URI"),
        base_url=_env(env, "SAGE_API_BASE_URL", default=SAGE_API_BASE_URL),
        scope=_env(env, "SAGE_SCOPE", default=SAGE_SCOPE),
    )
