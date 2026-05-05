from __future__ import annotations

import os
import time
from typing import Any, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel


JWT_ALGORITHM = "HS256"
DEFAULT_TTL_SECONDS = 12 * 60 * 60  # 12h
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


def _ensure_auth_configured() -> None:
    missing = [
        name
        for name, value in (
            ("APP_AUTH_EMAIL", _expected_email()),
            ("APP_AUTH_PASSWORD_HASH", _expected_password_hash()),
            ("APP_AUTH_JWT_SECRET", _env("APP_AUTH_JWT_SECRET")),
        )
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"Authentification non configurée: {', '.join(missing)} manquant(s).",
        )


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


def _issue_token(email: str) -> dict[str, Any]:
    now = int(time.time())
    ttl = _ttl_seconds()
    payload = {"sub": email, "iat": now, "exp": now + ttl}
    token = jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)
    return {"access_token": token, "token_type": "Bearer", "expires_in": ttl, "email": email}


class LoginRequest(BaseModel):
    email: str
    password: str


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest = Body(...)) -> JSONResponse:
    _ensure_auth_configured()
    expected_email = _expected_email()
    expected_hash = _expected_password_hash()

    submitted_email = body.email.strip().lower()
    if not submitted_email:
        raise HTTPException(status_code=422, detail="Email requis.")

    if submitted_email != expected_email or not _verify_password(body.password, expected_hash):
        raise HTTPException(status_code=401, detail="Email ou mot de passe invalide.")

    return JSONResponse(content=_issue_token(submitted_email))


@router.get("/me")
def me(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    return {"email": require_auth(authorization)}


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
    if not isinstance(email, str) or email.lower() != _expected_email():
        raise HTTPException(status_code=401, detail="Token rejeté.")
    return email


def require_auth(authorization: Optional[str] = Header(default=None)) -> str:
    """FastAPI dependency: validates Authorization header and returns the user email."""
    _ensure_auth_configured()
    return require_authenticated_email(authorization)
