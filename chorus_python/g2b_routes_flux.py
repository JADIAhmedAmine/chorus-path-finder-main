"""Routes FastAPI du module G2B « Dépôt Flux » (préfixe /api/g2b).

Additif et isolé : ne touche ni `/api/chorus/submit`, ni le dépôt de flux
historique. Réutilise la logique OAuth/cpro-account existante, le détecteur de
fichier et le validateur métier. Aucun secret renvoyé au frontend ; pas de
journalisation du contenu, du token ou du cpro-account.
"""

from __future__ import annotations

import hashlib
import logging
import time
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .auth import require_submit_permission
from .chorus_flux_business_validator import validate_flux_business_rules
from .chorus_flux_detector import detect_flux_file, file_extension as _file_extension
from .chorus_flux_routes import _resolve_settings_and_token, _safe_append_flux_audit
from .g2b_config import KNOWN_CODE_INTERFACES, load_g2b_settings, load_g2b_supplier_config
from .g2b_error_explainer import explain_g2b_error
from .g2b_flux_client import (
    G2BFluxError,
    deposit_g2b_flux,
    g2b_flux_healthcheck,
    get_g2b_flux_status,
    poll_g2b_flux_status,
)
from .g2b_recommendation import build_g2b_recommendation, recommend_g2b_code_interface

logger = logging.getLogger("g2b_routes_flux")

router = APIRouter(prefix="/api/g2b", tags=["g2b"])

G2B_ALLOWED_EXTENSIONS = frozenset({".xml", ".pdf"})

# Garde-doublon en mémoire (best-effort) : (sha256, codeInterface) -> timestamp.
_RECENT_SUBMISSIONS: dict[tuple[str, str], float] = {}
_DUPLICATE_TTL_SECONDS = 600.0


def _json(status: int, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=int(status), content=jsonable_encoder(payload))


def _detected_public(detected: dict[str, Any]) -> dict[str, Any]:
    return {
        "fileType": detected.get("detected_file_type"),
        "rootElement": detected.get("root_element") or detected.get("embedded_xml_root"),
        "namespace": detected.get("namespace") or detected.get("embedded_xml_namespace"),
        "isDepositCompatible": bool(detected.get("is_deposit_compatible")),
    }


def _business_public(business: dict[str, Any]) -> dict[str, Any]:
    ex = business.get("extracted", {})
    return {
        "severity": business.get("severity"),
        "valid": business.get("valid"),
        "errors": [_issue_public(i) for i in business.get("errors", [])],
        "warnings": [_issue_public(i) for i in business.get("warnings", [])],
        "extracted": {
            "invoiceNumber": ex.get("invoice_number"),
            "supplierSiret": ex.get("supplier_business_identifier") or ex.get("supplier_identifier"),
            "supplierIdentifierType": ex.get("supplier_identifier_type"),
            "customerSiret": ex.get("customer_identifier"),
            "currency": ex.get("currency"),
            "totalTtc": ex.get("total_ttc"),
            "taxPercentages": ex.get("tax_percentages", []),
        },
    }


