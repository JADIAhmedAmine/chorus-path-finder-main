"""Routes FastAPI du module « PDF facture → flux ».

Transforme un PDF de facture normal en flux UBL structuré, avec validation
humaine obligatoire avant génération/dépôt. Un PDF normal n'est JAMAIS déposé
directement : seul un Factur-X (PDF/A3 + XML embarqué) peut aller au dépôt direct
(via la page « Dépôt de flux » existante).

Réutilise les modules existants :
- détection/compatibilité : ``chorus_flux_detector`` ;
- client Chorus + OAuth/cpro-account : ``chorus_flux_client`` + helpers de
  ``chorus_flux_routes`` (jamais ré-implémentés ici) ;
- dépôt : ``deposer_flux_facture`` (logique de dépôt inchangée).

Sécurité : aucun secret renvoyé au frontend ; pas de journalisation du contenu
PDF, du XML généré, des tokens ou du cpro-account.
"""

from __future__ import annotations

import hashlib
import logging
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Request, UploadFile

from .auth import require_submit_permission
from .chorus_flux_client import ChorusFluxError, deposer_flux_facture, recuperer_syntaxe_flux
from .chorus_flux_detector import (
    SEVERITY_BLOCKING,
    UBL_INVOICE,
    detect_flux_file,
    evaluate_flux_compatibility,
    explain_chorus_flux_error,
)
from .chorus_flux_routes import (
    _audit_text,
    _chorus_call_failure_message,
    _flux_status_local,
    _json_response,
    _persist_fields,
    _persist_flux_deposit,
    _resolve_settings_and_token,
    _safe_append_flux_audit,
)
from .chorus_pdf_invoice_extractor import extract_invoice_draft
from .chorus_pdf_to_flux_service import detect_pdf_for_flux, validate_draft
from .chorus_ubl_generator import GENERATED_FILENAME, generate_ubl_invoice

logger = logging.getLogger("chorus_pdf_to_flux_routes")

router = APIRouter(prefix="/api/chorus/pdf-to-flux", tags=["pdf-to-flux"])


def _looks_like_pdf(file_bytes: bytes, filename: str) -> bool:
    return (filename or "").lower().endswith(".pdf") or file_bytes[:5] == b"%PDF-"


def _as_draft(body: Any) -> dict[str, Any]:
    """Accepte soit ``{"draft": {...}}`` soit le brouillon directement."""
    if isinstance(body, dict) and isinstance(body.get("draft"), dict):
        return body["draft"]
    return body if isinstance(body, dict) else {}


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    return None


def _vat_rate_missing_for_generation(draft: dict[str, Any]) -> bool:
    """Vrai si de la TVA est due mais qu'aucun taux n'est disponible (ventilation
    TVA ou taux de ligne) — auquel cas générer un cbc:Percent fiable est impossible."""
    invoice = draft.get("invoice") if isinstance(draft.get("invoice"), dict) else {}
    total_tva = _to_float(invoice.get("total_tva"))
    if total_tva is None or total_tva <= 0:
        return False  # pas de TVA due (ex. exonéré) : Percent 0 acceptable
    breakdown = draft.get("vat_breakdown") if isinstance(draft.get("vat_breakdown"), list) else []
    for entry in breakdown:
        if isinstance(entry, dict) and _to_float(entry.get("vat_rate")) is not None:
            return False
    lines = draft.get("lines") if isinstance(draft.get("lines"), list) else []
    for line in lines:
        if isinstance(line, dict) and _to_float(line.get("vat_rate")) is not None:
            return False
    return True


