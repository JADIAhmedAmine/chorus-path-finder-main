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
from datetime import date, datetime, timezone
from http import HTTPStatus
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .audit import append_audit_event
from .auth import get_current_auth_user, require_submit_permission
from .chorus_cr import (
    OFFICIAL_FLUX_STATES,
    normalize_cr,
    normalize_cr_detaille,
    official_id_for_label,
)
from .chorus_flux_client import (
    ChorusFluxError,
    consulter_cr,
    consulter_cr_detaille,
    deposer_flux_facture,
    recuperer_format_flux,
    recuperer_syntaxe_flux,
)
import re

from .chorus_flux_business_validator import (
    extract_recipient_identifier,
    load_supplier_config,
    validate_flux_business_rules,
)
from .g2b_annuaire_client import validate_recipient as _g2b_validate_recipient
from .g2b_config import load_g2b_settings, load_g2b_supplier_config
from .chorus_flux_detector import (
    FLUX_FORMAT_GUIDE,
    SEVERITY_BLOCKING,
    SEVERITY_WARNING,
    detect_flux_file,
    evaluate_flux_compatibility,
    explain_chorus_flux_error,
    extract_flux_metadata,
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
# Lecture des dépôts de flux + statistiques (hub /flux).
#
# La table `chorus_flux_deposits` stocke `status_local` (statut local du dépôt :
# ACCEPTED/REJECTED/ERROR/BLOCKED_*) et, depuis P2-3, l'`etat_courant_flux` officiel
# (Reçu/Intégré/…) issu de `consulterCR`/`consulterCRDetaille` quand il a été rafraîchi.
# Tant qu'aucun CR n'est récupéré, l'état officiel est dérivé best-effort de status_local.
# Source unique des 9 états officiels + normalisation : `chorus_cr.py`.
# ---------------------------------------------------------------------------

_OFFICIAL_LABELS: dict[str, str] = dict(OFFICIAL_FLUX_STATES)

# Correspondance best-effort statut local -> état officiel (faute de consulterCR).
_STATUS_LOCAL_TO_OFFICIAL: dict[str, str] = {
    "ACCEPTED": "integre",   # dépôt accepté par Chorus (codeRetour 0) — à affiner via consulterCR
    "REJECTED": "rejete",
    "ERROR": "incidente",    # incident technique en atteignant Chorus
}
# Statuts locaux « bloqués avant envoi » : aucun flux n'a atteint Chorus.
_BLOCKED_STATUS_LOCAL: frozenset[str] = frozenset({"BLOCKED_LOCAL_VALIDATION", "BLOCKED_BUSINESS_VALIDATION"})
# Statuts locaux comptés comme « flux en erreur » (ont atteint Chorus et échoué).
_ERROR_STATUS_LOCAL: frozenset[str] = frozenset({"REJECTED", "ERROR"})


def _official_state_id(status_local: str | None) -> str | None:
    """Renvoie l'id d'état officiel best-effort pour un statut local, ou None."""
    if not status_local:
        return None
    return _STATUS_LOCAL_TO_OFFICIAL.get(status_local.strip().upper())


def _serialize_flux_deposit(row: Any) -> dict[str, Any]:
    """Sérialise une ligne `ChorusFluxDeposit` en dict camelCase pour le frontend.

    Depuis P2-3 : `officialFluxState` provient du CR réel (`etat_courant_flux`) si
    disponible, sinon dérivé best-effort de `status_local`. `invoiceCount` reste
    `null` (non fourni par consulterCRDetaille).
    """
    status_local = getattr(row, "status_local", None)
    etat_courant = getattr(row, "etat_courant_flux", None)
    cr_available = getattr(row, "cr_available", None)

    if etat_courant:
        official_id = official_id_for_label(etat_courant)
        official_label = etat_courant
        official_source = "chorus_cr"
    else:
        official_id = _official_state_id(status_local)
        official_label = _OFFICIAL_LABELS.get(official_id) if official_id else None
        official_source = "derived_from_status_local"
    has_error = (
        official_id in {"rejete", "incidente", "integrePartiellement"}
        if etat_courant
        else bool(status_local in _ERROR_STATUS_LOCAL) if status_local else False
    )

    return {
        "id": getattr(row, "id", None),
        "numeroFluxDepot": getattr(row, "numero_flux_depot", None),
        "nomFichier": getattr(row, "nom_fichier", None),
        "fileSize": getattr(row, "file_size", None),
        "formatFlux": getattr(row, "format_flux", None) or None,
        "syntaxeFlux": getattr(row, "syntaxe_flux", None) or None,
        "formatDepot": getattr(row, "format_depot", None),
        "detectedFileType": getattr(row, "detected_file_type", None),
        "avecSignature": getattr(row, "avec_signature", None),
        "statusLocal": status_local,
        "officialFluxStateId": official_id,
        "officialFluxState": official_label,
        "officialFluxStateSource": official_source,
        "hasError": has_error,
        "httpStatus": getattr(row, "http_status", None),
        "codeRetour": getattr(row, "code_retour", None),
        "libelle": getattr(row, "libelle", None),
        "invoiceCount": getattr(row, "invoice_count", None),  # null : non fourni par consulterCRDetaille
        "errorCount": getattr(row, "error_count", None),
        "crAvailable": bool(cr_available) if cr_available is not None else None,
        "lastCrCheckedAt": getattr(row, "last_cr_checked_at", None),
        "lastCrError": getattr(row, "last_cr_error", None),
        "dateDepot": getattr(row, "date_depot", None),
        "createdAt": getattr(row, "created_at", None),
        "updatedAt": getattr(row, "updated_at", None),
    }


def _build_flux_stats(raw: dict[str, Any]) -> dict[str, Any]:
    """Construit l'objet `stats` du hub (logique pure, testable sans base).

    États officiels = états CR RÉELS (`by_etat_courant_flux`) pour les dépôts ayant un
    compte rendu, complétés par la dérivation best-effort de `status_local` pour ceux
    sans CR (`by_status_local_no_cr`, ou tout `by_status_local` si aucun CR connu).
    """
    by_status: dict[str, int] = {str(k): int(v) for k, v in (raw.get("by_status_local") or {}).items()}
    by_etat: dict[str, int] = {str(k): int(v) for k, v in (raw.get("by_etat_courant_flux") or {}).items()}
    by_status_no_cr: dict[str, int] = {str(k): int(v) for k, v in (raw.get("by_status_local_no_cr") or {}).items()}
    cr_count = int(raw.get("cr_count") or 0)
    numero_count = int(raw.get("numero_count") or 0)

    official = {sid: 0 for sid, _ in OFFICIAL_FLUX_STATES}

    # 1) États CR réels (libellé officiel -> id).
    for label, count in by_etat.items():
        sid = official_id_for_label(label)
        if sid:
            official[sid] += count

    # 2) Repli best-effort pour les dépôts SANS CR.
    fallback_source = by_status_no_cr if (by_status_no_cr or cr_count > 0) else by_status
    blocked_before_send = 0
    for status, count in fallback_source.items():
        normalized = status.strip().upper()
        if normalized in _BLOCKED_STATUS_LOCAL:
            blocked_before_send += count
            continue
        sid = _STATUS_LOCAL_TO_OFFICIAL.get(normalized)
        if sid:
            official[sid] += count

    total = int(raw.get("total") or 0)
    submitted = total - blocked_before_send
    accepted = official["integre"] + official["integrePartiellement"]
    total_errors = official["rejete"] + official["incidente"] + official["integrePartiellement"]
    success_rate = round(accepted / submitted * 100) if submitted > 0 else None

    return {
        "total": total,
        "submitted": submitted,
        "blockedBeforeSend": blocked_before_send,
        "totalErrors": total_errors,
        "successRate": success_rate,
        "lastDepositAt": raw.get("last_created_at"),
        "firstDepositAt": raw.get("first_created_at"),
        "lastDateDepot": raw.get("last_date_depot"),
        "byStatusLocal": by_status,
        "byEtatCourantFlux": by_etat,
        "crCount": cr_count,
        "officialFluxStates": official,
        "officialFluxStatesLabels": dict(OFFICIAL_FLUX_STATES),
        "officialStatesSource": "chorus_cr" if cr_count > 0 else "derived_from_status_local",
        # Complet seulement si tous les flux ayant un numéro Chorus ont un CR.
        "officialStatesComplete": cr_count > 0 and numero_count > 0 and cr_count >= numero_count,
        "bySyntaxeFlux": {str(k): int(v) for k, v in (raw.get("by_syntaxe_flux") or {}).items()},
        "byFormatFlux": {str(k): int(v) for k, v in (raw.get("by_format_flux") or {}).items()},
        "byFormatDepot": None,  # not_available : formatDepot non agrégé (peu pertinent)
    }


def _empty_flux_stats() -> dict[str, Any]:
    return _build_flux_stats(
        {
            "total": 0,
            "by_status_local": {},
            "by_syntaxe_flux": {},
            "by_format_flux": {},
            "last_created_at": None,
            "first_created_at": None,
            "last_date_depot": None,
        }
    )


def _resolve_flux_tenant(user: dict[str, Any], explicit: str | None) -> str:
    """Résout le tenant à lire (isolation), aligné sur la logique de /api/db."""
    from .db.config import load_database_settings

    default_tenant = load_database_settings().default_tenant_id
    role = user.get("roleCode") if isinstance(user, dict) else None
    raw_user_tenant = (user.get("tenantId") or user.get("tenant_id")) if isinstance(user, dict) else None
    user_tenant = raw_user_tenant.strip() if isinstance(raw_user_tenant, str) and raw_user_tenant.strip() else default_tenant

    if role == "ADMINISTRATEUR":
        return explicit.strip() if isinstance(explicit, str) and explicit.strip() else default_tenant
    if isinstance(explicit, str) and explicit.strip() and explicit.strip() != user_tenant:
        raise HTTPException(status_code=403, detail="Accès interdit à ce tenant.")
    return user_tenant


def _parse_query_date(value: str | None) -> date | None:
    if not value or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip()).date()
    except ValueError as error:
        raise HTTPException(
            status_code=400, detail=f"Date invalide '{value}' (format attendu : YYYY-MM-DD)."
        ) from error


