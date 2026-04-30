from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


DEFAULT_ENV_FILES = (".env.local",)
FIXED_SUPPLIER_ID = 26359578

CHORUS_ENV_QUALIF = "qualif"
CHORUS_ENV_PROD = "prod"

CHORUS_ENV_PRESETS: dict[str, dict[str, str]] = {
    CHORUS_ENV_QUALIF: {
        "base_url": "https://sandbox-api.piste.gouv.fr/cpro",
        "token_url": "https://sandbox-oauth.piste.gouv.fr/api/oauth/token",
        "api_base_url": "https://sandbox-api.piste.gouv.fr/cpro/factures",
        "user_account_path": "https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte",
        "user_connections_path": "https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements",
    },
    CHORUS_ENV_PROD: {
        "base_url": "https://api.piste.gouv.fr/cpro",
        "token_url": "https://oauth.piste.gouv.fr/api/oauth/token",
        "api_base_url": "https://api.piste.gouv.fr/cpro/factures",
        "user_account_path": "https://chorus-pro.gouv.fr:5443/service/utilisateurs/consulter/compte",
        "user_connections_path": "https://chorus-pro.gouv.fr:5443/service/utilisateurs/monCompte/recuperer/rattachements",
    },
}


def resolve_chorus_environment(env: dict[str, str]) -> str:
    raw = (env.get("CHORUS_ENV") or env.get("VITE_CHORUS_ENV") or CHORUS_ENV_QUALIF).strip().lower()
    return CHORUS_ENV_PROD if raw == CHORUS_ENV_PROD else CHORUS_ENV_QUALIF


def chorus_env_preset(env: dict[str, str]) -> dict[str, str]:
    return CHORUS_ENV_PRESETS[resolve_chorus_environment(env)]


def env_credential(
    env: dict[str, str],
    environment: str,
    suffix: str,
    *,
    default: str = "",
    include_vite_fallback: bool = True,
) -> str:
    """Read an env-scoped credential with fallback to the unsuffixed variable."""
    upper_env = environment.upper()
    candidates = [f"CHORUS_{upper_env}_{suffix}"]
    if include_vite_fallback:
        candidates.append(f"VITE_CHORUS_{upper_env}_{suffix}")
    candidates.append(f"CHORUS_{suffix}")
    if include_vite_fallback:
        candidates.append(f"VITE_CHORUS_{suffix}")

    for key in candidates:
        value = (env.get(key) or "").strip()
        if value:
            return value
    return default


def parse_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        normalized_value = value.strip()
        if (
            normalized_value.startswith(("'", '"'))
            and normalized_value.endswith(("'", '"'))
            and len(normalized_value) >= 2
        ):
            normalized_value = normalized_value[1:-1]

        env[key.strip()] = normalized_value

    return env


def read_optional_int(value: str | None) -> int | None:
    if value is None:
        return None

    stripped = value.strip()
    if not stripped:
        return None

    try:
        return int(stripped)
    except ValueError:
        return None


def build_cpro_account(login: str, password: str) -> str:
    raw_value = f"{login}:{password}".encode("utf-8")
    return base64.b64encode(raw_value).decode("ascii")


def normalize_base_url(raw_url: str) -> str:
    normalized = raw_url.strip().rstrip("/")
    if not normalized:
        return ""

    normalized = re.sub(r"/cpro/(factures|transverses)(?:/.*)?$", "/cpro", normalized)
    return normalized


@dataclass(slots=True)
class ChorusFixedValues:
    # Minimal fixed values required for the current SAISIE_API flow.
    code_cadre_facturation: str = "A1_FACTURE_FOURNISSEUR"
    mode_depot: str = "SAISIE_API"
    devise_facture: str = "EUR"
    mode_paiement: str = "VIREMENT"
    type_facture: str = "FACTURE"
    type_tva: str = "TVA_SUR_DEBIT"