# ---------------------------------------------------------------------------
# 1) Détection PDF (Factur-X vs PDF normal)
# ---------------------------------------------------------------------------
@router.post("/detect")
async def handle_pdf_detect(
    file: UploadFile = File(...),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> Any:
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    try:
        result = detect_pdf_for_flux(file_bytes, filename)
    except ValueError as error:
        return _json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": str(error)})
    return _json_response(HTTPStatus.OK, result)


# ---------------------------------------------------------------------------
# 2) Extraction du brouillon (aucun dépôt, aucune génération)
# ---------------------------------------------------------------------------
@router.post("/extract")
async def handle_pdf_extract(
    file: UploadFile = File(...),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> Any:
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        return _json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le fichier est vide."})
    if not _looks_like_pdf(file_bytes, filename):
        return _json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Seuls les fichiers PDF sont acceptés."})

    payload = extract_invoice_draft(file_bytes, filename)
    return _json_response(
        HTTPStatus.OK,
        {
            "success": True,
            "filename": filename,
            "draft": payload["draft"],
            "confidence": payload["confidence"],
            "warnings": payload["warnings"],
        },
    )


# ---------------------------------------------------------------------------
# 3) Validation du brouillon
# ---------------------------------------------------------------------------
@router.post("/validate-draft")
async def handle_validate_draft(
    body: dict[str, Any] = Body(default={}),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> Any:
    return _json_response(HTTPStatus.OK, validate_draft(_as_draft(body)))


# ---------------------------------------------------------------------------
# 4) Génération du XML UBL
# ---------------------------------------------------------------------------
@router.post("/generate-xml")
async def handle_generate_xml(
    body: dict[str, Any] = Body(default={}),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> Any:
    draft = _as_draft(body)
    target = body.get("target") if isinstance(body.get("target"), dict) else {}
    format_flux = (target.get("formatFlux") or "IN_DP_E1_STRUCT").strip()
    syntaxe_flux = (target.get("syntaxeFlux") or "IN_DP_E1_UBL_INVOICE").strip()

    # v1 : génération UBL uniquement.
    if "UBL" not in syntaxe_flux.upper():
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "success": False,
                "error": "Seule la génération UBL (IN_DP_E1_UBL_INVOICE) est supportée pour le moment.",
                "warnings": [],
            },
        )

    validation = validate_draft(draft)
    if not validation["valid"]:
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "success": False,
                "error": "Le brouillon contient des erreurs : corrigez-les avant de générer le XML.",
                "validation": validation,
            },
        )

    # Garde-fou TVA : un UBL conforme exige un taux (cbc:Percent) dans TaxSubtotal.
    # Si de la TVA est due mais qu'aucun taux n'est disponible, on bloque la
    # génération plutôt que de produire un Percent à 0 que Chorus rejetterait.
    if _vat_rate_missing_for_generation(draft):
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "success": False,
                "error": "Le taux de TVA est obligatoire pour générer un UBL conforme (cbc:Percent). "
                         "Renseignez la ventilation TVA ou le taux de TVA des lignes.",
                "warnings": [],
            },
        )

    xml = generate_ubl_invoice(draft)
    detected = detect_flux_file(xml.encode("utf-8"), GENERATED_FILENAME)
    return _json_response(
        HTTPStatus.OK,
        {
            "success": True,
            "generated": {
                "filename": GENERATED_FILENAME,
                "formatFlux": format_flux,
                "syntaxeFlux": syntaxe_flux,
                "detected_file_type": detected["detected_file_type"],
                "xml_preview": xml,
            },
            "warnings": [item["message"] for item in validation["warnings"]],
        },
    )


