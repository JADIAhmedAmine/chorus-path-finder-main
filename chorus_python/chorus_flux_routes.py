"""Routes FastAPI du module « Dépôt de flux » Chorus Pro.

Routeur isolé du dépôt unitaire (`/api/chorus/submit`). Il expose :

- ``POST /api/chorus/flux/formats``  -> liste des formats de flux disponibles ;
- ``POST /api/chorus/flux/syntaxes`` -> syntaxes XML d'un format donné ;
- ``POST /api/chorus/flux/deposer``  -> dépôt multipart d'un fichier en flux.

La signature ``cpro-account`` et le token PISTE ne sont jamais renvoyés au
frontend. Le contenu du fichier, l'``Authorization`` et le ``cpro-account`` ne
sont jamais journalisés.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from http import HTTPStatus
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .audit import append_audit_event
from .auth import require_submit_permission
from .chorus_flux_client import (
    ChorusFluxError,
    deposer_flux_facture,
    recuperer_format_flux,
    recuperer_syntaxe_flux,
)
from .chorus_flux_detector import (
    FLUX_FORMAT_GUIDE,
    SEVERITY_BLOCKING,
    SEVERITY_WARNING,
    detect_flux_file,
    evaluate_flux_compatibility,
    explain_chorus_flux_error,
    file_extension as _detector_file_extension,
)
from .client import ChorusClient
from .config import ChorusSettings, load_chorus_settings


logger = logging.getLogger("chorus_flux_routes")

router = APIRouter(prefix="/api/chorus/flux", tags=["flux"])

FLUX_ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".xml", ".pdf"})


# ---------------------------------------------------------------------------
# Petits utilitaires locaux (évitent une dépendance circulaire au serveur).
# ---------------------------------------------------------------------------
def _json_response(status: int, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=int(status), content=jsonable_encoder(payload))


def _extract_environment_override(body: dict[str, Any] | None) -> str | None:
    if not isinstance(body, dict):
        return None
    raw = body.get("environment") or body.get("chorusEnv") or body.get("env")
    if isinstance(raw, str) and raw.strip():
        return raw.strip().lower()
    return None


def _audit_text(value: Any, max_length: int = 160) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text if len(text) <= max_length else f"{text[:max_length - 1]}…"


def _compact_fields(fields: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in fields.items() if value is not None and value != ""}


def _file_extension(filename: str | None) -> str:
    if not filename:
        return ""
    return os.path.splitext(filename)[1].lower()


def _chorus_call_failure_message(result: dict[str, Any]) -> str:
    """Construit un message lisible quand Chorus répond mais en échec."""
    http_status = int(result.get("http_status") or 0)
    code_retour = result.get("codeRetour")
    libelle = result.get("libelle")
    explanation = explain_chorus_flux_error(
        result.get("raw"), None, http_status=http_status, code_retour=code_retour, libelle=libelle
    )
    if explanation:
        return explanation["message"]
    if isinstance(libelle, str) and libelle.strip():
        return f"Chorus a répondu HTTP {http_status} (codeRetour={code_retour}) : {libelle.strip()}"
    return (
        f"Chorus a répondu HTTP {http_status} (codeRetour={code_retour}). "
        "Vérifiez l'environnement (qualif/prod), le token PISTE, l'en-tête cpro-account "
        "et l'habilitation du compte technique pour l'API de dépôt de flux."
    )


def _flux_status_local(http_status: int, code_retour: int | None) -> str:
    """Traduit (http_status, codeRetour) Chorus en statut local métier."""
    if http_status in (HTTPStatus.OK, HTTPStatus.ACCEPTED):
        return "ACCEPTED" if code_retour == 0 else "REJECTED"
    return "ERROR"


def _resolve_settings_and_token(environment_override: str | None) -> tuple[ChorusSettings, str]:
    """Réutilise la logique OAuth/credentials existante (token + cpro-account)."""
    settings = load_chorus_settings(environment_override=environment_override)
    settings.validate_for_api_access()

    client = ChorusClient(settings)
    if settings.api_key.strip():
        access_token = settings.api_key.strip()
    else:
        token_body = client.fetch_oauth_token_payload()
        access_token = token_body.get("access_token")
        if not isinstance(access_token, str) or not access_token.strip():
            raise ChorusFluxError("Réponse OAuth2 invalide: access_token absent.")
        access_token = access_token.strip()

    return settings, access_token


def _safe_append_flux_audit(request: Request, *, user: dict[str, Any], fields: dict[str, Any]) -> None:
    """Journalise un événement de flux sans contenu de fichier ni identifiants."""
    try:
        append_audit_event(
            {
                "action": "invoice.flux.deposit",
                "email": user.get("email") if isinstance(user, dict) else None,
                "roleCode": user.get("roleCode") if isinstance(user, dict) else None,
                "ip": request.client.host if request.client else None,
                **_compact_fields(fields),
            }
        )
    except Exception:  # noqa: BLE001 - l'audit ne doit jamais casser la requête
        logger.debug("Audit du dépôt de flux ignoré (erreur non bloquante).")


def _persist_flux_deposit_sync(fields: dict[str, Any]) -> str | None:
    """Insère une trace en base si la persistance DB est disponible.

    Best-effort : toute erreur (DB non configurée, indisponible, schéma absent)
    est avalée pour ne jamais faire échouer le dépôt de flux.
    """
    try:
        from .db.config import load_database_settings
        from .db.repositories import record_flux_deposit
        from .db.session import get_session
    except Exception:  # noqa: BLE001 - persistance DB optionnelle
        return None

    try:
        tenant_id = load_database_settings().default_tenant_id
        with get_session() as session:
            deposit = record_flux_deposit(session, tenant_id=tenant_id, **fields)
            return deposit.id
    except Exception as error:  # noqa: BLE001 - ne jamais casser la requête
        logger.debug("Persistance du dépôt de flux ignorée: %s", error)
        return None


async def _persist_flux_deposit(fields: dict[str, Any]) -> str | None:
    return await asyncio.to_thread(_persist_flux_deposit_sync, fields)


def _persist_fields(
    *,
    filename: str,
    file_sha256: str,
    file_size: int,
    format_flux: str,
    syntaxe_flux: str,
    avec_signature: bool,
    id_utilisateur_courant: int,
    detected: dict[str, Any],
    status_local: str,
    http_status: int | None,
    code_retour: int | None,
    libelle: str | None,
    date_depot: str | None,
    numero_flux_depot: str | None,
    raw_response: Any,
) -> dict[str, Any]:
    """Construit le dictionnaire passé à record_flux_deposit (métadonnées only)."""
    return {
        "nom_fichier": filename,
        "file_sha256": file_sha256,
        "file_size": file_size,
        "format_flux": format_flux,
        "syntaxe_flux": syntaxe_flux,
        "detected_file_type": detected.get("detected_file_type"),
        "root_element": detected.get("root_element") or detected.get("embedded_xml_root"),
        "namespace": detected.get("namespace") or detected.get("embedded_xml_namespace"),
        "avec_signature": bool(avec_signature),
        "id_utilisateur_courant": int(id_utilisateur_courant),
        "status_local": status_local,
        "http_status": http_status,
        "code_retour": code_retour,
        "libelle": libelle,
        "date_depot": date_depot,
        "numero_flux_depot": numero_flux_depot,
        "raw_response": raw_response,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post("/formats")
async def handle_flux_formats(
    body: dict[str, Any] | None = Body(default=None),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    environment_override = _extract_environment_override(body)
    started_at = perf_counter()

    try:
        settings, access_token = _resolve_settings_and_token(environment_override)
        result = await recuperer_format_flux(
            piste_base_url=settings.base_url,
            access_token=access_token,
            cpro_account_base64=settings.cpro_account,
            timeout_seconds=settings.timeout_seconds,
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        logger.debug("Formats de flux: erreur=%s", message)
        return _json_response(HTTPStatus.BAD_GATEWAY, {"success": False, "error": message})

    chorus_http_status = int(result.get("http_status") or 0)
    code_retour = result.get("codeRetour")
    success = chorus_http_status in (HTTPStatus.OK, HTTPStatus.ACCEPTED) and code_retour == 0
    logger.debug(
        "Formats de flux: success=%s, chorusHttp=%s, codeRetour=%s, %s formats, duration=%s ms",
        success, chorus_http_status, code_retour, len(result.get("listeFormatFlux") or []),
        round((perf_counter() - started_at) * 1000),
    )

    return _json_response(
        HTTPStatus.OK if success else HTTPStatus.BAD_GATEWAY,
        {
            "success": success,
            "error": None if success else _chorus_call_failure_message(result),
            "http_status": chorus_http_status,
            "codeRetour": code_retour,
            "libelle": result.get("libelle"),
            "formats": result.get("listeFormatFlux") or [],
            "raw": result.get("raw"),
        },
    )


@router.post("/syntaxes")
async def handle_flux_syntaxes(
    body: dict[str, Any] | None = Body(default=None),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    body = body or {}
    format_flux = body.get("formatFlux")
    if not isinstance(format_flux, str) or not format_flux.strip():
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "error": "Le champ formatFlux est obligatoire."},
        )

    environment_override = _extract_environment_override(body)

    try:
        settings, access_token = _resolve_settings_and_token(environment_override)
        result = await recuperer_syntaxe_flux(
            piste_base_url=settings.base_url,
            access_token=access_token,
            cpro_account_base64=settings.cpro_account,
            format_flux=format_flux.strip(),
            timeout_seconds=settings.timeout_seconds,
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        logger.debug("Syntaxes de flux: erreur=%s", message)
        return _json_response(HTTPStatus.BAD_GATEWAY, {"success": False, "error": message})

    chorus_http_status = int(result.get("http_status") or 0)
    code_retour = result.get("codeRetour")
    success = chorus_http_status in (HTTPStatus.OK, HTTPStatus.ACCEPTED) and code_retour == 0

    return _json_response(
        HTTPStatus.OK if success else HTTPStatus.BAD_GATEWAY,
        {
            "success": success,
            "error": None if success else _chorus_call_failure_message(result),
            "http_status": chorus_http_status,
            "codeRetour": code_retour,
            "libelle": result.get("libelle"),
            "formatFlux": format_flux.strip(),
            "syntaxes": result.get("listeSyntaxeFlux") or [],
            "raw": result.get("raw"),
        },
    )


@router.get("/guide")
async def handle_flux_guide(
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    """Référentiel statique des formats/syntaxes (guide UI). Source de vérité des
    valeurs disponibles : /formats et /syntaxes (API Chorus)."""
    return _json_response(HTTPStatus.OK, {"success": True, "guide": FLUX_FORMAT_GUIDE})


@router.post("/detect")
async def handle_flux_detect(
    file: UploadFile = File(...),
    format_flux: str | None = Form(None),
    syntaxe_flux: str | None = Form(None),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    """Détecte le type réel d'un fichier sans appeler Chorus deposer/flux."""
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "error": "Le fichier est vide."},
        )

    detected = detect_flux_file(file_bytes, filename)

    normalized_format = (format_flux or "").strip() or None
    normalized_syntaxe = (syntaxe_flux or "").strip() or None
    compatibility = None
    if normalized_format or normalized_syntaxe:
        compatibility = evaluate_flux_compatibility(
            detected["detected_file_type"], normalized_format, normalized_syntaxe
        )

    return _json_response(
        HTTPStatus.OK,
        {
            "success": True,
            "filename": filename,
            "extension": _detector_file_extension(filename),
            "detected": detected,
            "compatibility": compatibility,
        },
    )


