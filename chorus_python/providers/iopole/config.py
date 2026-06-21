"""Configuration Iopole (PDP / Plateforme Agréée).

Auth machine-to-machine : ``clientId`` + ``clientSecret`` (obtenus via
support@iopole.com) -> token Bearer (flow OAuth2 client_credentials).

Deux environnements : PPD (pré-prod / sandbox) et production. Les URLs de base
sont confirmées via la doc Iopole ; le ``token_url`` exact reste à confirmer
(TODO(api-doc-mapper)) et est donc lu dans l'environnement.

Sécurité : credentials lus côté serveur uniquement (jamais ``VITE_*``).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Base URLs (source : doc/onboarding Iopole).
IOPOLE_PPD_BASE_URL = "https://api.ppd.iopole.fr/v1"   # pré-prod / sandbox
IOPOLE_PROD_BASE_URL = "https://api.iopole.com/v1"     # production

IOPOLE_ENV_PPD = "ppd"
IOPOLE_ENV_PROD = "prod"


@dataclass
class IopoleConfig:
    client_id: str
    client_secret: str
    token_url: str
    base_url: str = IOPOLE_PPD_BASE_URL
    environment: str = IOPOLE_ENV_PPD


def _env(env: dict[str, str], *names: str, default: str = "") -> str:
    for name in names:
        value = env.get(name)
        if value:
            return value.strip()
    return default


def load_iopole_config(env: dict[str, str] | None = None) -> IopoleConfig:
    """Charge la configuration Iopole depuis l'environnement.

    Variables attendues dans ``.env.local`` :
        IOPOLE_CLIENT_ID, IOPOLE_CLIENT_SECRET, IOPOLE_TOKEN_URL
        IOPOLE_ENV (ppd|prod, défaut ppd), IOPOLE_BASE_URL (optionnel)
    """
    if env is None:
        try:
            from dotenv import load_dotenv

            load_dotenv(dotenv_path=Path(__file__).resolve().parents[3] / ".env.local")
        except Exception:  # noqa: BLE001 - dotenv optionnel
            pass
        env = dict(os.environ)

    environment = _env(env, "IOPOLE_ENV", default=IOPOLE_ENV_PPD).lower()
    default_base = IOPOLE_PROD_BASE_URL if environment == IOPOLE_ENV_PROD else IOPOLE_PPD_BASE_URL

    return IopoleConfig(
        client_id=_env(env, "IOPOLE_CLIENT_ID"),
        client_secret=_env(env, "IOPOLE_CLIENT_SECRET"),
        token_url=_env(env, "IOPOLE_TOKEN_URL"),  # TODO(api-doc-mapper): figer l'URL exacte
        base_url=_env(env, "IOPOLE_BASE_URL", default=default_base),
        environment=environment,
    )
