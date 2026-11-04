from __future__ import annotations

import os
import json
import hmac
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Body, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from chorus_python.audit import read_audit_events


JWT_ALGORITHM = "HS256"
DEFAULT_TTL_SECONDS = 12 * 60 * 60  # 12h
DEFAULT_USERS_FILE = "config/auth-users.json"
VALID_ROLES = {"DEPOSANT", "GESTIONNAIRE", "ADMINISTRATEUR", "AUDITEUR"}
SUBMIT_ROLES = {"DEPOSANT", "GESTIONNAIRE", "ADMINISTRATEUR"}
ROLE_ALIASES = {
    "PASSAGER": "AUDITEUR",
    "INVITE": "AUDITEUR",
    "INVITÉ": "AUDITEUR",
    "LECTEUR": "AUDITEUR",
}
REPO_ROOT = Path(__file__).resolve().parents[1]
_ENV_FILES_LOADED = False


def _env(name: str, default: str = "") -> str:
    global _ENV_FILES_LOADED
    if not _ENV_FILES_LOADED:
        load_dotenv(".env.local", override=False)
        load_dotenv(".env", override=False)
        _ENV_FILES_LOADED = True
    return (os.environ.get(name) or default).strip()


def _jwt_secret() -> str:
    secret = _env("APP_AUTH_JWT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=500,
            detail="APP_AUTH_JWT_SECRET non défini côté serveur.",
        )
    return secret


def _expected_email() -> str:
    return _env("APP_AUTH_EMAIL").lower()


def _expected_password_hash() -> str:
    return _env("APP_AUTH_PASSWORD_HASH")


def _users_file_path() -> Path:
    configured_path = _env("APP_AUTH_USERS_FILE", DEFAULT_USERS_FILE)
    path = Path(configured_path)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def _as_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "oui", "on"}:
            return True
        if normalized in {"false", "0", "no", "non", "off"}:
            return False
    return default


def _as_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_role(value: Any) -> str:
    role = _as_text(value).upper() or "GESTIONNAIRE"
    role = ROLE_ALIASES.get(role, role)
    if role not in VALID_ROLES:
        raise HTTPException(
            status_code=503,
            detail=f"Rôle utilisateur invalide dans la configuration auth: {role}.",
        )
    return role


def _split_display_name(name: str) -> tuple[str, str]:
    parts = [part for part in name.strip().split(" ") if part]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _normalize_user(raw_user: dict[str, Any], index: int) -> dict[str, Any]:
    email = (
        _as_text(raw_user.get("email"))
        or _as_text(raw_user.get("mail"))
        or _as_text(raw_user.get("username"))
    ).lower()
    if not email:
        raise HTTPException(
            status_code=503,
            detail=f"Utilisateur auth #{index + 1}: email manquant.",
        )

    display_name = _as_text(raw_user.get("name")) or _as_text(raw_user.get("displayName"))
    split_first_name, split_last_name = _split_display_name(display_name)
    first_name = (
        _as_text(raw_user.get("firstName"))
        or _as_text(raw_user.get("first_name"))
        or _as_text(raw_user.get("prenom"))
        or _as_text(raw_user.get("givenName"))
        or split_first_name
        or email.split("@", 1)[0]
    )
    last_name = (
        _as_text(raw_user.get("lastName"))
        or _as_text(raw_user.get("last_name"))
        or _as_text(raw_user.get("nom"))
        or _as_text(raw_user.get("familyName"))
        or split_last_name
    )
    password_hash = (
        _as_text(raw_user.get("passwordHash"))
        or _as_text(raw_user.get("password_hash"))
        or _as_text(raw_user.get("bcryptHash"))
    )
    password = (
        _as_text(raw_user.get("password"))
        or _as_text(raw_user.get("motDePasse"))
        or _as_text(raw_user.get("mdp"))
    )
    if not password_hash and not password:
        raise HTTPException(
            status_code=503,
            detail=f"Utilisateur auth {email}: passwordHash manquant.",
        )

    return {
        "id": _as_text(raw_user.get("id")) or email,
        "tenantId": _as_text(raw_user.get("tenantId")) or _as_text(raw_user.get("tenant_id")),
        "email": email,
        "firstName": first_name,
        "lastName": last_name,
        "roleCode": _normalize_role(raw_user.get("roleCode") or raw_user.get("role")),
        "active": _as_bool(raw_user.get("active"), True),
        "passwordHash": password_hash,
        "password": password,
        "chorusCurrentUserId": _as_text(raw_user.get("chorusCurrentUserId")),
        "chorusSupplierId": _as_text(raw_user.get("chorusSupplierId")),
        "chorusSupplierServiceId": _as_text(raw_user.get("chorusSupplierServiceId")),
        "chorusBankAccountCode": _as_text(raw_user.get("chorusBankAccountCode")),
        "createdAt": _as_text(raw_user.get("createdAt")) or "1970-01-01T00:00:00Z",
        "updatedAt": _as_text(raw_user.get("updatedAt")) or "1970-01-01T00:00:00Z",
    }


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in user.items()
        if key not in {"password", "passwordHash"}
    }