def _read_flux_deposits_sync(*, tenant_id: str, filters: dict[str, Any], page: int, page_size: int) -> dict[str, Any] | None:
    """Lecture best-effort des dépôts de flux. None si la base est indisponible."""
    try:
        from .db.repositories import list_flux_deposits
        from .db.session import get_session
    except Exception:  # noqa: BLE001 - persistance DB optionnelle
        return None
    try:
        with get_session() as session:
            page_obj = list_flux_deposits(session, tenant_id=tenant_id, page=page, page_size=page_size, **filters)
            return {
                "total": page_obj.total,
                "page": page_obj.page,
                "page_size": page_obj.page_size,
                "items": [_serialize_flux_deposit(row) for row in page_obj.items],
            }
    except Exception as error:  # noqa: BLE001 - ne jamais casser le hub
        logger.debug("Lecture des dépôts de flux ignorée: %s", error)
        return None


def _flux_stats_sync(*, tenant_id: str, filters: dict[str, Any]) -> dict[str, Any] | None:
    """Agrégats best-effort des dépôts de flux. None si la base est indisponible."""
    try:
        from .db.repositories import flux_deposit_stats
        from .db.session import get_session
    except Exception:  # noqa: BLE001
        return None
    try:
        with get_session() as session:
            return flux_deposit_stats(session, tenant_id=tenant_id, **filters)
    except Exception as error:  # noqa: BLE001
        logger.debug("Statistiques des dépôts de flux ignorées: %s", error)
        return None


