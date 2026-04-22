from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


DEFAULT_ENV_FILES = (".env.example", ".env.local")


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
    type_tva: str = "TVA_SUR_ENCAISSEMENT"


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


def load_chorus_settings(env_files: Iterable[Path] | None = None) -> ChorusSettings:
    env = load_env_values(env_files)

    vite_base_url = env.get("VITE_CHORUS_API_BASE_URL", "")
    technical_login = env.get("VITE_CHORUS_TECHNICAL_LOGIN", "").strip()
    technical_password = env.get("VITE_CHORUS_TECHNICAL_PASSWORD", "").strip()

    cpro_account = env.get("CHORUS_CPRO_ACCOUNT", "").strip()
    if not cpro_account and technical_login and technical_password:
        cpro_account = build_cpro_account(technical_login, technical_password)

    base_url = normalize_base_url(env.get("CHORUS_BASE_URL", "").strip())
    if not base_url:
        base_url = normalize_base_url(vite_base_url)

    timeout_seconds = float(env.get("CHORUS_TIMEOUT_SECONDS", "30") or "30")

    return ChorusSettings(
        base_url=base_url,
        api_key=env.get("CHORUS_API_KEY", "").strip(),
        cpro_account=cpro_account,
        token_url=env.get("CHORUS_TOKEN_URL", "").strip() or env.get("VITE_CHORUS_TOKEN_URL", "").strip(),
        client_id=env.get("CHORUS_CLIENT_ID", "").strip() or env.get("VITE_CHORUS_CLIENT_ID", "").strip(),
        client_secret=env.get("CHORUS_CLIENT_SECRET", "").strip() or env.get("VITE_CHORUS_CLIENT_SECRET", "").strip(),
        scope=env.get("CHORUS_SCOPE", "").strip() or env.get("VITE_CHORUS_SCOPE", "").strip() or "openid",
        timeout_seconds=timeout_seconds,
        default_supplier_id=read_optional_int(env.get("CHORUS_SUPPLIER_ID")) or read_optional_int(env.get("VITE_CHORUS_SUBMISSION_SUPPLIER_ID")),
        default_code_destinataire=(env.get("CHORUS_DESTINATAIRE_CODE", "").strip() or None),
        default_code_service_executant=(env.get("CHORUS_SERVICE_EXECUTANT_CODE", "").strip() or None),
        default_bank_account_code=read_optional_int(env.get("CHORUS_BANK_ACCOUNT_CODE")) or read_optional_int(env.get("VITE_CHORUS_SUBMISSION_BANK_ACCOUNT_CODE")),
    )