def _load_users_from_file(path: Path) -> list[dict[str, Any]]:
    try:
        raw_config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=503, detail=f"Fichier auth JSON invalide: {path}") from error
    except OSError as error:
        raise HTTPException(status_code=503, detail=f"Fichier auth illisible: {path}") from error

    raw_users = raw_config.get("users") if isinstance(raw_config, dict) else raw_config
    if not isinstance(raw_users, list) or not raw_users:
        raise HTTPException(status_code=503, detail=f"Fichier auth sans utilisateurs: {path}")

    users = []
    seen_emails = set()
    for index, raw_user in enumerate(raw_users):
        if not isinstance(raw_user, dict):
            raise HTTPException(status_code=503, detail=f"Utilisateur auth #{index + 1}: objet JSON attendu.")
        user = _normalize_user(raw_user, index)
        if user["email"] in seen_emails:
            raise HTTPException(status_code=503, detail=f"Email auth dupliqué: {user['email']}.")
        seen_emails.add(user["email"])
        users.append(user)
    return users


def _read_users_file_config() -> tuple[Path, dict[str, Any], list[dict[str, Any]]]:
    path = _users_file_path()
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"Fichier auth introuvable: {path}")

    try:
        raw_config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=503, detail=f"Fichier auth JSON invalide: {path}") from error
    except OSError as error:
        raise HTTPException(status_code=503, detail=f"Fichier auth illisible: {path}") from error

    if isinstance(raw_config, dict):
        raw_users = raw_config.get("users")
        if not isinstance(raw_users, list):
            raise HTTPException(status_code=503, detail=f"Fichier auth sans utilisateurs: {path}")
        return path, raw_config, raw_users

    if isinstance(raw_config, list):
        return path, {"users": raw_config}, raw_config

    raise HTTPException(status_code=503, detail=f"Fichier auth JSON invalide: {path}")


def _write_users_file_config(path: Path, config: dict[str, Any]) -> None:
    serialized = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary_path.write_text(serialized, encoding="utf-8")
        temporary_path.replace(path)
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Impossible d'écrire le fichier auth: {path}") from error


def _load_env_user() -> dict[str, Any]:
    missing = [
        name
        for name, value in (
            ("APP_AUTH_EMAIL", _expected_email()),
            ("APP_AUTH_PASSWORD_HASH", _expected_password_hash()),
        )
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"Authentification non configurée: {', '.join(missing)} manquant(s).",
        )
    return _normalize_user(
        {
            "email": _expected_email(),
            "firstName": "Admin",
            "lastName": "Chorus",
            "roleCode": "ADMINISTRATEUR",
            "passwordHash": _expected_password_hash(),
        },
        0,
    )


def _load_auth_users() -> list[dict[str, Any]]:
    users_file = _users_file_path()
    if users_file.exists():
        return _load_users_from_file(users_file)
    if _env("APP_AUTH_USERS_FILE"):
        raise HTTPException(status_code=503, detail=f"Fichier auth introuvable: {users_file}")
    return [_load_env_user()]


def _find_user_by_email(email: str) -> dict[str, Any] | None:
    normalized_email = email.strip().lower()
    return next((user for user in _load_auth_users() if user["email"] == normalized_email), None)


def _ensure_auth_configured() -> None:
    if not _env("APP_AUTH_JWT_SECRET"):
        raise HTTPException(
            status_code=503,
            detail="Authentification non configurée: APP_AUTH_JWT_SECRET manquant.",
        )
    _load_auth_users()


def _ttl_seconds() -> int:
    raw = _env("APP_AUTH_TOKEN_TTL_SECONDS", str(DEFAULT_TTL_SECONDS))
    try:
        value = int(raw)
        return value if value > 0 else DEFAULT_TTL_SECONDS
    except ValueError:
        return DEFAULT_TTL_SECONDS