@router.post("/deposer")
async def handle_flux_deposer(
    request: Request,
    file: UploadFile = File(...),
    format_flux: str = Form(...),
    syntaxe_flux: str = Form(...),
    avec_signature: bool = Form(False),
    id_utilisateur_courant: int = Form(0),
    force: bool = Form(False),
    environment: str | None = Form(None),
    auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    started_at = perf_counter()
    filename = (file.filename or "").strip()
    extension = _file_extension(filename)
    normalized_format = (format_flux or "").strip()
    normalized_syntaxe = (syntaxe_flux or "").strip()

    # 1) Validations locales (n'appellent jamais Chorus).
    if extension not in FLUX_ALLOWED_EXTENSIONS:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "success": False,
                "status_local": "ERROR",
                "error": "Seuls les fichiers .xml et .pdf sont acceptés pour le dépôt de flux.",
            },
        )
    if not normalized_format:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "status_local": "ERROR", "error": "Le champ format_flux est obligatoire."},
        )
    if not normalized_syntaxe:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "status_local": "ERROR", "error": "Le champ syntaxe_flux est obligatoire."},
        )

    file_bytes = await file.read()
    if not file_bytes:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "status_local": "ERROR", "error": "Le fichier de flux est vide."},
        )

    file_sha256 = hashlib.sha256(file_bytes).hexdigest()
    file_size = len(file_bytes)

    # 2) Détection locale du type réel + compatibilité avec la syntaxe choisie.
    detected = detect_flux_file(file_bytes, filename)
    compatibility = evaluate_flux_compatibility(
        detected["detected_file_type"], normalized_format, normalized_syntaxe
    )
    severity = compatibility["severity"]
    blocked = severity == SEVERITY_BLOCKING or (severity == SEVERITY_WARNING and not force)
    if blocked:
        warning_message = compatibility.get("warning") or "Fichier incompatible avec la syntaxe sélectionnée."
        _safe_append_flux_audit(
            request,
            user=auth_user,
            fields={
                "status": "failed",
                "nomFichier": _audit_text(filename, max_length=160),
                "formatFlux": _audit_text(normalized_format, max_length=64),
                "syntaxeFlux": _audit_text(normalized_syntaxe, max_length=64),
                "detectedFileType": detected.get("detected_file_type"),
                "statusLocal": "BLOCKED_LOCAL_VALIDATION",
                "severity": severity,
            },
        )
        await _persist_flux_deposit(
            _persist_fields(
                filename=filename,
                file_sha256=file_sha256,
                file_size=file_size,
                format_flux=normalized_format,
                syntaxe_flux=normalized_syntaxe,
                avec_signature=avec_signature,
                id_utilisateur_courant=id_utilisateur_courant,
                detected=detected,
                status_local="BLOCKED_LOCAL_VALIDATION",
                http_status=None,
                code_retour=None,
                libelle=None,
                date_depot=None,
                numero_flux_depot=None,
                raw_response={"blocked": True, "severity": severity, "warning": warning_message},
            )
        )
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "success": False,
                "status_local": "BLOCKED_LOCAL_VALIDATION",
                "error": warning_message,
                "detected": detected,
                "compatibility": compatibility,
                "formatFlux": normalized_format,
                "syntaxeFlux": normalized_syntaxe,
            },
        )

    environment_override = (
        environment.strip().lower() if isinstance(environment, str) and environment.strip() else None
    )
    logger.debug(
        "Dépôt de flux start: fichier=%s, taille=%s octets, format=%s, syntaxe=%s, signature=%s, env=%s",
        filename,
        len(file_bytes),
        normalized_format,
        normalized_syntaxe,
        avec_signature,
        environment_override or "default",
    )

    try:
        settings, access_token = _resolve_settings_and_token(environment_override)

        # 2) Vérification best-effort: la syntaxe appartient-elle au format ?
        try:
            syntaxes = await recuperer_syntaxe_flux(
                piste_base_url=settings.base_url,
                access_token=access_token,
                cpro_account_base64=settings.cpro_account,
                format_flux=normalized_format,
                timeout_seconds=settings.timeout_seconds,
            )
            available = syntaxes.get("listeSyntaxeFlux") or []
            if available and normalized_syntaxe not in available:
                return _json_response(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "success": False,
                        "status_local": "ERROR",
                        "error": (
                            f"La syntaxe {normalized_syntaxe} n'est pas disponible pour le format "
                            f"{normalized_format}. Valeurs possibles: {', '.join(available)}."
                        ),
                    },
                )
        except ChorusFluxError as verify_error:
            # La vérification est facultative: on n'échoue pas le dépôt pour autant.
            logger.debug("Vérification syntaxe/format ignorée: %s", verify_error)

        # 3) Dépôt du flux.
        result = await deposer_flux_facture(
            piste_base_url=settings.base_url,
            access_token=access_token,
            cpro_account_base64=settings.cpro_account,
            file_bytes=file_bytes,
            filename=filename,
            syntaxe_flux=normalized_syntaxe,
            id_utilisateur_courant=int(id_utilisateur_courant),
            avec_signature=bool(avec_signature),
            timeout_seconds=settings.timeout_seconds,
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        logger.debug("Dépôt de flux error: duration=%s ms, error=%s", round((perf_counter() - started_at) * 1000), message)
        _safe_append_flux_audit(
            request,
            user=auth_user,
            fields={
                "status": "failed",
                "nomFichier": _audit_text(filename, max_length=160),
                "formatFlux": _audit_text(normalized_format, max_length=64),
                "syntaxeFlux": _audit_text(normalized_syntaxe, max_length=64),
                "statusLocal": "ERROR",
                "error": _audit_text(message, max_length=240),
            },
        )
        await _persist_flux_deposit(
            _persist_fields(
                filename=filename,
                file_sha256=file_sha256,
                file_size=file_size,
                format_flux=normalized_format,
                syntaxe_flux=normalized_syntaxe,
                avec_signature=avec_signature,
                id_utilisateur_courant=id_utilisateur_courant,
                detected=detected,
                status_local="ERROR",
                http_status=None,
                code_retour=None,
                libelle=None,
                date_depot=None,
                numero_flux_depot=None,
                raw_response={"error": message},
            )
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "success": False,
                "status_local": "ERROR",
                "error": message,
                "detected": detected,
                "explanation": explain_chorus_flux_error(None, detected, libelle=message),
            },
        )

    http_status = int(result.get("http_status") or 0)
    code_retour = result.get("codeRetour")
    status_local = _flux_status_local(http_status, code_retour)
    success = status_local == "ACCEPTED"

    logger.debug(
        "Dépôt de flux done: statut=%s, http=%s, codeRetour=%s, numeroFluxDepot=%s, duration=%s ms",
        status_local,
        http_status,
        code_retour,
        result.get("numeroFluxDepot"),
        round((perf_counter() - started_at) * 1000),
    )

    _safe_append_flux_audit(
        request,
        user=auth_user,
        fields={
            "status": "success" if success else "failed",
            "nomFichier": _audit_text(filename, max_length=160),
            "formatFlux": _audit_text(normalized_format, max_length=64),
            "syntaxeFlux": _audit_text(normalized_syntaxe, max_length=64),
            "statusLocal": status_local,
            "httpStatus": http_status,
            "codeRetour": code_retour,
            "libelle": _audit_text(result.get("libelle")),
            "numeroFluxDepot": _audit_text(result.get("numeroFluxDepot")),
        },
    )

    persisted_id = await _persist_flux_deposit(
        _persist_fields(
            filename=filename,
            file_sha256=file_sha256,
            file_size=file_size,
            format_flux=normalized_format,
            syntaxe_flux=normalized_syntaxe,
            avec_signature=avec_signature,
            id_utilisateur_courant=id_utilisateur_courant,
            detected=detected,
            status_local=status_local,
            http_status=http_status,
            code_retour=code_retour,
            libelle=result.get("libelle"),
            date_depot=result.get("dateDepot"),
            numero_flux_depot=result.get("numeroFluxDepot"),
            raw_response=result.get("raw"),
        )
    )

    explanation = (
        None
        if success
        else explain_chorus_flux_error(
            result.get("raw"), detected, http_status=http_status, code_retour=code_retour, libelle=result.get("libelle")
        )
    )

    response_payload = {
        "success": success,
        "http_status": http_status,
        "status_local": status_local,
        "codeRetour": code_retour,
        "libelle": result.get("libelle"),
        "dateDepot": result.get("dateDepot"),
        "numeroFluxDepot": result.get("numeroFluxDepot"),
        "formatFlux": normalized_format,
        "syntaxeFlux": result.get("syntaxeFlux"),
        "detected": detected,
        "compatibility": compatibility,
        "explanation": explanation,
        "persisted": persisted_id is not None,
        "raw": result.get("raw"),
    }

    # HTTP 200 lorsque Chorus a répondu (ACCEPTED/REJECTED), 502 lorsque l'appel
    # Chorus n'a pas abouti (ERROR).
    local_http_status = HTTPStatus.OK if status_local != "ERROR" else HTTPStatus.BAD_GATEWAY
    return _json_response(local_http_status, response_payload)