@dataclass(slots=True)
class ChorusSettings:
    base_url: str
    api_key: str
    cpro_account: str
    token_url: str = ""
    client_id: str = ""
    client_secret: str = ""
    scope: str = "openid"
    timeout_seconds: float = 30.0
    fixed: ChorusFixedValues = field(default_factory=ChorusFixedValues)
    default_supplier_id: int | None = None
    default_code_destinataire: str | None = None
    default_code_service_executant: str | None = None
    default_bank_account_code: int | None = None

    def authorization_header(self) -> str:
        token = self.api_key.strip()
        if token.lower().startswith("bearer "):
            return token
        return f"Bearer {token}"

    def validate_for_api_access(self) -> None:
        missing: list[str] = []
        if not self.base_url:
            missing.append("CHORUS_BASE_URL")
        if not self.cpro_account:
            missing.append("CHORUS_CPRO_ACCOUNT")
        has_api_key = bool(self.api_key)
        has_oauth_credentials = bool(self.token_url and self.client_id and self.client_secret)
        if not has_api_key and not has_oauth_credentials:
            missing.append("CHORUS_API_KEY or CHORUS_TOKEN_URL/CHORUS_CLIENT_ID/CHORUS_CLIENT_SECRET")

        if missing:
            joined = ", ".join(missing)
            raise ValueError(f"Configuration Chorus incomplète: {joined}")


def load_env_values(env_files: Iterable[Path] | None = None) -> dict[str, str]:
    merged: dict[str, str] = {}
    env_paths = tuple(env_files) if env_files is not None else tuple(Path.cwd() / name for name in DEFAULT_ENV_FILES)
    for path in env_paths:
        merged.update(parse_env_file(path))

    for key, value in os.environ.items():
        merged[key] = value

    return merged


def load_chorus_settings(
    env_files: Iterable[Path] | None = None,
    *,
    environment_override: str | None = None,
) -> ChorusSettings:
    env = load_env_values(env_files)
    if environment_override is not None:
        forced = environment_override.strip().lower()
        if forced in CHORUS_ENV_PRESETS:
            env["CHORUS_ENV"] = forced
    environment = resolve_chorus_environment(env)
    preset = CHORUS_ENV_PRESETS[environment]

    technical_login = env_credential(env, environment, "TECHNICAL_LOGIN")
    technical_password = env_credential(env, environment, "TECHNICAL_PASSWORD")

    cpro_account = env_credential(env, environment, "CPRO_ACCOUNT", include_vite_fallback=False)
    if not cpro_account and technical_login and technical_password:
        cpro_account = build_cpro_account(technical_login, technical_password)

    raw_base_url = env_credential(env, environment, "BASE_URL", include_vite_fallback=False)
    base_url = normalize_base_url(raw_base_url)
    if not base_url:
        base_url = normalize_base_url(env.get("VITE_CHORUS_API_BASE_URL", "")) or preset["base_url"]

    token_url = env_credential(env, environment, "TOKEN_URL") or preset["token_url"]

    timeout_seconds = float(env.get("CHORUS_TIMEOUT_SECONDS", "30") or "30")

    upper_env = environment.upper()
    supplier_id = (
        read_optional_int(env.get(f"CHORUS_{upper_env}_SUPPLIER_ID"))
        or read_optional_int(env.get(f"VITE_CHORUS_{upper_env}_SUBMISSION_SUPPLIER_ID"))
        or read_optional_int(env.get("CHORUS_SUPPLIER_ID"))
    )

    bank_account_code = (
        read_optional_int(env_credential(env, environment, "BANK_ACCOUNT_CODE", include_vite_fallback=False))
        or read_optional_int(env_credential(env, environment, "SUBMISSION_BANK_ACCOUNT_CODE"))
    )

    return ChorusSettings(
        base_url=base_url,
        api_key=env_credential(env, environment, "API_KEY", include_vite_fallback=False),
        cpro_account=cpro_account,
        token_url=token_url,
        client_id=env_credential(env, environment, "CLIENT_ID"),
        client_secret=env_credential(env, environment, "CLIENT_SECRET"),
        scope=env_credential(env, environment, "SCOPE", default="openid"),
        timeout_seconds=timeout_seconds,
        default_supplier_id=supplier_id,
        default_code_destinataire=(env_credential(env, environment, "DESTINATAIRE_CODE", include_vite_fallback=False) or None),
        default_code_service_executant=(env_credential(env, environment, "SERVICE_EXECUTANT_CODE", include_vite_fallback=False) or None),
        default_bank_account_code=bank_account_code,
    )