def _verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _verify_user_password(plain: str, user: dict[str, Any]) -> bool:
    password_hash = _as_text(user.get("passwordHash"))
    if password_hash:
        return _verify_password(plain, password_hash)

    configured_password = _as_text(user.get("password"))
    return bool(plain and configured_password and hmac.compare_digest(plain, configured_password))


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _issue_token(user: dict[str, Any]) -> dict[str, Any]:
    now = int(time.time())
    ttl = _ttl_seconds()
    public_user = _public_user(user)
    payload = {
        "sub": public_user["email"],
        "role": public_user["roleCode"],
        "iat": now,
        "exp": now + ttl,
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": ttl,
        **public_user,
    }


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest = Body(...)) -> JSONResponse:
    _ensure_auth_configured()
    submitted_email = body.email.strip().lower()
    if not submitted_email:
        raise HTTPException(status_code=422, detail="Email requis.")

    user = _find_user_by_email(submitted_email)
    if not user or not user.get("active") or not _verify_user_password(body.password, user):
        raise HTTPException(status_code=401, detail="Email ou mot de passe invalide.")

    return JSONResponse(content=_issue_token(user))


@router.get("/me")
def me(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    return get_current_auth_user(authorization)


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest = Body(...),
    authorization: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    user = get_current_auth_user(authorization)
    current_user = _find_user_by_email(user["email"])
    if not current_user or not _verify_user_password(body.currentPassword, current_user):
        raise HTTPException(status_code=401, detail="Mot de passe actuel invalide.")

    new_password = body.newPassword.strip()
    if len(new_password) < 10:
        raise HTTPException(status_code=422, detail="Le nouveau mot de passe doit contenir au moins 10 caractères.")
    if _verify_user_password(new_password, current_user):
        raise HTTPException(status_code=422, detail="Le nouveau mot de passe doit être différent de l'ancien.")

    path, config, raw_users = _read_users_file_config()
    normalized_email = user["email"].lower()
    updated = False
    for raw_user in raw_users:
        if not isinstance(raw_user, dict):
            continue
        raw_email = (
            _as_text(raw_user.get("email"))
            or _as_text(raw_user.get("mail"))
            or _as_text(raw_user.get("username"))
        ).lower()
        if raw_email != normalized_email:
            continue
        raw_user["passwordHash"] = _hash_password(new_password)
        raw_user.pop("password", None)
        raw_user.pop("motDePasse", None)
        raw_user.pop("mdp", None)
        raw_user["updatedAt"] = _now_iso()
        updated = True
        break

    if not updated:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable dans le fichier auth.")

    _write_users_file_config(path, config)
    return {"ok": True, "message": "Mot de passe mis à jour."}


@router.get("/audit-log")
def audit_log(
    authorization: Optional[str] = Header(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    email: str | None = Query(default=None),
    action: str | None = Query(default=None),
) -> dict[str, Any]:
    require_admin(authorization)
    events = read_audit_events(email=email, action=action, limit=limit)
    return {"items": events}


def require_authenticated_email(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Token manquant.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token vide.")
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as error:
        raise HTTPException(status_code=401, detail="Token expiré.") from error
    except jwt.InvalidTokenError as error:
        raise HTTPException(status_code=401, detail="Token invalide.") from error

    email = payload.get("sub")
    if not isinstance(email, str):
        raise HTTPException(status_code=401, detail="Token rejeté.")
    user = _find_user_by_email(email)
    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="Token rejeté.")
    return user["email"]


def require_auth(authorization: Optional[str] = Header(default=None)) -> str:
    """FastAPI dependency: validates Authorization header and returns the user email."""
    _ensure_auth_configured()
    return require_authenticated_email(authorization)


def get_current_auth_user(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """FastAPI dependency: validates Authorization header and returns public user metadata."""
    email = require_auth(authorization)
    user = _find_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Token rejeté.")
    return _public_user(user)


def require_submit_permission(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """FastAPI dependency: validates that the authenticated user may submit invoices."""
    user = get_current_auth_user(authorization)
    if user.get("roleCode") not in SUBMIT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Votre compte est en consultation seule et ne peut pas soumettre de factures.",
        )
    return user


def require_admin(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    user = get_current_auth_user(authorization)
    if user.get("roleCode") != "ADMINISTRATEUR":
        raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs.")
    return user
