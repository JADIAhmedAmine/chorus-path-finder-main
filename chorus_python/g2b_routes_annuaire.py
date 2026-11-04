"""Routes FastAPI de l'Annuaire G2B (préfixe /api/g2b/annuaire).

Aide à valider le DESTINATAIRE (débiteur) avant dépôt. Partagé par le dépôt de
flux historique (/v1/deposer/flux) et le futur dépôt G2B. Aucun secret renvoyé
au frontend ; token PISTE + cpro-account résolus côté backend.
"""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .auth import require_submit_permission
from .chorus_flux_routes import _resolve_settings_and_token
from .g2b_annuaire_client import (
    G2BAnnuaireError,
    annuaire_healthcheck,
    get_siret,
    validate_recipient,
)
from .g2b_config import load_g2b_settings, load_g2b_supplier_config
from .g2b_diagnostics import build_piste_auth_error

logger = logging.getLogger("g2b_routes_annuaire")

router = APIRouter(prefix="/api/g2b/annuaire", tags=["g2b-annuaire"])


def _json(status: int, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=int(status), content=jsonable_encoder(payload))


class _PisteAuthError(RuntimeError):
    """Échec d'authentification PISTE (config/token) lors d'un appel Annuaire."""


def _annuaire_context() -> tuple[str, str, str]:
    try:
        chorus_settings, token = _resolve_settings_and_token(None)
    except Exception as error:  # noqa: BLE001 - auth/config -> erreur structurée
        raise _PisteAuthError(str(error)) from error
    base_url = load_g2b_settings()["annuaire_base_url"]
    return base_url, token, chorus_settings.cpro_account


@router.get("/health")
async def handle_annuaire_health(_auth_user: dict[str, Any] = Depends(require_submit_permission)) -> JSONResponse:
    try:
        base_url, token, cpro = _annuaire_context()
        health = await annuaire_healthcheck(base_url, token, cpro)
        return _json(HTTPStatus.OK, {"success": True, "available": bool(health.get("available")), "http_status": health.get("http_status")})
    except _PisteAuthError as error:
        logger.debug("Annuaire health auth: %s", error)
        return _json(HTTPStatus.OK, {"success": True, "available": False, "auth_ok": False, "error_code": "PISTE_AUTH_FAILED", "error": "Authentification PISTE échouée."})
    except Exception as error:  # noqa: BLE001
        logger.debug("Annuaire health: %s", error)
        return _json(HTTPStatus.OK, {"success": True, "available": False, "error": str(error)})


@router.get("/siret/{siret}")
async def handle_annuaire_get_siret(siret: str, _auth_user: dict[str, Any] = Depends(require_submit_permission)) -> JSONResponse:
    try:
        base_url, token, cpro = _annuaire_context()
        result = await get_siret(base_url, token, cpro, siret)
    except _PisteAuthError:
        return _json(HTTPStatus.BAD_GATEWAY, build_piste_auth_error("g2b_annuaire"))
    except G2BAnnuaireError as error:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "error": str(error)})
    except Exception as error:  # noqa: BLE001
        return _json(HTTPStatus.BAD_GATEWAY, {"success": False, "error": str(error)})
    return _json(HTTPStatus.OK, {"success": True, "siret": result.get("siret"), "http_status": result.get("http_status"), "raw": result.get("raw")})


@router.post("/validate-recipient")
async def handle_validate_recipient(
    body: dict[str, Any] = Body(default={}),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    siret = (body.get("siret") or "").strip() if isinstance(body, dict) else ""
    if not siret:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le champ siret est obligatoire."})
    service_code = (body.get("serviceCode") or "").strip() or None if isinstance(body, dict) else None
    engagement = (body.get("engagementNumber") or "").strip() or None if isinstance(body, dict) else None
    config = load_g2b_supplier_config()
    try:
        base_url, token, cpro = _annuaire_context()
        result = await validate_recipient(
            base_url, token, cpro, siret,
            service_code=service_code, engagement_number=engagement,
            strict_service_code=bool(config.get("strict_service_code")),
            strict_engagement=bool(config.get("strict_engagement")),
        )
    except _PisteAuthError:
        return _json(HTTPStatus.BAD_GATEWAY, build_piste_auth_error("g2b_annuaire"))
    except G2BAnnuaireError as error:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "error": str(error)})
    except Exception as error:  # noqa: BLE001
        logger.debug("validate-recipient: %s", error)
        return _json(HTTPStatus.BAD_GATEWAY, {"success": False, "error": str(error)})
    return _json(HTTPStatus.OK, result)
