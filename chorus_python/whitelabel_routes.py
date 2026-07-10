"""Routes marque blanche : branding (nom, logo, couleur) et identifiants techniques.

- `GET /api/branding` et `GET /api/branding/logo` sont publics (nécessaires sur
  l'écran de connexion, avant authentification).
- Les routes `/api/admin/*` sont réservées au rôle ADMINISTRATEUR.
- Les secrets PISTE / compte technique Chorus Pro ne sont jamais renvoyés au
  navigateur : l'API n'expose que leur statut (configuré ou non, et la source).
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .auth import require_admin
from .config import env_credential, load_env_values
from .credentials_store import (
    CREDENTIAL_ENVIRONMENTS,
    CREDENTIAL_FIELDS,
    load_stored_credentials,
    update_stored_credentials,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["whitelabel"])

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BRANDING_FILE = str(REPO_ROOT / "config" / "branding.json")

DEFAULT_BRANDING = {
    "appName": "Chorus Pilot",
    "appTagline": "Automatisation des factures Chorus Pro",
    "primaryColor": "",
}

MAX_APP_NAME_LENGTH = 80
MAX_TAGLINE_LENGTH = 160
HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

LOGO_BASENAME = "branding-logo"
LOGO_MEDIA_TYPES = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}
MAX_LOGO_BYTES = 2 * 1024 * 1024


def branding_file_path() -> Path:
    configured = (os.environ.get("APP_BRANDING_FILE") or "").strip()
    return Path(configured) if configured else Path(DEFAULT_BRANDING_FILE)


def _logo_candidates() -> list[Path]:
    directory = branding_file_path().parent
    return [directory / f"{LOGO_BASENAME}{extension}" for extension in LOGO_MEDIA_TYPES]


def find_logo_file() -> Path | None:
    for candidate in _logo_candidates():
        if candidate.exists():
            return candidate
    return None


def load_branding() -> dict[str, str]:
    branding = dict(DEFAULT_BRANDING)
    path = branding_file_path()
    if not path.exists():
        return branding

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        logger.warning("Fichier branding illisible (%s): %s", path, error)
        return branding

    if isinstance(raw, dict):
        for key in branding:
            value = raw.get(key)
            if isinstance(value, str):
                branding[key] = value.strip()
    if not branding["appName"]:
        branding["appName"] = DEFAULT_BRANDING["appName"]
    return branding


def save_branding(branding: dict[str, str]) -> None:
    path = branding_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(branding, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def branding_public_payload() -> dict[str, Any]:
    branding = load_branding()
    logo = find_logo_file()
    logo_url = None
    if logo is not None:
        logo_url = f"/api/branding/logo?v={int(logo.stat().st_mtime)}"
    return {
        "appName": branding["appName"],
        "appTagline": branding["appTagline"],
        "primaryColor": branding["primaryColor"],
        "logoUrl": logo_url,
    }


@router.get("/branding")
def get_branding() -> dict[str, Any]:
    return branding_public_payload()


@router.get("/branding/logo")
def get_branding_logo() -> FileResponse:
    logo = find_logo_file()
    if logo is None:
        raise HTTPException(status_code=404, detail="Aucun logo personnalisé.")
    return FileResponse(
        logo,
        media_type=LOGO_MEDIA_TYPES[logo.suffix.lower()],
        headers={
            # Neutralise tout script embarqué (cas des SVG) si le fichier est ouvert directement.
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            "Cache-Control": "public, max-age=300",
        },
    )


@router.put("/admin/branding", dependencies=[Depends(require_admin)])
def update_branding(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    branding = load_branding()

    app_name = payload.get("appName")
    if isinstance(app_name, str):
        app_name = app_name.strip()
        if not app_name:
            raise HTTPException(status_code=422, detail="Le nom de l'application ne peut pas être vide.")
        if len(app_name) > MAX_APP_NAME_LENGTH:
            raise HTTPException(status_code=422, detail=f"Nom d'application trop long (max {MAX_APP_NAME_LENGTH} caractères).")
        branding["appName"] = app_name

    tagline = payload.get("appTagline")
    if isinstance(tagline, str):
        if len(tagline.strip()) > MAX_TAGLINE_LENGTH:
            raise HTTPException(status_code=422, detail=f"Slogan trop long (max {MAX_TAGLINE_LENGTH} caractères).")
        branding["appTagline"] = tagline.strip()

    primary_color = payload.get("primaryColor")
    if isinstance(primary_color, str):
        primary_color = primary_color.strip()
        if primary_color and not HEX_COLOR_PATTERN.match(primary_color):
            raise HTTPException(status_code=422, detail="Couleur invalide: format attendu #RRGGBB.")
        branding["primaryColor"] = primary_color.lower()

    save_branding(branding)
    return branding_public_payload()


@router.post("/admin/branding/logo", dependencies=[Depends(require_admin)])
async def upload_branding_logo(file: UploadFile = File(...)) -> dict[str, Any]:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in LOGO_MEDIA_TYPES:
        allowed = ", ".join(sorted(LOGO_MEDIA_TYPES))
        raise HTTPException(status_code=422, detail=f"Format de logo non supporté ({allowed}).")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Fichier logo vide.")
    if len(content) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=422, detail="Logo trop volumineux (max 2 Mo).")

    directory = branding_file_path().parent
    directory.mkdir(parents=True, exist_ok=True)
    for candidate in _logo_candidates():
        if candidate.exists():
            candidate.unlink()
    (directory / f"{LOGO_BASENAME}{extension}").write_bytes(content)
    return branding_public_payload()


@router.delete("/admin/branding/logo", dependencies=[Depends(require_admin)])
def delete_branding_logo() -> dict[str, Any]:
    for candidate in _logo_candidates():
        if candidate.exists():
            candidate.unlink()
    return branding_public_payload()


def credentials_status_payload() -> dict[str, Any]:
    stored = load_stored_credentials()
    env = load_env_values()
    environments: dict[str, dict[str, str]] = {}
    for environment in CREDENTIAL_ENVIRONMENTS:
        block = stored.get(environment, {})
        fields: dict[str, str] = {}
        for field, suffix in CREDENTIAL_FIELDS.items():
            if block.get(field):
                fields[field] = "file"
            elif env_credential(env, environment, suffix):
                fields[field] = "env"
            else:
                fields[field] = "missing"
        environments[environment] = fields
    return {"environments": environments}


@router.get("/admin/chorus-credentials", dependencies=[Depends(require_admin)])
def get_chorus_credentials_status() -> dict[str, Any]:
    return credentials_status_payload()


@router.put("/admin/chorus-credentials", dependencies=[Depends(require_admin)])
def update_chorus_credentials(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    environment = str(payload.get("environment") or "").strip().lower()
    if environment not in CREDENTIAL_ENVIRONMENTS:
        raise HTTPException(status_code=422, detail="Environnement attendu: qualif ou prod.")

    values = {
        field: value
        for field in CREDENTIAL_FIELDS
        if isinstance((value := payload.get(field)), str)
    }
    clear = bool(payload.get("clear"))
    if not clear and not any(value.strip() for value in values.values()):
        raise HTTPException(status_code=422, detail="Aucun identifiant fourni.")

    update_stored_credentials(environment, values, clear=clear)
    return credentials_status_payload()