# ---------------------------------------------------------------------------
# Rafraîchissement du compte rendu (CR) — P2-3.
# ---------------------------------------------------------------------------
def _cr_fields_from_normalized(
    normalized: dict[str, Any], *, http_status: int | None, code_retour: int | None, libelle: str | None
) -> dict[str, Any]:
    """Construit les valeurs de colonnes CR à partir d'un CR normalisé (pure)."""
    summary = dict(normalized)
    summary["httpStatus"] = http_status
    summary["codeRetour"] = code_retour
    summary["libelle"] = libelle
    return {
        "etat_courant_flux": normalized.get("etatCourantFlux"),
        "cr_summary_json": summary,
        "invoice_count": normalized.get("invoiceCount"),
        "error_count": normalized.get("errorCount"),
        "cr_available": True,
    }


async def _fetch_cr(numero_flux_depot: str, environment_override: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Appelle consulterCRDetaille (repli consulterCR) et renvoie (résultat brut, CR normalisé)."""
    settings, access_token = _resolve_settings_and_token(environment_override)
    try:
        result = await consulter_cr_detaille(
            settings.base_url, access_token, settings.cpro_account, numero_flux_depot,
            timeout_seconds=settings.timeout_seconds,
        )
        return result, normalize_cr_detaille(result.get("raw"))
    except ChorusFluxError:
        result = await consulter_cr(
            settings.base_url, access_token, settings.cpro_account, numero_flux_depot,
            timeout_seconds=settings.timeout_seconds,
        )
        return result, normalize_cr(result.get("raw"))


def _get_deposit_sync(*, tenant_id: str, deposit_id: str) -> dict[str, Any] | None:
    """Lecture best-effort d'un dépôt. None si DB indisponible ; {found: False} si absent."""
    try:
        from .db.repositories import get_flux_deposit
        from .db.session import get_session
    except Exception:  # noqa: BLE001
        return None
    try:
        with get_session() as session:
            deposit = get_flux_deposit(session, tenant_id=tenant_id, deposit_id=deposit_id)
            if deposit is None:
                return {"found": False}
            return {"found": True, "numero": deposit.numero_flux_depot, "deposit": _serialize_flux_deposit(deposit)}
    except Exception as error:  # noqa: BLE001
        logger.debug("Lecture du dépôt ignorée: %s", error)
        return None


def _list_needing_cr_sync(*, tenant_id: str, limit: int) -> list[dict[str, Any]] | None:
    try:
        from .db.repositories import list_flux_deposits_needing_cr
        from .db.session import get_session
    except Exception:  # noqa: BLE001
        return None
    try:
        with get_session() as session:
            rows = list_flux_deposits_needing_cr(session, tenant_id=tenant_id, limit=limit)
            return [{"id": row.id, "numero": row.numero_flux_depot} for row in rows]
    except Exception as error:  # noqa: BLE001
        logger.debug("Liste des dépôts à rafraîchir ignorée: %s", error)
        return None


def _persist_cr_sync(
    *, tenant_id: str, deposit_id: str, cr_fields: dict[str, Any] | None, error_message: str | None
) -> dict[str, Any] | str | None:
    """Applique le CR (succès) ou enregistre l'erreur (échec). Renvoie le dépôt sérialisé,
    'NOT_FOUND', ou None si DB indisponible."""
    try:
        from .db.repositories import apply_cr_to_deposit, get_flux_deposit
        from .db.session import get_session
    except Exception:  # noqa: BLE001
        return None
    try:
        now = datetime.now(timezone.utc)
        with get_session() as session:
            deposit = get_flux_deposit(session, tenant_id=tenant_id, deposit_id=deposit_id)
            if deposit is None:
                return "NOT_FOUND"
            if cr_fields is not None:
                apply_cr_to_deposit(
                    session, deposit, last_cr_checked_at=now, last_cr_error=None, **cr_fields
                )
            else:
                # Échec : on horodate la tentative et on garde l'état précédent intact.
                deposit.last_cr_checked_at = now
                deposit.last_cr_error = error_message
                session.add(deposit)
                session.flush()
            return _serialize_flux_deposit(deposit)
    except Exception as error:  # noqa: BLE001
        logger.debug("Persistance du CR ignorée: %s", error)
        return None


async def _refresh_cr_one(
    *, tenant_id: str, deposit_id: str, numero_flux_depot: str, environment_override: str | None
) -> dict[str, Any]:
    """Rafraîchit le CR d'un dépôt : appel Chorus + persistance. Best-effort."""
    try:
        result, normalized = await _fetch_cr(numero_flux_depot, environment_override)
        http_status = int(result.get("http_status") or 0)
        code_retour = result.get("codeRetour")
        cr_ok = http_status in (int(HTTPStatus.OK), int(HTTPStatus.ACCEPTED)) and code_retour in (0, None)
        if cr_ok:
            cr_fields = _cr_fields_from_normalized(
                normalized, http_status=http_status, code_retour=code_retour, libelle=result.get("libelle")
            )
            deposit = await asyncio.to_thread(
                _persist_cr_sync, tenant_id=tenant_id, deposit_id=deposit_id, cr_fields=cr_fields, error_message=None
            )
            return {"id": deposit_id, "crRefreshed": True, "deposit": deposit if isinstance(deposit, dict) else None}
        message = result.get("libelle") or _chorus_call_failure_message(result)
        deposit = await asyncio.to_thread(
            _persist_cr_sync, tenant_id=tenant_id, deposit_id=deposit_id, cr_fields=None,
            error_message=_audit_text(message, 240),
        )
        return {"id": deposit_id, "crRefreshed": False, "error": message, "deposit": deposit if isinstance(deposit, dict) else None}
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        deposit = await asyncio.to_thread(
            _persist_cr_sync, tenant_id=tenant_id, deposit_id=deposit_id, cr_fields=None,
            error_message=_audit_text(message, 240),
        )
        return {"id": deposit_id, "crRefreshed": False, "error": message, "deposit": deposit if isinstance(deposit, dict) else None}


async def _try_annuaire_lookup(
    file_bytes: bytes | None = None,
    filename: str = "",
    detected: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Construit un lookup annuaire (SIRET -> {active}) pour le débiteur via l'API
    G2B Annuaire. Best-effort et désactivé par défaut (G2B_ANNUAIRE_ENABLED) :
    retourne None si indisponible/désactivé, auquel cas la validation métier
    renvoie l'avertissement « annuaire non disponible ».
    """
    if file_bytes is None:
        return None
    try:
        g2b = load_g2b_settings()
        if not g2b.get("annuaire_enabled"):
            return None
        siret = extract_recipient_identifier(file_bytes, filename, detected)
        if not siret or len(re.sub(r"\D", "", siret)) != 14:
            return None
        settings, access_token = _resolve_settings_and_token(None)
        result = await _g2b_validate_recipient(
            g2b["annuaire_base_url"], access_token, settings.cpro_account, siret,
        )
        if not result.get("success"):
            return None
        return {siret: {"active": bool(result.get("recipient", {}).get("active"))}}
    except Exception as error:  # noqa: BLE001 - best-effort, ne casse jamais le dépôt
        logger.debug("Lookup annuaire ignoré: %s", error)
        return None


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
    metadata = extract_flux_metadata(file_bytes, filename, detected)

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
            "metadata": metadata,
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

    # 2bis) Pré-contrôle métier (identifiants, adresses, structure fournisseur).
    #       Bloque les rejets Chorus « métier » avant l'appel réseau.
    business = validate_flux_business_rules(
        file_bytes,
        filename,
        detected=detected,
        format_flux=normalized_format,
        syntaxe_flux=normalized_syntaxe,
        annuaire_lookup=await _try_annuaire_lookup(file_bytes, filename, detected),
        supplier_config=load_supplier_config(),
    )["business_validation"]
    bv_severity = business["severity"]
    # BLOCKING (identifiant/adresse manquants, fournisseur non autorisé…) :
    # jamais forçable. WARNING : informatif, ne bloque pas le dépôt.
    business_blocked = bv_severity == SEVERITY_BLOCKING
    if business_blocked:
        _safe_append_flux_audit(
            request,
            user=auth_user,
            fields={
                "status": "failed",
                "nomFichier": _audit_text(filename, max_length=160),
                "formatFlux": _audit_text(normalized_format, max_length=64),
                "syntaxeFlux": _audit_text(normalized_syntaxe, max_length=64),
                "detectedFileType": detected.get("detected_file_type"),
                "statusLocal": "BLOCKED_BUSINESS_VALIDATION",
                "severity": bv_severity,
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
                status_local="BLOCKED_BUSINESS_VALIDATION",
                http_status=None,
                code_retour=None,
                libelle=None,
                date_depot=None,
                numero_flux_depot=None,
                raw_response={"blocked": True, "business_validation": business},
            )
        )
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "success": False,
                "status_local": "BLOCKED_BUSINESS_VALIDATION",
                "message": "Le flux est techniquement compatible mais les données métier sont incomplètes ou non reconnues.",
                "detected": detected,
                "compatibility": compatibility,
                "business_validation": business,
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
        "business_validation": business,
        "explanation": explanation,
        "persisted": persisted_id is not None,
        "raw": result.get("raw"),
    }

    # HTTP 200 lorsque Chorus a répondu (ACCEPTED/REJECTED), 502 lorsque l'appel
    # Chorus n'a pas abouti (ERROR).
    local_http_status = HTTPStatus.OK if status_local != "ERROR" else HTTPStatus.BAD_GATEWAY
    return _json_response(local_http_status, response_payload)


# ---------------------------------------------------------------------------
# Pré-contrôle métier (sans appel Chorus)
# ---------------------------------------------------------------------------
@router.post("/business-validate")
async def handle_flux_business_validate(
    file: UploadFile = File(...),
    format_flux: str | None = Form(None),
    syntaxe_flux: str | None = Form(None),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    """Détection + métadonnées + validation métier, sans appeler Chorus."""
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        return _json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le fichier est vide."})

    detected = detect_flux_file(file_bytes, filename)
    metadata = extract_flux_metadata(file_bytes, filename, detected)
    business = validate_flux_business_rules(
        file_bytes,
        filename,
        detected=detected,
        format_flux=(format_flux or "").strip() or None,
        syntaxe_flux=(syntaxe_flux or "").strip() or None,
        annuaire_lookup=await _try_annuaire_lookup(file_bytes, filename, detected),
        supplier_config=load_supplier_config(),
    )["business_validation"]

    return _json_response(
        HTTPStatus.OK,
        {
            "success": True,
            "filename": filename,
            "detected": detected,
            "metadata": metadata,
            "business_validation": business,
        },
    )


@router.post("/prepare-correction")
async def handle_flux_prepare_correction(
    file: UploadFile = File(...),
    supplier_identifier: str | None = Form(None),
    supplier_address: str | None = Form(None),
    customer_identifier: str | None = Form(None),
    customer_address: str | None = Form(None),
    _auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    """Propose un plan de correction (sans muter le fichier ni déposer)."""
    filename = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        return _json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": "Le fichier est vide."})

    detected = detect_flux_file(file_bytes, filename)
    config = load_supplier_config()
    annuaire_lookup = await _try_annuaire_lookup(file_bytes, filename, detected)
    business = validate_flux_business_rules(
        file_bytes, filename, detected=detected, annuaire_lookup=annuaire_lookup, supplier_config=config,
    )["business_validation"]
    checks = business.get("checks", {})
    extracted = business.get("extracted", {})
    default_supplier = config.get("default_supplier_siret")

    address_template = {"StreetName": "", "PostalZone": "", "CityName": "", "Country": "FR"}
    suggestions: list[dict[str, Any]] = []

    if not checks.get("supplier_identifier_known", False):
        suggestions.append({
            "field": "AccountingSupplierParty.Party.PartyIdentification.ID",
            "current": extracted.get("supplier_identifier"),
            "suggested": (supplier_identifier or "").strip() or default_supplier,
            "reason": "Utilisez l'identifiant SIRET de la structure fournisseur rattachée au compte technique.",
        })
    if not checks.get("supplier_address_present", False):
        suggestions.append({
            "field": "AccountingSupplierParty.Party.PostalAddress",
            "current": extracted.get("supplier_address"),
            "suggested": (supplier_address or "").strip() or address_template,
            "reason": "L'adresse fournisseur est obligatoire (au moins une ligne d'adresse).",
        })
    if not checks.get("customer_identifier_present", False) or not checks.get("customer_identifier_known", False):
        suggestions.append({
            "field": "AccountingCustomerParty.Party.PartyIdentification.ID",
            "current": extracted.get("customer_identifier"),
            "suggested": (customer_identifier or "").strip() or None,
            "reason": "Vérifiez que le SIRET destinataire existe dans l'annuaire Chorus.",
        })
    if not checks.get("customer_address_present", False):
        suggestions.append({
            "field": "AccountingCustomerParty.Party.PostalAddress",
            "current": extracted.get("customer_address"),
            "suggested": (customer_address or "").strip() or address_template,
            "reason": "L'adresse du débiteur/client est obligatoire.",
        })

    return _json_response(
        HTTPStatus.OK,
        {"success": True, "filename": filename, "suggestions": suggestions, "business_validation": business},
    )


# ---------------------------------------------------------------------------
# Lecture des dépôts de flux (hub /flux) — lecture seule, tout rôle authentifié.
# ---------------------------------------------------------------------------
def _build_flux_filters(
    status_local: str | None,
    syntaxe_flux: str | None,
    format_flux: str | None,
    date_from: str | None,
    date_to: str | None,
) -> dict[str, Any]:
    return {
        "status_local": (status_local or "").strip() or None,
        "syntaxe_flux": (syntaxe_flux or "").strip() or None,
        "format_flux": (format_flux or "").strip() or None,
        "date_from": _parse_query_date(date_from),
        "date_to": _parse_query_date(date_to),
    }


@router.get("/deposits")
async def handle_list_flux_deposits(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200, alias="pageSize"),
    status_local: str | None = Query(None, alias="status"),
    syntaxe_flux: str | None = Query(None, alias="syntaxe"),
    format_flux: str | None = Query(None, alias="format"),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    tenant_id: str | None = Query(None, alias="tenantId"),
    user: dict[str, Any] = Depends(get_current_auth_user),
) -> JSONResponse:
    """Liste paginée des dépôts de flux du tenant (plus récent d'abord).

    Lecture seule (tout rôle authentifié). Dégrade proprement si la base n'est pas
    disponible : `available=false`, liste vide, HTTP 200 (le hub affiche l'état vide).
    """
    resolved_tenant = _resolve_flux_tenant(user, tenant_id)
    filters = _build_flux_filters(status_local, syntaxe_flux, format_flux, date_from, date_to)

    result = await asyncio.to_thread(
        _read_flux_deposits_sync, tenant_id=resolved_tenant, filters=filters, page=page, page_size=page_size
    )
    if result is None:
        return _json_response(
            HTTPStatus.OK,
            {
                "success": True,
                "available": False,
                "reason": "database_not_available",
                "total": 0,
                "page": page,
                "pageSize": page_size,
                "items": [],
            },
        )
    return _json_response(
        HTTPStatus.OK,
        {
            "success": True,
            "available": True,
            "total": result["total"],
            "page": result["page"],
            "pageSize": result["page_size"],
            "items": result["items"],
        },
    )


@router.get("/deposits/stats")
async def handle_flux_deposits_stats(
    status_local: str | None = Query(None, alias="status"),
    syntaxe_flux: str | None = Query(None, alias="syntaxe"),
    format_flux: str | None = Query(None, alias="format"),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    tenant_id: str | None = Query(None, alias="tenantId"),
    user: dict[str, Any] = Depends(get_current_auth_user),
) -> JSONResponse:
    """Statistiques de synthèse des dépôts de flux pour le hub `/flux`.

    Inclut les 9 états officiels `etatCourantFlux` (dérivés best-effort de
    `status_local`, cf. `officialStatesComplete=false`). `available=false` si la base
    n'est pas disponible.
    """
    resolved_tenant = _resolve_flux_tenant(user, tenant_id)
    filters = _build_flux_filters(status_local, syntaxe_flux, format_flux, date_from, date_to)

    raw = await asyncio.to_thread(_flux_stats_sync, tenant_id=resolved_tenant, filters=filters)
    if raw is None:
        return _json_response(
            HTTPStatus.OK,
            {"success": True, "available": False, "reason": "database_not_available", "stats": _empty_flux_stats()},
        )
    return _json_response(
        HTTPStatus.OK,
        {"success": True, "available": True, "stats": _build_flux_stats(raw)},
    )


# ---------------------------------------------------------------------------
# Rafraîchissement du compte rendu (CR) — appelle Chorus, donc rôle « submit ».
# ---------------------------------------------------------------------------
@router.post("/deposits/{deposit_id}/refresh-cr")
async def handle_refresh_cr(
    deposit_id: str,
    environment: str | None = Query(None),
    tenant_id: str | None = Query(None, alias="tenantId"),
    user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    """Récupère le compte rendu Chorus d'un dépôt et enrichit ses champs CR.

    `consulterCRDetaille` (repli `consulterCR`). Renvoie le dépôt enrichi. Si la base
    est indisponible : `available=false`. Si le dépôt n'a pas de numéro de flux Chorus
    (bloqué/erreur), renvoie `crRefreshed=false` sans appeler Chorus.
    """
    resolved_tenant = _resolve_flux_tenant(user, tenant_id)
    env_override = environment.strip().lower() if isinstance(environment, str) and environment.strip() else None

    info = await asyncio.to_thread(_get_deposit_sync, tenant_id=resolved_tenant, deposit_id=deposit_id)
    if info is None:
        return _json_response(
            HTTPStatus.OK,
            {"success": True, "available": False, "reason": "database_not_available"},
        )
    if not info.get("found"):
        raise HTTPException(status_code=404, detail="Dépôt de flux introuvable.")

    numero = info.get("numero")
    if not numero:
        return _json_response(
            HTTPStatus.OK,
            {
                "success": False,
                "available": True,
                "crRefreshed": False,
                "error": "Ce dépôt n'a pas de numéro de flux Chorus (dépôt bloqué ou en erreur).",
                "deposit": info.get("deposit"),
            },
        )

    outcome = await _refresh_cr_one(
        tenant_id=resolved_tenant, deposit_id=deposit_id, numero_flux_depot=str(numero), environment_override=env_override
    )
    return _json_response(
        HTTPStatus.OK,
        {
            "success": bool(outcome.get("crRefreshed")),
            "available": True,
            "crRefreshed": bool(outcome.get("crRefreshed")),
            "error": outcome.get("error"),
            "deposit": outcome.get("deposit"),
        },
    )


@router.post("/deposits/refresh-cr")
async def handle_refresh_cr_batch(
    limit: int = Query(10, ge=1, le=50),
    environment: str | None = Query(None),
    tenant_id: str | None = Query(None, alias="tenantId"),
    user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    """Rafraîchit un lot borné de dépôts, les moins récemment consultés d'abord."""
    resolved_tenant = _resolve_flux_tenant(user, tenant_id)
    env_override = environment.strip().lower() if isinstance(environment, str) and environment.strip() else None

    candidates = await asyncio.to_thread(_list_needing_cr_sync, tenant_id=resolved_tenant, limit=limit)
    if candidates is None:
        return _json_response(
            HTTPStatus.OK,
            {"success": True, "available": False, "reason": "database_not_available", "attempted": 0, "refreshed": 0, "items": []},
        )

    items: list[dict[str, Any]] = []
    refreshed = 0
    for candidate in candidates:
        numero = candidate.get("numero")
        if not numero:
            continue
        outcome = await _refresh_cr_one(
            tenant_id=resolved_tenant, deposit_id=str(candidate["id"]),
            numero_flux_depot=str(numero), environment_override=env_override,
        )
        if outcome.get("crRefreshed"):
            refreshed += 1
        items.append({"id": outcome.get("id"), "crRefreshed": outcome.get("crRefreshed"), "error": outcome.get("error")})

    return _json_response(
        HTTPStatus.OK,
        {"success": True, "available": True, "attempted": len(items), "refreshed": refreshed, "items": items},
    )
