"""Configuration Iopole (PDP / Plateforme Agréée).

Auth machine-to-machine : ``clientId`` + ``clientSecret`` (depuis l'écran sandbox)
-> token Bearer via **Keycloak** (flow OAuth2 client_credentials). Le ``CustomerId``
est transmis dans le header ``customer-id``.

URLs confirmées via l'OpenAPI public ``…/v1/api/operator/invoicing`` :
- token PPD : ``https://auth.preprod.iopole.fr/realms/iopole/protocol/openid-connect/token``
- host API PPD : ``https://api.ppd.iopole.fr`` ; host API prod : ``https://api.iopole.com``

Sécurité : credentials lus côté serveur uniquement (jamais ``VITE_*``).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

IOPOLE_ENV_PPD = "ppd"
IOPOLE_ENV_PROD = "prod"

# Hosts API (confirmés).
IOPOLE_PPD_HOST = "https://api.ppd.iopole.fr"
IOPOLE_PROD_HOST = "https://api.iopole.com"

# Token endpoints Keycloak. PPD confirmé ; prod par analogie -> TODO(confirmer).
IOPOLE_PPD_TOKEN_URL = "https://auth.preprod.iopole.fr/realms/iopole/protocol/openid-connect/token"
IOPOLE_PROD_TOKEN_URL = "https://auth.iopole.com/realms/iopole/protocol/openid-connect/token"

# Montages des services operator (préfixes de chemin).
IOPOLE_INVOICING_MOUNT = "/v1/api/operator/invoicing"
IOPOLE_REPORTING_MOUNT = "/v1/api/operator/reporting"


@dataclass
class IopoleConfig:
    client_id: str
    client_secret: str
    customer_id: str
    token_url: str
    host: str = IOPOLE_PPD_HOST
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
        IOPOLE_CLIENT_ID, IOPOLE_CLIENT_SECRET, IOPOLE_CUSTOMER_ID
        IOPOLE_ENV (ppd|prod, défaut ppd)
        IOPOLE_TOKEN_URL, IOPOLE_HOST (optionnels : défauts selon l'env)
    """
    if env is None:
        try:
            from dotenv import load_dotenv

            load_dotenv(dotenv_path=Path(__file__).resolve().parents[3] / ".env.local")
        except Exception:  # noqa: BLE001 - dotenv optionnel
            pass
        env = dict(os.environ)

    environment = _env(env, "IOPOLE_ENV", default=IOPOLE_ENV_PPD).lower()
    is_prod = environment == IOPOLE_ENV_PROD
    default_host = IOPOLE_PROD_HOST if is_prod else IOPOLE_PPD_HOST
    default_token = IOPOLE_PROD_TOKEN_URL if is_prod else IOPOLE_PPD_TOKEN_URL

    return IopoleConfig(
        client_id=_env(env, "IOPOLE_CLIENT_ID"),
        client_secret=_env(env, "IOPOLE_CLIENT_SECRET"),
        customer_id=_env(env, "IOPOLE_CUSTOMER_ID"),
        token_url=_env(env, "IOPOLE_TOKEN_URL", default=default_token),
        host=_env(env, "IOPOLE_HOST", default=default_host),
        environment=environment,
    )
