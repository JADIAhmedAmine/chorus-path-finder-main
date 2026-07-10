"""Stockage serveur des identifiants techniques PISTE / Chorus Pro saisis via l'UI.

Les valeurs sont conservées dans un fichier JSON hors du navigateur
(`config/chorus-credentials.json` par défaut, permissions 600) et prennent le
pas sur les variables d'environnement lors de `load_chorus_settings()`.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CREDENTIALS_FILE = str(REPO_ROOT / "config" / "chorus-credentials.json")

CREDENTIAL_ENVIRONMENTS = ("qualif", "prod")
# Champ JSON -> suffixe de variable d'environnement CHORUS_{ENV}_{SUFFIX}
CREDENTIAL_FIELDS = {
    "clientId": "CLIENT_ID",
    "clientSecret": "CLIENT_SECRET",
    "technicalLogin": "TECHNICAL_LOGIN",
    "technicalPassword": "TECHNICAL_PASSWORD",
}


def credentials_file_path() -> Path:
    configured = (os.environ.get("APP_CHORUS_CREDENTIALS_FILE") or "").strip()
    return Path(configured) if configured else Path(DEFAULT_CREDENTIALS_FILE)


def load_stored_credentials() -> dict[str, dict[str, str]]:
    path = credentials_file_path()
    if not path.exists():
        return {}

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        logger.warning("Fichier credentials Chorus illisible (%s): %s", path, error)
        return {}

    if not isinstance(raw, dict):
        return {}

    credentials: dict[str, dict[str, str]] = {}
    for environment in CREDENTIAL_ENVIRONMENTS:
        block = raw.get(environment)
        if not isinstance(block, dict):
            continue
        cleaned = {
            field: block[field].strip()
            for field in CREDENTIAL_FIELDS
            if isinstance(block.get(field), str) and block[field].strip()
        }
        if cleaned:
            credentials[environment] = cleaned
    return credentials


def save_stored_credentials(credentials: dict[str, dict[str, str]]) -> None:
    path = credentials_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(credentials, ensure_ascii=False, indent=2) + "\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(payload)


def update_stored_credentials(
    environment: str,
    values: dict[str, str],
    *,
    clear: bool = False,
) -> dict[str, dict[str, str]]:
    """Met à jour un environnement; les champs vides laissent la valeur en place."""
    if environment not in CREDENTIAL_ENVIRONMENTS:
        raise ValueError(f"Environnement Chorus inconnu: {environment}")

    credentials = load_stored_credentials()
    block = {} if clear else dict(credentials.get(environment, {}))
    for field in CREDENTIAL_FIELDS:
        value = (values.get(field) or "").strip()
        if value:
            block[field] = value

    if block:
        credentials[environment] = block
    else:
        credentials.pop(environment, None)

    save_stored_credentials(credentials)
    return credentials


def stored_credentials_env_overlay() -> dict[str, str]:
    """Convertit les credentials stockés en clés env `CHORUS_{ENV}_*`.

    Appliqué après `load_env_values()`, ce qui donne la priorité aux valeurs
    saisies dans l'interface sur celles des variables d'environnement.
    """
    overlay: dict[str, str] = {}
    for environment, block in load_stored_credentials().items():
        upper_env = environment.upper()
        for field, suffix in CREDENTIAL_FIELDS.items():
            value = block.get(field, "")
            if value:
                overlay[f"CHORUS_{upper_env}_{suffix}"] = value

        login = block.get("technicalLogin", "")
        password = block.get("technicalPassword", "")
        if login and password:
            encoded = base64.b64encode(f"{login}:{password}".encode("utf-8")).decode("ascii")
            overlay[f"CHORUS_{upper_env}_CPRO_ACCOUNT"] = encoded
    return overlay