# ---------------------------------------------------------------------------
# 5) Validation du XML généré
# ---------------------------------------------------------------------------
@router.post("/validate-xml")
async def handle_validate_xml(
    body: dict[str, Any] = Body(default={}),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> Any:
    xml = body.get("xml")
    syntaxe_flux = (body.get("syntaxeFlux") or "").strip() or None
    if not isinstance(xml, str) or not xml.strip():
        return _json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le champ xml est obligatoire."})

    detected = detect_flux_file(xml.encode("utf-8"), GENERATED_FILENAME)
    detected_type = detected["detected_file_type"]
    compatibility = evaluate_flux_compatibility(detected_type, None, syntaxe_flux)
    valid = detected_type == UBL_INVOICE and compatibility["severity"] != SEVERITY_BLOCKING

    warnings: list[str] = []
    if detected_type != UBL_INVOICE:
        warnings.append("Le XML généré n'est pas reconnu comme UBL Invoice.")
    if compatibility["severity"] == SEVERITY_BLOCKING and compatibility.get("warning"):
        warnings.append(compatibility["warning"])

    return _json_response(
        HTTPStatus.OK,
        {
            "success": True,
            "valid": valid,
            "detected": {
                "detected_file_type": detected_type,
                "root_element": detected.get("root_element"),
                "namespace": detected.get("namespace"),
            },
            "compatibility": {
                "severity": compatibility["severity"],
                "compatible": compatibility["compatible"],
            },
            "warnings": warnings,
        },
    )


# ---------------------------------------------------------------------------
# 6) Dépôt du XML généré (réutilise deposer_flux_facture)
# ---------------------------------------------------------------------------
@router.post("/deposer-generated")
async def handle_deposer_generated(
    request: Request,
    body: dict[str, Any] = Body(default={}),
    auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> Any:
    xml = body.get("xml")
    if not isinstance(xml, str) or not xml.strip():
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "status_local": "ERROR", "error": "Le champ xml est obligatoire."},
        )

    filename = (body.get("filename") or GENERATED_FILENAME).strip() or GENERATED_FILENAME
    format_flux = (body.get("formatFlux") or "").strip()
    syntaxe_flux = (body.get("syntaxeFlux") or "").strip()
    avec_signature = bool(body.get("avecSignature", False))
    id_utilisateur_courant = int(body.get("idUtilisateurCourant", 0) or 0)
    environment_override = None
    raw_env = body.get("environment")
    if isinstance(raw_env, str) and raw_env.strip():
        environment_override = raw_env.strip().lower()

    if not format_flux or not syntaxe_flux:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"success": False, "status_local": "ERROR", "error": "formatFlux et syntaxeFlux sont obligatoires."},
        )

    file_bytes = xml.encode("utf-8")
    file_sha256 = hashlib.sha256(file_bytes).hexdigest()
    file_size = len(file_bytes)

    # 1) Re-détection + garde-fou : seul un UBL Invoice généré est déposable ici.
    detected = detect_flux_file(file_bytes, filename)
    detected_type = detected["detected_file_type"]
    compatibility = evaluate_flux_compatibility(detected_type, format_flux, syntaxe_flux)
    if detected_type != UBL_INVOICE or compatibility["severity"] == SEVERITY_BLOCKING:
        warning_message = (
            compatibility.get("warning")
            or "Le XML généré n'est pas un UBL Invoice valide pour le dépôt."
        )
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "success": False,
                "status_local": "BLOCKED_LOCAL_VALIDATION",
                "error": warning_message,
                "detected": detected,
                "compatibility": compatibility,
            },
        )

    try:
        settings, access_token = _resolve_settings_and_token(environment_override)

        # 2) Vérifie (best-effort) que la syntaxe appartient bien au format.
        try:
            syntaxes = await recuperer_syntaxe_flux(
                piste_base_url=settings.base_url,
                access_token=access_token,
                cpro_account_base64=settings.cpro_account,
                format_flux=format_flux,
                timeout_seconds=settings.timeout_seconds,
            )
            available = syntaxes.get("listeSyntaxeFlux") or []
            if available and syntaxe_flux not in available:
                return _json_response(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "success": False,
                        "status_local": "ERROR",
                        "error": (
                            f"La syntaxe {syntaxe_flux} n'est pas disponible pour le format {format_flux}. "
                            f"Valeurs possibles: {', '.join(available)}."
                        ),
                    },
                )
        except ChorusFluxError as verify_error:
            logger.debug("Vérification syntaxe/format ignorée: %s", verify_error)

        # 3) Dépôt via le service existant (logique inchangée).
        result = await deposer_flux_facture(
            piste_base_url=settings.base_url,
            access_token=access_token,
            cpro_account_base64=settings.cpro_account,
            file_bytes=file_bytes,
            filename=filename,
            syntaxe_flux=syntaxe_flux,
            id_utilisateur_courant=id_utilisateur_courant,
            avec_signature=avec_signature,
            timeout_seconds=settings.timeout_seconds,
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        logger.debug("Dépôt XML généré: erreur=%s", message)
        _safe_append_flux_audit(
            request,
            user=auth_user,
            fields={
                "status": "failed",
                "nomFichier": _audit_text(filename, max_length=160),
                "formatFlux": _audit_text(format_flux, max_length=64),
                "syntaxeFlux": _audit_text(syntaxe_flux, max_length=64),
                "statusLocal": "ERROR",
                "source": "pdf-to-flux",
                "error": _audit_text(message, max_length=240),
            },
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

    _safe_append_flux_audit(
        request,
        user=auth_user,
        fields={
            "status": "success" if success else "failed",
            "nomFichier": _audit_text(filename, max_length=160),
            "formatFlux": _audit_text(format_flux, max_length=64),
            "syntaxeFlux": _audit_text(syntaxe_flux, max_length=64),
            "statusLocal": status_local,
            "httpStatus": http_status,
            "codeRetour": code_retour,
            "source": "pdf-to-flux",
            "libelle": _audit_text(result.get("libelle")),
            "numeroFluxDepot": _audit_text(result.get("numeroFluxDepot")),
        },
    )

    persisted_id = await _persist_flux_deposit(
        _persist_fields(
            filename=filename,
            file_sha256=file_sha256,
            file_size=file_size,
            format_flux=format_flux,
            syntaxe_flux=syntaxe_flux,
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

    payload = {
        "success": success,
        "http_status": http_status,
        "status_local": status_local,
        "codeRetour": code_retour,
        "libelle": result.get("libelle"),
        "dateDepot": result.get("dateDepot"),
        "numeroFluxDepot": result.get("numeroFluxDepot"),
        "formatFlux": format_flux,
        "syntaxeFlux": result.get("syntaxeFlux"),
        "detected": detected,
        "compatibility": compatibility,
        "explanation": explanation,
        "persisted": persisted_id is not None,
        "raw": result.get("raw"),
    }
    local_http_status = HTTPStatus.OK if status_local != "ERROR" else HTTPStatus.BAD_GATEWAY
    return _json_response(local_http_status, payload)