def _issue_public(issue: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": issue.get("code"),
        "field": issue.get("field"),
        "xmlPath": (issue.get("xml_path") or issue.get("field") or "").replace(".", " > ") or None,
        "currentValue": issue.get("current_value") if "current_value" in issue else issue.get("value"),
        "message": issue.get("message"),
        "suggestedFix": issue.get("suggested_fix"),
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@router.get("/health")
async def handle_g2b_health(_auth_user: dict[str, Any] = Depends(require_submit_permission)) -> JSONResponse:
    settings_ok = True
    flux_available: bool | None = None
    try:
        chorus_settings, token = _resolve_settings_and_token(None)
        g2b = load_g2b_settings()
        health = await g2b_flux_healthcheck(g2b["flux_base_url"], token, chorus_settings.cpro_account)
        flux_available = bool(health.get("available"))
    except Exception as error:  # noqa: BLE001
        logger.debug("G2B health: %s", error)
        settings_ok = False
    return _json(HTTPStatus.OK, {
        "success": True,
        "services": {
            # Annuaire/Raccordement: clients prévus dans les phases suivantes.
            "annuaire": {"configured": True, "available": None},
            "flux": {"configured": settings_ok, "available": flux_available},
            "raccordement": {"configured": True, "available": None},
        },
    })


# ---------------------------------------------------------------------------
# Detect (aucun appel distant)
# ---------------------------------------------------------------------------
@router.post("/flux/detect")
async def handle_g2b_detect(
    file: UploadFile = File(...),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le fichier est vide."})
    detected = detect_flux_file(file_bytes, filename)
    recommendation = build_g2b_recommendation(detected["detected_file_type"])
    return _json(HTTPStatus.OK, {
        "success": True,
        "filename": filename,
        "detected": _detected_public(detected),
        "recommendation": recommendation,
    })


# ---------------------------------------------------------------------------
# Business validation (réutilise le validateur métier ; annuaire = phase 2)
# ---------------------------------------------------------------------------
@router.post("/flux/business-validate")
async def handle_g2b_business_validate(
    file: UploadFile = File(...),
    code_interface: str | None = Form(None),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le fichier est vide."})
    detected = detect_flux_file(file_bytes, filename)
    business = validate_flux_business_rules(
        file_bytes, filename, detected=detected, supplier_config=load_g2b_supplier_config(),
    )["business_validation"]
    return _json(HTTPStatus.OK, {
        "success": True,
        "filename": filename,
        "detected": _detected_public(detected),
        "businessValidation": _business_public(business),
    })


# ---------------------------------------------------------------------------
# Deposit
# ---------------------------------------------------------------------------
@router.post("/flux/deposit")
async def handle_g2b_deposit(
    request: Request,
    file: UploadFile = File(...),
    code_interface: str = Form(...),
    force: bool = Form(False),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    filename = (file.filename or "").strip()
    extension = _file_extension(filename)
    code = (code_interface or "").strip()
    if extension not in G2B_ALLOWED_EXTENSIONS:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "statusLocal": "ERROR", "error": "Seuls les fichiers .xml et .pdf sont acceptés."})
    if code not in KNOWN_CODE_INTERFACES:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "statusLocal": "ERROR", "error": f"codeInterface inconnu. Attendus: {', '.join(sorted(KNOWN_CODE_INTERFACES))}."})

    file_bytes = await file.read()
    if not file_bytes:
        return _json(HTTPStatus.BAD_REQUEST, {"success": False, "statusLocal": "ERROR", "error": "Le fichier est vide."})

    file_sha256 = hashlib.sha256(file_bytes).hexdigest()

    # 1) Détection + recommandation : bloque les types non déposables.
    detected = detect_flux_file(file_bytes, filename)
    recommendation = build_g2b_recommendation(detected["detected_file_type"])
    if recommendation["status"] == "blocked":
        return _json(HTTPStatus.UNPROCESSABLE_ENTITY, {
            "success": False, "statusLocal": "BLOCKED_LOCAL_VALIDATION",
            "message": recommendation["shortExplanation"], "recommendation": recommendation,
            "detected": _detected_public(detected),
        })

    # 2) Validation métier.
    business = validate_flux_business_rules(file_bytes, filename, detected=detected, supplier_config=load_g2b_supplier_config())["business_validation"]
    severity = business["severity"]
    if severity == "BLOCKING" or (severity == "WARNING" and not force):
        return _json(HTTPStatus.UNPROCESSABLE_ENTITY, {
            "success": False,
            "statusLocal": "BLOCKED_BUSINESS_VALIDATION" if severity == "BLOCKING" else "BLOCKED_WARNING",
            "message": "Données métier à corriger avant dépôt." if severity == "BLOCKING" else "Avertissements métier : confirmez pour forcer le dépôt.",
            "businessValidation": _business_public(business),
            "detected": _detected_public(detected),
        })

    # 3) Garde-doublon best-effort.
    now = time.monotonic()
    key = (file_sha256, code)
    recent = _RECENT_SUBMISSIONS.get(key)
    if recent is not None and (now - recent) < _DUPLICATE_TTL_SECONDS and not force:
        return _json(HTTPStatus.CONFLICT, {
            "success": False, "statusLocal": "DUPLICATE",
            "message": "Ce fichier (même contenu et même interface) vient d'être déposé. Confirmez pour redéposer.",
            "fileSha256": file_sha256, "codeInterface": code,
        })

    # 4) Dépôt G2B.
    try:
        chorus_settings, token = _resolve_settings_and_token(None)
        g2b = load_g2b_settings()
        result = await deposit_g2b_flux(
            g2b["flux_base_url"], token, chorus_settings.cpro_account,
            file_bytes, filename, code, checksum_mode=g2b["checksum_mode"],
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        logger.debug("G2B deposit error: %s", message)
        return _json(HTTPStatus.BAD_GATEWAY, {
            "success": False, "statusLocal": "ERROR", "error": message,
            "explanation": explain_g2b_error(message),
        })

    http_status = int(result.get("http_status") or 0)
    uid_flux = result.get("uidFlux")
    success = http_status in (HTTPStatus.OK, HTTPStatus.CREATED, HTTPStatus.ACCEPTED) and bool(uid_flux)
    if success:
        _RECENT_SUBMISSIONS[key] = now

    _safe_append_flux_audit(request, user=_auth_user, fields={
        "status": "success" if success else "failed",
        "source": "g2b-flux",
        "codeInterface": code,
        "uidFlux": uid_flux,
        "fileSha256": file_sha256,
        "httpStatus": http_status,
    })

    if not success:
        return _json(HTTPStatus.BAD_GATEWAY, {
            "success": False, "statusLocal": "ERROR",
            "error": "Le dépôt G2B n'a pas renvoyé d'uidFlux.",
            "explanation": explain_g2b_error(result.get("raw"), http_status=http_status),
            "checksum": result.get("checksum"), "checksumMode": result.get("checksumMode"),
            "fileSha256": file_sha256, "codeInterface": code,
        })

    return _json(HTTPStatus.OK, {
        "success": True,
        "statusLocal": "SUBMITTED",
        "uidFlux": uid_flux,
        "codeInterface": code,
        "checksum": result.get("checksum"),
        "checksumMode": result.get("checksumMode"),
        "fileSha256": file_sha256,
        "message": "Flux déposé. Le statut sera disponible après traitement.",
    })


# ---------------------------------------------------------------------------
# Status / poll
# ---------------------------------------------------------------------------
def _status_payload(result: dict[str, Any]) -> dict[str, Any]:
    http_status = int(result.get("http_status") or 0)
    if http_status == 404:
        return {
            "success": True, "temporary": True, "status": "PROCESSING_NOT_AVAILABLE_YET",
            "message": "Le flux n'est pas encore traité. Réessayez dans quelques secondes.",
        }
    if http_status == 200:
        statut = result.get("statut")
        payload = {
            "success": True, "temporary": False, "status": statut,
            "dateMajStatut": result.get("dateMajStatut"), "nomFlux": result.get("nomFlux"),
        }
        if statut == "IRRECEVABLE":
            payload["explanation"] = explain_g2b_error(result.get("raw"), remote_status="IRRECEVABLE")
        return payload
    return {"success": False, "status": None, "error": f"Statut G2B indisponible (HTTP {http_status}).",
            "explanation": explain_g2b_error(result.get("raw"), http_status=http_status)}


@router.get("/flux/{uid_flux}/status")
async def handle_g2b_status(uid_flux: str, _auth_user: dict[str, Any] = Depends(require_submit_permission)) -> JSONResponse:
    try:
        chorus_settings, token = _resolve_settings_and_token(None)
        g2b = load_g2b_settings()
        result = await get_g2b_flux_status(g2b["flux_base_url"], token, chorus_settings.cpro_account, uid_flux)
    except G2BFluxError as error:
        return _json(HTTPStatus.BAD_GATEWAY, {"success": False, "error": str(error)})
    return _json(HTTPStatus.OK, _status_payload(result))


@router.post("/flux/{uid_flux}/poll")
async def handle_g2b_poll(uid_flux: str, _auth_user: dict[str, Any] = Depends(require_submit_permission)) -> JSONResponse:
    try:
        chorus_settings, token = _resolve_settings_and_token(None)
        g2b = load_g2b_settings()
        result = await poll_g2b_flux_status(g2b["flux_base_url"], token, chorus_settings.cpro_account, uid_flux)
    except G2BFluxError as error:
        return _json(HTTPStatus.BAD_GATEWAY, {"success": False, "error": str(error)})
    payload = _status_payload(result)
    payload["attempts"] = result.get("attempts")
    payload["terminal"] = result.get("terminal", False)
    return _json(HTTPStatus.OK, payload)


# Expose la recommandation pure pour réutilisation/test.
__all__ = ["router", "recommend_g2b_code_interface"]
