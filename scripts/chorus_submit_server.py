#!/usr/bin/env python3
from __future__ import annotations

import base64
import importlib.util
import json
import logging
import os
import subprocess
from pathlib import Path
import sys
from time import perf_counter
import traceback
from http import HTTPStatus
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent

# Dépendances minimales nécessaires pour le bridge + extraction PDF
REQUIRED_MODULES = ("fastapi", "uvicorn", "requests", "fitz", "pdfplumber", "jwt", "bcrypt")


def _module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _find_repo_python() -> Path | None:
    candidates = (
        REPO_ROOT / ".venv" / "bin" / "python",
        REPO_ROOT / ".venv" / "Scripts" / "python.exe",
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return None


def _venv_supports_required_modules(python_executable: Path) -> bool:
    probe_command = (
        "import importlib.util, sys; "
        "modules = sys.argv[1:]; "
        "sys.exit(0 if all(importlib.util.find_spec(module) is not None for module in modules) else 1)"
    )

    try:
        result = subprocess.run(
            [str(python_executable), "-c", probe_command, *REQUIRED_MODULES],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return False

    return result.returncode == 0


def _maybe_reexec_with_repo_python() -> None:
    if all(_module_available(module_name) for module_name in REQUIRED_MODULES):
        return

    if os.environ.get("CHORUS_BRIDGE_SKIP_REEXEC") == "1":
        return

    repo_python = _find_repo_python()
    if repo_python is None:
        return

    try:
        current_python = Path(sys.executable).resolve()
        repo_python = repo_python.resolve()
    except OSError:
        return

    if current_python == repo_python:
        return

    if not _venv_supports_required_modules(repo_python):
        return

    print(f"Re-starting bridge with repo virtualenv: {repo_python}", flush=True)
    os.environ["CHORUS_BRIDGE_SKIP_REEXEC"] = "1"
    os.execv(str(repo_python), [str(repo_python), str(Path(__file__).resolve()), *sys.argv[1:]])


_maybe_reexec_with_repo_python()

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import uvicorn
from fastapi import Body, Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from chorus_python import ChorusSubmissionService, load_chorus_settings
from chorus_python.annuaire import build_annuaire_files_from_api_response, relative_to_repo
from chorus_python.audit import append_audit_event
from chorus_python.auth import get_current_auth_user, require_auth, require_submit_permission, router as auth_router
from chorus_python.chorus_flux_routes import router as flux_router
from chorus_python.client import ChorusClient, sanitize_debug_value
from chorus_python.errors import normalize_chorus_error
from chorus_python.extraction import extract_pdf_text_from_base64_docling
from chorus_python.reception import coerce_identifier_list, normalize_invoice_for_reception
from chorus_python.submission_state import (
    InvalidPaymentRequestStateError,
    extract_payment_request_state,
    validate_payment_request_state,
)

try:
    from chorus_python.db.api import router as db_router
    from chorus_python.db.scheduler import (
        load_scheduler_settings,
        shutdown_scheduler,
        start_scheduler,
    )
    _DB_ROUTER_AVAILABLE = True
    _DB_ROUTER_IMPORT_ERROR: str | None = None
except Exception as _db_import_error:  # noqa: BLE001
    _DB_ROUTER_AVAILABLE = False
    _DB_ROUTER_IMPORT_ERROR = str(_db_import_error)


HOST = os.environ.get("CHORUS_HOST", "127.0.0.1")
PORT = int(os.environ.get("CHORUS_PORT", "8008"))
SUBMIT_PATH = "/api/chorus/submit"
RECYCLE_PATH = "/api/chorus/recycle"
CORRECT_VALIDATOR_PATH = "/api/chorus/validator/correct"
RECEPTION_CONSULT_PATH = "/api/reception/consult"
RECEPTION_CONSULT_BULK_PATH = "/api/reception/consult-bulk"
RECEPTION_PROCESS_PATH = "/api/reception/process"
RECEPTION_COMPLETE_PATH = "/api/reception/complete"
RECEPTION_DOWNLOAD_PATH = "/api/reception/download"
INVOICE_DOWNLOAD_PATH = "/api/chorus/invoices/download"
INVOICE_HISTORY_PATH = "/api/chorus/invoices/history"
RECEPTION_BULK_MAX_IDENTIFIERS = 50
CHORUS_RECEPTION_CONSULT_PATH = "/factures/v1/consulter/valideur"
CHORUS_TRAITER_RECUE_PATH = "/factures/v1/traiter/recue"
CHORUS_COMPLETER_FACTURE_PATH = "/factures/v1/completer"
CHORUS_TELECHARGER_GROUPE_PATH = "/factures/v1/telecharger/groupe"

RECEPTION_DOWNLOAD_FORMATS: frozenset[str] = frozenset({"PDF", "PIVOT", "XML", "ZIP", "ZIP_WITH_ATTACHMENTS"})
RECEPTION_DOWNLOAD_CHORUS_FORMAT_BY_REQUEST: dict[str, str] = {
    "PDF": "PDF",
    "PIVOT": "PIVOT",
    # Alias UI: le bouton XML télécharge le pivot Chorus.
    "XML": "PIVOT",
    # Chorus n'accepte pas ZIP comme format ; le ZIP est obtenu via PDF + PJ.
    "ZIP": "PDF",
    "ZIP_WITH_ATTACHMENTS": "PDF",
}
RECEPTION_DOWNLOAD_MIME_BY_FORMAT: dict[str, tuple[str, str]] = {
    "PDF": ("application/pdf", "pdf"),
    "PIVOT": ("application/xml", "xml"),
    "XML": ("application/xml", "xml"),
    "ZIP": ("application/zip", "zip"),
}

RECEPTION_PROCESS_ALLOWED_STATUTS: frozenset[str] = frozenset(
    {
        "A_RECYCLER",
        "COMPLETEE",
        "COMPTABILISEE",
        "MISE_A_DISPOSITION",
        "MISE_A_DISPOSITION_COMPTABLE",
        "MISE_EN_PAIEMENT",
        "PRISE_EN_COMPTE_DESTINATAIRE",
        "REJETEE",
        "SERVICE_FAIT",
        "SUSPENDUE",
        "TRANSMISE_MOA",
        "MANDATEE",
    }
)
RECEPTION_PROCESS_MOTIF_REQUIRED: frozenset[str] = frozenset({"REJETEE", "SUSPENDUE"})
EXTRACT_PDF_PATH = "/api/extract-pdf-text"
OAUTH_TOKEN_PATH = "/api/chorus/oauth-token"
SYNC_ANNUAIRE_PATH = "/api/chorus/annuaire/sync"
SIRET_INFO_PATH = "/api/chorus/siret/info"
ACTIVE_RECIPIENT_STRUCTURES_PATH = "/api/chorus/structures/active-destinataire"
SUPPLIER_INVOICES_SEARCH_PATH = "/api/chorus/invoices/supplier/search"

logger = logging.getLogger("chorus_submit_server")


def _cors_origins() -> list[str]:
    raw = os.environ.get("APP_CORS_ORIGINS", "*")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["*"]


app = FastAPI(title="Chorus Path Finder API", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

AUDITED_ACTIONS = {
    SUBMIT_PATH: "invoice.submit",
    RECYCLE_PATH: "invoice.recycle",
    CORRECT_VALIDATOR_PATH: "invoice.validator.correct",
}


def _audit_action_for_request(request: Request) -> str | None:
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return None
    return AUDITED_ACTIONS.get(request.url.path)


def _request_user_for_audit(request: Request) -> dict[str, Any]:
    authorization = request.headers.get("authorization")
    if not authorization:
        return {}
    try:
        user = get_current_auth_user(authorization)
    except Exception:  # noqa: BLE001
        return {}
    return {
        "email": user.get("email"),
        "roleCode": user.get("roleCode"),
    }


def _audit_text(value: Any, max_length: int = 160) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text if len(text) <= max_length else f"{text[:max_length - 1]}…"


def _audit_value(value: Any, max_length: int = 160) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    return _audit_text(value, max_length=max_length)


def _nested_value(source: dict[str, Any], *path: str) -> Any:
    current: Any = source
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _compact_audit_fields(fields: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in fields.items()
        if value is not None and value != ""
    }


def _user_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _submitter_comment(user: dict[str, Any]) -> str:
    first_name = _user_text(user.get("firstName"))
    last_name = _user_text(user.get("lastName"))
    email = _user_text(user.get("email"))
    full_name = " ".join(part for part in (first_name, last_name) if part)

    if full_name and email:
        return f"Soumis par : {full_name} ({email})"
    if email:
        return f"Soumis par : {email}"
    if full_name:
        return f"Soumis par : {full_name}"
    return "Soumis par : utilisateur authentifié"


def _add_submitter_comment(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    submitter_line = _submitter_comment(user)
    existing_comment = _user_text(payload.get("commentaire"))

    if existing_comment and submitter_line in existing_comment:
        payload["commentaire"] = existing_comment
    elif existing_comment:
        payload["commentaire"] = f"{existing_comment}\n{submitter_line}"
    else:
        payload["commentaire"] = submitter_line

    return payload


def _invoice_audit_fields(
    payload: dict[str, Any] | None,
    result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    return _compact_audit_fields({
        "invoiceNumber": _audit_text(payload.get("numeroFactureSaisi"), max_length=80),
        "invoiceDate": _audit_text(payload.get("dateFacture"), max_length=32),
        "amountTtc": _audit_value(_nested_value(payload, "montantTotal", "montantTtcTotal")),
        "amountToPay": _audit_value(_nested_value(payload, "montantTotal", "montantAPayer")),
        "currency": _audit_text(_nested_value(payload, "references", "deviseFacture"), max_length=8),
        "customerCode": _audit_text(_nested_value(payload, "destinataire", "codeDestinataire"), max_length=32),
        "customerServiceCode": _audit_text(_nested_value(payload, "destinataire", "codeServiceExecutant"), max_length=64),
        "supplierId": _audit_value(_nested_value(payload, "fournisseur", "idFournisseur")),
        "supplierServiceId": _audit_value(_nested_value(payload, "fournisseur", "idServiceFournisseur")),
        "chorusId": _audit_text(result.get("externalId") if isinstance(result, dict) else None, max_length=80),
    })


def _recycle_audit_fields(
    payload: dict[str, Any] | None,
    result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    chorus_id = payload.get("identifiantFactureCPP")
    if isinstance(result, dict):
        chorus_id = result.get("externalId") or chorus_id

    return _compact_audit_fields({
        "chorusId": _audit_value(chorus_id, max_length=80),
        "customerCode": _audit_text(_nested_value(payload, "destinataire", "codeDestinataire"), max_length=32),
        "comment": _audit_text(payload.get("commentaire"), max_length=240),
    })


def _correct_validator_audit_fields(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    return _compact_audit_fields({
        "chorusId": _audit_value(payload.get("idFacture"), max_length=80),
        "validatorStructureId": _audit_value(payload.get("idStructure"), max_length=80),
        "validatorStructureIdentifier": _audit_text(payload.get("identifiantStructure"), max_length=80),
        "validatorStructureIdentifierType": _audit_text(payload.get("typeIdentifiantStructure"), max_length=24),
    })


def _chorus_operation_audit_fields(
    action: str,
    payload: dict[str, Any] | None,
    result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if action == "invoice.recycle":
        return _recycle_audit_fields(payload, result=result)
    if action == "invoice.validator.correct":
        return _correct_validator_audit_fields(payload)
    return _invoice_audit_fields(payload, result=result)


def _safe_append_audit_event(event: dict[str, Any]) -> None:
    try:
        append_audit_event(event)
    except Exception as error:  # noqa: BLE001
        logger.warning("Audit soumission facture indisponible: %s", error)


def _audit_invoice_submission(
    request: Request,
    *,
    user: dict[str, Any],
    payload: dict[str, Any] | None,
    status: str,
    http_status: int | HTTPStatus,
    started_at: float,
    result: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    event = _compact_audit_fields({
        "action": "invoice.submit",
        "email": user.get("email"),
        "roleCode": user.get("roleCode"),
        **_invoice_audit_fields(payload, result=result),
        "status": status,
        "httpStatus": int(http_status),
        "durationMs": round((perf_counter() - started_at) * 1000),
        "errorMessage": _audit_text(error_message, max_length=240) if status != "success" else None,
    })
    _safe_append_audit_event(event)
    request.state.audit_logged = True


def _audit_chorus_operation(
    request: Request,
    *,
    action: str,
    user: dict[str, Any],
    payload: dict[str, Any] | None,
    status: str,
    http_status: int | HTTPStatus,
    started_at: float,
    result: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    event = _compact_audit_fields({
        "action": action,
        "email": user.get("email"),
        "roleCode": user.get("roleCode"),
        **_chorus_operation_audit_fields(action, payload, result=result),
        "status": status,
        "httpStatus": int(http_status),
        "durationMs": round((perf_counter() - started_at) * 1000),
        "errorMessage": _audit_text(error_message, max_length=240) if status != "success" else None,
    })
    _safe_append_audit_event(event)
    request.state.audit_logged = True


def _audit_submit_response(
    request: Request,
    *,
    user: dict[str, Any],
    payload: dict[str, Any] | None,
    http_status: int | HTTPStatus,
    response_payload: dict[str, Any],
    started_at: float,
    result: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> JSONResponse:
    _audit_invoice_submission(
        request,
        user=user,
        payload=payload,
        status="success" if int(http_status) < 400 else "failed",
        http_status=http_status,
        started_at=started_at,
        result=result,
        error_message=error_message,
    )
    return _json_response(http_status, response_payload)


def _error_message_from_response_body(body: bytes) -> str | None:
    if not body:
        return None
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None

    for key in ("error", "detail", "message"):
        value = parsed.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, dict) and isinstance(first.get("msg"), str):
                return first["msg"]
            if isinstance(first, str):
                return first
    return None


async def _response_with_replayed_body(response: Response) -> tuple[bytes, Response]:
    chunks: list[bytes] = []
    async for chunk in response.body_iterator:  # type: ignore[attr-defined]
        chunks.append(chunk.encode("utf-8") if isinstance(chunk, str) else chunk)

    body = b"".join(chunks)
    headers = dict(response.headers)
    headers.pop("content-length", None)
    replayed_response = Response(
        content=body,
        status_code=response.status_code,
        headers=headers,
        media_type=response.media_type,
        background=response.background,
    )
    return body, replayed_response


@app.middleware("http")
async def audit_essential_actions(request: Request, call_next):
    action = _audit_action_for_request(request)
    if action is None:
        return await call_next(request)

    started_at = perf_counter()
    user = _request_user_for_audit(request)
    try:
        response = await call_next(request)
    except Exception:
        _safe_append_audit_event({
            "action": action,
            **user,
            "status": "error",
            "httpStatus": 500,
            "durationMs": round((perf_counter() - started_at) * 1000),
        })
        raise

    if getattr(request.state, "audit_logged", False):
        return response

    response_body, replayed_response = await _response_with_replayed_body(response)
    _safe_append_audit_event(_compact_audit_fields({
        "action": action,
        **user,
        "status": "success" if response.status_code < 400 else "failed",
        "httpStatus": response.status_code,
        "durationMs": round((perf_counter() - started_at) * 1000),
        "errorMessage": _audit_text(_error_message_from_response_body(response_body), max_length=240)
        if response.status_code >= 400
        else None,
    }))
    return replayed_response


app.include_router(auth_router)
app.include_router(flux_router)

if _DB_ROUTER_AVAILABLE:
    app.include_router(db_router)

    @app.on_event("startup")
    def _start_sync_scheduler() -> None:
        try:
            start_scheduler()
        except Exception as error:  # noqa: BLE001
            logger.exception("Echec démarrage scheduler: %s", error)

    @app.on_event("shutdown")
    def _stop_sync_scheduler() -> None:
        shutdown_scheduler()
else:
    logger.warning(
        "Routes /api/db indisponibles (DB non configurée): %s",
        _DB_ROUTER_IMPORT_ERROR,
    )


def _print_received_post_debug(path: str, body: Any) -> None:
    print(f"\n[debug] POST reçu par le bridge - {path}", flush=True)
    print("[debug] Body:", flush=True)
    print(
        json.dumps(
            sanitize_debug_value(body),
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


def _as_positive_int(value: Any) -> int | None:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = int(value)
        except ValueError:
            return None
        return parsed if parsed > 0 else None
    return None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _as_non_empty_string(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)

    return None


def _as_optional_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if value >= 0 else None
    if isinstance(value, str) and value.strip():
        normalized = value.replace("\u202f", "").replace(" ", "").replace(",", ".")
        try:
            parsed = float(normalized)
        except ValueError:
            return None
        if parsed < 0:
            return None
        return int(parsed) if parsed.is_integer() else parsed
    return None


def _as_optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip():
        normalized = value.strip().lower()
        if normalized in {"true", "1", "oui", "yes"}:
            return True
        if normalized in {"false", "0", "non", "no"}:
            return False
    return None


def _as_date(value: Any) -> str | None:
    raw_value = _as_non_empty_string(value)
    if not raw_value:
        return None
    return raw_value[:10]


def _as_datetime(value: Any, *, end_of_day: bool = False) -> str | None:
    raw_value = _as_non_empty_string(value)
    if not raw_value:
        return None
    if "T" in raw_value:
        return raw_value

    date_value = raw_value[:10]
    return f"{date_value}T23:59:59.999Z" if end_of_day else f"{date_value}T00:00:00.000Z"


def _as_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item for item in (_as_non_empty_string(item) for item in value) if item]

    raw_value = _as_non_empty_string(value)
    if not raw_value:
        return []

    return [item.strip() for item in raw_value.split(",") if item.strip()]


def _copy_invoice_search_criteria(payload: dict[str, Any], criteria: dict[str, Any]) -> None:
    string_fields = (
        "modeDepot",
        "numeroBonCommande",
        "numeroFacture",
        "numeroFactureOrigine",
        "numeroFluxDepot",
        "numeroMarche",
        "typeFacture",
    )
    for field_name in string_fields:
        value = _as_non_empty_string(criteria.get(field_name))
        if value:
            payload[field_name] = value

    for field_name in ("coordonneeBancaire", "idServiceFournisseur", "idStructureValideur", "idUtilisateurCourant"):
        value = _as_positive_int(criteria.get(field_name))
        if value is not None:
            payload[field_name] = value

    user_creator_ids = [
        item
        for item in (_as_positive_int(item) for item in criteria.get("idUtilisateurCreateur", []))
        if item is not None
    ]
    if user_creator_ids:
        payload["idUtilisateurCreateur"] = user_creator_ids

    amount_fields = (
        "montantApayerMax",
        "montantApayerMin",
        "montantHTMax",
        "montantHTMin",
        "montantTTCMax",
        "montantTTCMin",
    )
    for field_name in amount_fields:
        value = _as_optional_number(criteria.get(field_name))
        if value is not None:
            payload[field_name] = value

    date_depot_du = _as_date(criteria.get("periodeDateDepotDu"))
    date_depot_au = _as_date(criteria.get("periodeDateDepotAu"))
    if date_depot_du:
        payload["periodeDateDepotDu"] = date_depot_du
    if date_depot_au:
        payload["periodeDateDepotAu"] = date_depot_au

    date_facture_du = _as_datetime(criteria.get("periodeDateFactureDu"))
    date_facture_au = _as_datetime(criteria.get("periodeDateFactureAu"), end_of_day=True)
    if date_facture_du:
        payload["periodeDateFactureDu"] = date_facture_du
    if date_facture_au:
        payload["periodeDateFactureAu"] = date_facture_au

    date_statut_du = _as_datetime(criteria.get("periodeDateHeureEtatCourantDu"))
    date_statut_au = _as_datetime(criteria.get("periodeDateHeureEtatCourantAu"), end_of_day=True)
    if date_statut_du:
        payload["periodeDateHeureEtatCourantDu"] = date_statut_du
    if date_statut_au:
        payload["periodeDateHeureEtatCourantAu"] = date_statut_au

    recherche_siren_destinataire = _as_optional_bool(criteria.get("rechercheSirenDestinataire"))
    if recherche_siren_destinataire is not None:
        payload["rechercheSirenDestinataire"] = recherche_siren_destinataire

    rejet_traite = _as_optional_bool(criteria.get("rejetTraite"))
    if rejet_traite is not None:
        payload["rejetTraite"] = rejet_traite

    statuts = _as_string_list(criteria.get("statutCourant"))
    if statuts:
        payload["statutCourant"] = statuts

    destinataire: dict[str, Any] = {}
    id_destinataire = _as_positive_int(criteria.get("idDestinataire"))
    if id_destinataire is not None:
        destinataire["idDestinataire"] = id_destinataire

    raison_sociale = _as_non_empty_string(criteria.get("raisonSocialeStuctDmd") or criteria.get("destinataire"))
    if raison_sociale:
        destinataire["raisonSocialeStuctDmd"] = raison_sociale

    service_ids = [
        item
        for item in (_as_positive_int(item) for item in criteria.get("listeIdServiceExecutant", []))
        if item is not None
    ]
    if service_ids:
        destinataire["listeIdServiceExecutant"] = service_ids

    if destinataire:
        payload["listeDestinataire"] = [destinataire]


def _build_supplier_invoice_search_payload(
    *,
    supplier_id: int,
    page_size: int,
    criteria: dict[str, Any] | None = None,
) -> dict[str, Any]:
    search_options = criteria.get("rechercheFactureParFournisseur", {}) if isinstance(criteria, dict) else {}
    tri_colonne = _as_non_empty_string(search_options.get("triColonne") if isinstance(search_options, dict) else None)
    tri_sens = _as_non_empty_string(search_options.get("triSens") if isinstance(search_options, dict) else None)

    payload = {
        "cadreFacturation": "A1_FACTURE_FOURNISSEUR",
        "idFournisseur": supplier_id,
        "rechercheFactureParFournisseur": {
            "nbResultatsMaximum": page_size,
            "nbResultatsParPage": page_size,
            "triColonne": tri_colonne or "TypeDemandePaiement",
            "triSens": tri_sens or "Descendant",
        },
        "typeFacture": "FACTURE",
    }

    if criteria:
        _copy_invoice_search_criteria(payload, criteria)
        payload["idFournisseur"] = supplier_id
        payload["cadreFacturation"] = "A1_FACTURE_FOURNISSEUR"
        payload.setdefault("typeFacture", "FACTURE")

    return payload


def _deep_find_first_list(value: Any, candidate_keys: set[str]) -> list[Any]:
    if isinstance(value, dict):
        for key, nested_value in value.items():
            if key in candidate_keys and isinstance(nested_value, list):
                return nested_value

        for nested_value in value.values():
            nested_result = _deep_find_first_list(nested_value, candidate_keys)
            if nested_result:
                return nested_result

    if isinstance(value, list):
        return value

    return []


def _extract_supplier_invoice_items(response_body: Any) -> list[Any]:
    return _deep_find_first_list(
        response_body,
        {
            "factures",
            "listeFacture",
            "listeFactures",
            "listeDemandePaiement",
            "listeDemandesPaiement",
            "demandesPaiement",
            "resultats",
            "results",
            "items",
            "data",
        },
    )


def _extract_supplier_invoice_total(response_body: Any, fallback: int) -> int:
    if isinstance(response_body, dict):
        parametres_retour = response_body.get("parametresRetour")
        if isinstance(parametres_retour, dict):
            total = _as_positive_int(parametres_retour.get("total"))
            if total is not None:
                return total

        for key in ("total", "nbTotalResultats", "nombreTotalResultats"):
            total = _as_positive_int(response_body.get(key))
            if total is not None:
                return total

    return fallback


def _extract_structure_items(response_body: Any) -> list[Any]:
    return _deep_find_first_list(
        response_body,
        {
            "listeStructures",
            "structures",
            "listeStructure",
            "resultats",
            "results",
            "items",
            "data",
        },
    )


def _extract_structure_cpp_id(structure: Any) -> int | None:
    if not isinstance(structure, dict):
        return None

    for key in ("idStructureCPP", "idStructure", "idFournisseur", "idDestinataireCPP", "idDestinataire"):
        value = _as_positive_int(structure.get(key))
        if value is not None:
            return value

    return None


def _resolve_supplier_id_from_active_recipient_structures(
    client: ChorusClient,
    preferred_supplier_id: int | None = None,
) -> tuple[int, list[Any], Any]:
    response_body = client.download_active_recipient_structures()
    structures = _extract_structure_items(response_body)

    if preferred_supplier_id is not None:
        matching_structure = next(
            (
                structure
                for structure in structures
                if _extract_structure_cpp_id(structure) == preferred_supplier_id
            ),
            None,
        )
        if matching_structure is not None:
            return preferred_supplier_id, structures, response_body

    resolved_ids = [
        structure_id
        for structure_id in (_extract_structure_cpp_id(structure) for structure in structures)
        if structure_id is not None
    ]
    if resolved_ids:
        return resolved_ids[0], structures, response_body

    raise ValueError("Aucun idStructureCPP/idFournisseur exploitable dans les structures actives destinataire.")


def _extract_external_id(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None

    candidate = (
        response.get("invoiceId")
        or response.get("numeroFactureChorus")
        or response.get("identifiantFactureCPP")
        or response.get("numeroFacture")
        or response.get("id")
    )
    if isinstance(candidate, str) and candidate.strip():
        return candidate
    if isinstance(candidate, int):
        return str(candidate)
    return None


def _json_response(status: int, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=int(status), content=jsonable_encoder(payload))


def _extract_environment_override(body: dict[str, Any]) -> str | None:
    raw = body.get("environment") or body.get("chorusEnv") or body.get("env")
    if isinstance(raw, str) and raw.strip():
        return raw.strip().lower()
    return None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "chorus-path-finder-api"}


@app.post(OAUTH_TOKEN_PATH, dependencies=[Depends(require_auth)])
def handle_oauth_token(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug("OAuth token start (env=%s)", environment_override or "default")

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        if not settings.token_url or not settings.client_id or not settings.client_secret:
            raise ValueError(
                "Configuration OAuth2 serveur incomplète: CHORUS_TOKEN_URL, "
                "CHORUS_CLIENT_ID et CHORUS_CLIENT_SECRET sont requis."
            )

        client = ChorusClient(settings)
        token_body = client.fetch_oauth_token_payload()
        access_token = token_body.get("access_token")
        if not isinstance(access_token, str) or not access_token.strip():
            raise ValueError("Réponse OAuth2 invalide: access_token absent.")

        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("OAuth token success: duration=%s ms", duration_ms)
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "access_token": access_token,
                "token_type": token_body.get("token_type") or "Bearer",
                "expires_in": token_body.get("expires_in"),
                "scope": token_body.get("scope") or settings.scope,
            },
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("OAuth token error: duration=%s ms, error=%s", duration_ms, message)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
            },
        )


@app.post(EXTRACT_PDF_PATH, dependencies=[Depends(require_auth)])
def handle_extract_pdf(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    pdf_base64 = body.get("pdfBase64")
    if not isinstance(pdf_base64, str) or not pdf_base64.strip():
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": "Le champ pdfBase64 est obligatoire et doit être une chaîne.",
            },
        )

    started_at = perf_counter()
    logger.debug("Extraction PDF start: base64=%s chars", len(pdf_base64))

    try:
        extracted_text = extract_pdf_text_from_base64_docling(pdf_base64)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Extraction PDF success: text=%s chars, duration=%s ms", len(extracted_text), duration_ms)
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "text": extracted_text,
            },
        )
    except ImportError as error:
        return _json_response(
            HTTPStatus.NOT_IMPLEMENTED,
            {
                "ok": False,
                "error": f"Dépendance d'extraction PDF manquante: {error}",
            },
        )
    except RuntimeError as error:
        traceback.print_exc()
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Extraction PDF runtime error after %s ms: %s", duration_ms, error)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": f"Erreur lors de l'extraction PDF: {error}",
            },
        )
    except Exception as error:  # noqa: BLE001
        traceback.print_exc()
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Extraction PDF error after %s ms: %s", duration_ms, error)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": f"Erreur lors de l'extraction PDF: {error}",
            },
        )


@app.post(SUPPLIER_INVOICES_SEARCH_PATH, dependencies=[Depends(require_auth)])
def handle_supplier_invoice_search(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug("Recherche factures fournisseur start (env=%s)", environment_override or "default")

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        client = ChorusClient(settings)
        supplier_id = (
            _as_positive_int(body.get("idFournisseur"))
            or _as_positive_int(settings.default_supplier_id)
        )
        if supplier_id is None:
            supplier_id, _structures, _raw_response = _resolve_supplier_id_from_active_recipient_structures(client)

        initial_payload = _build_supplier_invoice_search_payload(
            supplier_id=supplier_id,
            page_size=2,
            criteria=body,
        )
        initial_response = client.search_supplier_invoices(initial_payload)
        initial_items = _extract_supplier_invoice_items(initial_response)
        total = _extract_supplier_invoice_total(initial_response, len(initial_items))
        page_size = total if total > 0 else 2

        if total > len(initial_items) or page_size > len(initial_items):
            final_payload = _build_supplier_invoice_search_payload(
                supplier_id=supplier_id,
                page_size=page_size,
                criteria=body,
            )
            final_response = client.search_supplier_invoices(final_payload)
        else:
            final_payload = initial_payload
            final_response = initial_response

        invoices = _extract_supplier_invoice_items(final_response)
        total = _extract_supplier_invoice_total(final_response, total or len(invoices))
        requested_page_size = final_payload["rechercheFactureParFournisseur"]["nbResultatsParPage"]
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Recherche factures fournisseur success: supplier=%s, total=%s, returned=%s, duration=%s ms",
            supplier_id,
            total,
            len(invoices),
            duration_ms,
        )
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "idFournisseur": supplier_id,
                "total": total,
                "returned": len(invoices),
                "requestedPageSize": requested_page_size,
                "payload": final_payload,
                "invoices": invoices,
                "rawResponse": final_response,
                "initialResponse": initial_response,
                "apiCalls": client.api_calls,
            },
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = list(client.api_calls) if "client" in locals() else []
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Recherche factures fournisseur error: duration=%s ms, error=%s", duration_ms, message)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )


def _build_invoice_history_payload(raw_payload: dict[str, Any]) -> dict[str, Any]:
    id_facture = _as_positive_int(raw_payload.get("idFacture"))
    if id_facture is None:
        raise ValueError("Le champ idFacture est obligatoire et doit être un entier positif.")

    def nested_payload(name: str, defaults: dict[str, Any]) -> dict[str, Any]:
        value = raw_payload.get(name)
        if isinstance(value, dict):
            return {**defaults, **value}
        return dict(defaults)

    return {
        "idFacture": id_facture,
        "nbResultatsMaximum": _as_positive_int(raw_payload.get("nbResultatsMaximum")) or 10,
        "paramRechercheHistoActionsUtilisateurs": nested_payload(
            "paramRechercheHistoActionsUtilisateurs",
            {
                "nbResultatsParPageListeHistoAction": 10,
                "pageResultatDemandeeListeHistoAction": 1,
                "triColonneListeHistoAction": "HistoActionDateHeure",
                "triSensListeHistoAction": "Descendant",
            },
        ),
        "paramRechercheHistoEvenementsComplementaires": nested_payload(
            "paramRechercheHistoEvenementsComplementaires",
            {
                "nbResultatsParPageListeHistoEvenement": 10,
                "pageResultatDemandeeListeHistoEvenement": 1,
                "triColonneListeHistoEvenement": "EvenementLibelle",
                "triSensListeHistoEvenement": "Descendant",
            },
        ),
        "paramRechercheHistoStatuts": nested_payload(
            "paramRechercheHistoStatuts",
            {
                "nbResultatsParPageListeHistoStatut": 10,
                "pageResultatDemandeeListeHistoStatut": 1,
                "triColonneListeHistoStatut": "HistoStatutDatePassage",
                "triSensListeHistoStatut": "Descendant",
            },
        ),
    }


def _build_correct_validator_payload(raw_payload: dict[str, Any]) -> dict[str, Any]:
    id_facture = _as_positive_int(raw_payload.get("idFacture"))
    if id_facture is None:
        raise ValueError("Le champ idFacture est obligatoire et doit être un entier positif.")

    id_structure = _as_positive_int(raw_payload.get("idStructure"))
    identifiant_structure = _as_non_empty_string(raw_payload.get("identifiantStructure"))
    if id_structure is None and identifiant_structure is None:
        raise ValueError("Renseigne idStructure ou identifiantStructure pour corriger le valideur.")

    type_identifiant = _as_non_empty_string(raw_payload.get("typeIdentifiantStructure")) or "SIRET"
    payload: dict[str, Any] = {
        "idFacture": id_facture,
        "typeIdentifiantStructure": type_identifiant,
    }
    if id_structure is not None:
        payload["idStructure"] = id_structure
    if identifiant_structure is not None:
        payload["identifiantStructure"] = identifiant_structure
    return payload


def _build_reception_consult_payload(identifier: int, *, code_langue: str = "fr") -> dict[str, Any]:
    """Construit le payload canonique pour /factures/v1/consulter/valideur.

    Les blocs de pagination/tri sont systématiquement injectés afin que le
    front n'ait à fournir que `identifiantFactureCPP`.
    """
    return {
        "codeLangue": code_langue,
        "identifiantFactureCPP": identifier,
        "rechercheLignePoste": {
            "nbResultatsParPageLignesPoste": 50,
            "pageResultatDemandeeLignesPoste": 1,
            "triColonneListeLignesPoste": "LignePosteNumero",
            "triSensListeLignesPoste": "Ascendant",
        },
        "rechercheLigneTvaRecap": {
            "nbResultatsParPageListeListeRecapitulatifTVA": 50,
            "pageResultatDemandeeListeRecapitulatifTVA": 1,
            "triColonneListeRecapitulatifTVA": "LigneTvaMontantTvaParTaux",
            "triSensListeRecapitulatifTVA": "Ascendant",
        },
        "recherchePj": {
            "pageResultatDemandeeListePieceJointe": 1,
            "triColonneListePiecesJointes": "PieceJointeTypeCode",
            "triSensListePiecesJointes": "Ascendant",
        },
    }


def _persist_reception_detail_if_available(
    identifier: int,
    *,
    facture: dict[str, Any],
    normalized_invoice: dict[str, Any],
) -> bool:
    if not _DB_ROUTER_AVAILABLE:
        return False
    try:
        from chorus_python.db.config import load_database_settings
        from chorus_python.db.session import get_session
        from chorus_python.db.sync import persist_reception_invoice_detail

        tenant_id = load_database_settings().default_tenant_id
        with get_session() as session:
            return persist_reception_invoice_detail(
                session,
                tenant_id=tenant_id,
                identifier=identifier,
                facture=facture,
                normalized_invoice=normalized_invoice,
            )
    except Exception as error:  # noqa: BLE001
        logger.warning(
            "Réception detail persistence skipped: identifiantFactureCPP=%s, error=%s",
            identifier,
            error,
        )
        return False


def _persist_reception_classification_if_available(
    identifier: int,
    *,
    kind: str,
    reason: str | None = None,
) -> bool:
    if not _DB_ROUTER_AVAILABLE:
        return False
    try:
        from chorus_python.db.config import load_database_settings
        from chorus_python.db.session import get_session
        from chorus_python.db.sync import persist_reception_invoice_classification

        tenant_id = load_database_settings().default_tenant_id
        with get_session() as session:
            return persist_reception_invoice_classification(
                session,
                tenant_id=tenant_id,
                identifier=identifier,
                kind=kind,
                source="reception_consult",
                reason=reason,
            )
    except Exception as error:  # noqa: BLE001
        logger.warning(
            "Réception classification persistence skipped: identifiantFactureCPP=%s, kind=%s, error=%s",
            identifier,
            kind,
            error,
        )
        return False


def _persist_reception_processing_if_available(
    identifier: int,
    *,
    new_status: str,
    response: dict[str, Any] | None,
) -> bool:
    if not _DB_ROUTER_AVAILABLE:
        return False
    try:
        from chorus_python.db.config import load_database_settings
        from chorus_python.db.session import get_session
        from chorus_python.db.sync import persist_reception_invoice_processing

        tenant_id = load_database_settings().default_tenant_id
        with get_session() as session:
            return persist_reception_invoice_processing(
                session,
                tenant_id=tenant_id,
                identifier=identifier,
                new_status=new_status,
                response=response,
            )
    except Exception as error:  # noqa: BLE001
        logger.warning(
            "Réception processing persistence skipped: identifiantFactureCPP=%s, status=%s, error=%s",
            identifier,
            new_status,
            error,
        )
        return False


def _persist_reception_history_status_if_available(
    identifier: int,
    *,
    history_response: dict[str, Any] | None,
) -> bool:
    if not _DB_ROUTER_AVAILABLE or not isinstance(history_response, dict):
        return False
    try:
        from chorus_python.db.config import load_database_settings
        from chorus_python.db.session import get_session
        from chorus_python.db.sync import persist_reception_invoice_history_status

        tenant_id = load_database_settings().default_tenant_id
        with get_session() as session:
            return persist_reception_invoice_history_status(
                session,
                tenant_id=tenant_id,
                identifier=identifier,
                history_response=history_response,
            )
    except Exception as error:  # noqa: BLE001
        logger.warning(
            "Réception history status persistence skipped: idFacture=%s, error=%s",
            identifier,
            error,
        )
        return False


def _consult_single_invoice_for_reception(
    identifier: int,
    *,
    environment_override: str | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Appelle Chorus pour un identifiant et retourne (result_item, api_calls).

    `result_item` est soit un succès `{success: true, identifiantFactureCPP, facture}`,
    soit un échec normalisé `{success: false, identifiantFactureCPP, category, ...}`.
    Aucune exception n'est propagée — l'appelant peut donc itérer en sécurité.
    """
    payload = _build_reception_consult_payload(identifier)
    settings = load_chorus_settings(environment_override=environment_override)
    client = ChorusClient(settings)
    try:
        client.reset_api_calls()
        status_code, chorus_response = client._post_json_raw(
            CHORUS_RECEPTION_CONSULT_PATH,
            payload,
            "Consultation facture réception",
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        normalized = normalize_chorus_error(message)
        persisted = _persist_reception_classification_if_available(
            identifier,
            kind="A_QUALIFIER",
            reason=normalized.human_message,
        )
        return (
            {
                "identifiantFactureCPP": identifier,
                "success": False,
                "classificationPersisted": persisted,
                **normalized.to_dict(),
            },
            list(client.api_calls),
        )

    api_calls = list(client.api_calls)
    if status_code >= 400:
        raw_message = (
            chorus_response.get("libelle")
            if isinstance(chorus_response, dict)
            else chorus_response
        )
        normalized = normalize_chorus_error(
            f"Consultation facture réception échouée ({status_code}): {raw_message}"
        )
        persisted = _persist_reception_classification_if_available(
            identifier,
            kind="REPONSE_FAVORABLE",
            reason=normalized.human_message,
        )
        return (
            {
                "identifiantFactureCPP": identifier,
                "success": False,
                "classificationPersisted": persisted,
                **normalized.to_dict(),
            },
            api_calls,
        )

    code_retour = _as_int(chorus_response.get("codeRetour")) if isinstance(chorus_response, dict) else None

    if code_retour is None or code_retour == 0:
        facture = chorus_response.get("facture") if isinstance(chorus_response, dict) else None
        normalized_invoice = normalize_invoice_for_reception(facture)
        if normalized_invoice is None:
            normalized = normalize_chorus_error(
                "Réponse Chorus inattendue : aucune facture trouvée dans la réponse.",
                code_retour=code_retour,
            )
            persisted = _persist_reception_classification_if_available(
                identifier,
                kind="REPONSE_FAVORABLE",
                reason=normalized.human_message,
            )
            return (
                {
                    "identifiantFactureCPP": identifier,
                    "success": False,
                    "classificationPersisted": persisted,
                    **normalized.to_dict(),
                },
                api_calls,
            )
        if normalized_invoice.get("identifiantFactureCPP") is None:
            normalized_invoice["identifiantFactureCPP"] = identifier
        persisted = _persist_reception_detail_if_available(
            identifier,
            facture=facture,
            normalized_invoice=normalized_invoice,
        )
        return (
            {
                "identifiantFactureCPP": identifier,
                "success": True,
                "facture": normalized_invoice,
                "persisted": persisted,
            },
            api_calls,
        )

    libelle = chorus_response.get("libelle") if isinstance(chorus_response, dict) else None
    normalized = normalize_chorus_error(libelle, code_retour=code_retour)
    persisted = _persist_reception_classification_if_available(
        identifier,
        kind="REPONSE_FAVORABLE",
        reason=normalized.human_message,
    )
    return (
        {
            "identifiantFactureCPP": identifier,
            "success": False,
            "classificationPersisted": persisted,
            **normalized.to_dict(),
        },
        api_calls,
    )


@app.post(RECEPTION_CONSULT_PATH, dependencies=[Depends(require_auth)])
def handle_reception_consult(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    identifier = _as_positive_int(body.get("identifiantFactureCPP"))
    if identifier is None:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "success": False,
                "category": "VALIDATION",
                "human_message": "Le champ identifiantFactureCPP est obligatoire et doit être un entier positif.",
                "raw_message": "identifiantFactureCPP missing or invalid",
                "recommended_action": "Saisir l'identifiant CPP exact retourné par Chorus Pro (ex. 8424327).",
            },
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug(
        "Réception consult start: identifiantFactureCPP=%s, env=%s",
        identifier,
        environment_override or "default",
    )

    item, api_calls = _consult_single_invoice_for_reception(identifier, environment_override=environment_override)
    duration_ms = round((perf_counter() - started_at) * 1000)

    if item.get("success"):
        logger.debug(
            "Réception consult success: identifiantFactureCPP=%s, duration=%s ms",
            identifier,
            duration_ms,
        )
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "success": True,
                "identifiantFactureCPP": identifier,
                "facture": item["facture"],
                "persisted": bool(item.get("persisted")),
                "apiCalls": api_calls,
            },
        )

    logger.warning(
        "Réception consult refusée: identifiantFactureCPP=%s, category=%s, duration=%s ms",
        identifier,
        item.get("category"),
        duration_ms,
    )
    return _json_response(
        HTTPStatus.UNPROCESSABLE_ENTITY,
        {
            "ok": False,
            "success": False,
            "identifiantFactureCPP": identifier,
            **{key: value for key, value in item.items() if key not in {"success", "identifiantFactureCPP"}},
            "apiCalls": api_calls,
        },
    )


@app.post(RECEPTION_CONSULT_BULK_PATH, dependencies=[Depends(require_auth)])
def handle_reception_consult_bulk(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    raw_identifiers = body.get("identifiantsFactureCPP")
    if not isinstance(raw_identifiers, list):
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "success": False,
                "category": "VALIDATION",
                "human_message": "Le champ identifiantsFactureCPP doit être une liste d'entiers positifs.",
                "raw_message": "identifiantsFactureCPP must be a list",
                "recommended_action": "Envoyer { \"identifiantsFactureCPP\": [8424327, 8424328, ...] }.",
            },
        )

    identifiers = coerce_identifier_list(raw_identifiers)
    if not identifiers:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "success": False,
                "category": "VALIDATION",
                "human_message": "Aucun identifiant exploitable dans la requête.",
                "raw_message": "no positive integers parsed from identifiantsFactureCPP",
                "recommended_action": "Vérifier que les identifiants sont des entiers positifs.",
            },
        )

    if len(identifiers) > RECEPTION_BULK_MAX_IDENTIFIERS:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "success": False,
                "category": "VALIDATION",
                "human_message": f"Maximum {RECEPTION_BULK_MAX_IDENTIFIERS} identifiants par requête.",
                "raw_message": f"received {len(identifiers)} identifiers, limit is {RECEPTION_BULK_MAX_IDENTIFIERS}",
                "recommended_action": f"Découper la liste en lots de {RECEPTION_BULK_MAX_IDENTIFIERS} maximum.",
            },
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug(
        "Réception bulk consult start: count=%s, env=%s",
        len(identifiers),
        environment_override or "default",
    )

    items: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    all_api_calls: list[dict[str, Any]] = []
    total_success = 0
    total_failed = 0

    for identifier in identifiers:
        item, api_calls = _consult_single_invoice_for_reception(
            identifier,
            environment_override=environment_override,
        )
        all_api_calls.extend(api_calls)
        if item.get("success"):
            total_success += 1
            items.append(item)
        else:
            total_failed += 1
            errors.append(item)

    duration_ms = round((perf_counter() - started_at) * 1000)
    logger.debug(
        "Réception bulk consult done: requested=%s, success=%s, failed=%s, duration=%s ms",
        len(identifiers),
        total_success,
        total_failed,
        duration_ms,
    )

    return _json_response(
        HTTPStatus.OK,
        {
            "ok": True,
            "success": True,
            "totalRequested": len(identifiers),
            "totalSuccess": total_success,
            "totalFailed": total_failed,
            "items": items,
            "errors": errors,
            "apiCalls": all_api_calls,
        },
    )


def _build_reception_process_payload(body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Construit le payload `/v1/traiter/recue` ou retourne une erreur structurée.

    `body` est le corps envoyé par le frontend (camelCase libre). En sortie :
    - (payload, None) si tout est bon ;
    - ({}, error_dict) sinon (l'appelant renvoie 400 avec error_dict).
    """
    id_facture = _as_positive_int(body.get("idFacture") or body.get("identifiantFactureCPP"))
    if id_facture is None:
        return {}, {
            "category": "VALIDATION",
            "human_message": "Le champ idFacture est obligatoire et doit être un entier positif.",
            "raw_message": "idFacture missing or invalid",
            "recommended_action": "Renseigner l'identifiant Chorus de la facture à traiter (ex. 8429592).",
        }

    raw_status = _as_non_empty_string(body.get("nouveauStatut"))
    if not raw_status:
        return {}, {
            "category": "VALIDATION",
            "human_message": "Le champ nouveauStatut est obligatoire.",
            "raw_message": "nouveauStatut missing",
            "recommended_action": (
                "Sélectionner un statut parmi : "
                + ", ".join(sorted(RECEPTION_PROCESS_ALLOWED_STATUTS))
            ),
        }
    nouveau_statut = raw_status.upper()
    if nouveau_statut not in RECEPTION_PROCESS_ALLOWED_STATUTS:
        return {}, {
            "category": "VALIDATION",
            "human_message": f"Statut '{nouveau_statut}' non autorisé pour cette action.",
            "raw_message": f"nouveauStatut={nouveau_statut} not in allowed set",
            "recommended_action": (
                "Choisir parmi : " + ", ".join(sorted(RECEPTION_PROCESS_ALLOWED_STATUTS))
            ),
        }

    motif = _as_non_empty_string(body.get("motif"))
    if nouveau_statut in RECEPTION_PROCESS_MOTIF_REQUIRED and not motif:
        return {}, {
            "category": "VALIDATION",
            "human_message": (
                "Un motif est obligatoire pour passer la facture en REJETEE ou SUSPENDUE."
            ),
            "raw_message": "motif required for REJETEE/SUSPENDUE",
            "recommended_action": "Renseigner un motif clair et précis dans le champ Motif.",
        }

    numero_dp_mandat = _as_non_empty_string(body.get("numeroDPMandat") or body.get("numeroDpMandat"))
    id_utilisateur = _as_positive_int(body.get("idUtilisateurCourant"))

    payload: dict[str, Any] = {
        "idFacture": id_facture,
        "nouveauStatut": nouveau_statut,
    }
    if motif:
        payload["motif"] = motif
    if numero_dp_mandat:
        payload["numeroDPMandat"] = numero_dp_mandat
    if id_utilisateur is not None:
        payload["idUtilisateurCourant"] = id_utilisateur

    return payload, None


def _build_reception_complete_payload(body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Construit le payload `/v1/completer` pour une facture suspendue."""
    identifier = _as_positive_int(body.get("identifiantFactureCPP") or body.get("idFacture"))
    if identifier is None:
        return {}, {
            "category": "VALIDATION",
            "human_message": "Le champ identifiantFactureCPP est obligatoire et doit être un entier positif.",
            "raw_message": "identifiantFactureCPP missing or invalid",
            "recommended_action": "Ouvrir une facture suspendue valide puis réessayer.",
        }

    commentaire = _as_non_empty_string(body.get("commentaire"))
    raw_attachments = body.get("pieceJointeComplementaire")
    attachments: list[dict[str, Any]] = []
    if raw_attachments is not None:
        if not isinstance(raw_attachments, list):
            return {}, {
                "category": "VALIDATION",
                "human_message": "Le champ pieceJointeComplementaire doit être une liste.",
                "raw_message": "pieceJointeComplementaire is not a list",
                "recommended_action": "Sélectionner une ou plusieurs pièces jointes complémentaires connues.",
            }
        for index, item in enumerate(raw_attachments):
            if not isinstance(item, dict):
                return {}, {
                    "category": "VALIDATION",
                    "human_message": f"La pièce jointe complémentaire #{index + 1} est invalide.",
                    "raw_message": f"pieceJointeComplementaire[{index}] is not an object",
                    "recommended_action": "Vérifier les pièces jointes sélectionnées.",
                }
            attachment_id = _as_positive_int(item.get("pieceJointeComplementaireId"))
            designation = _as_non_empty_string(item.get("pieceJointeComplementaireDesignation"))
            attachment_type = _as_non_empty_string(item.get("pieceJointeComplementaireType"))
            line_number = _as_int(item.get("pieceJointeComplementaireNumeroLigneFacture"))
            if attachment_id is None:
                return {}, {
                    "category": "VALIDATION",
                    "human_message": f"L'identifiant de la pièce jointe complémentaire #{index + 1} est obligatoire.",
                    "raw_message": f"pieceJointeComplementaire[{index}].pieceJointeComplementaireId missing",
                    "recommended_action": "Choisir une pièce jointe déjà connue par Chorus.",
                }
            if not designation:
                return {}, {
                    "category": "VALIDATION",
                    "human_message": f"La désignation de la pièce jointe complémentaire #{index + 1} est obligatoire.",
                    "raw_message": f"pieceJointeComplementaire[{index}].pieceJointeComplementaireDesignation missing",
                    "recommended_action": "Renseigner une désignation claire.",
                }
            if not attachment_type:
                return {}, {
                    "category": "VALIDATION",
                    "human_message": f"Le type de la pièce jointe complémentaire #{index + 1} est obligatoire.",
                    "raw_message": f"pieceJointeComplementaire[{index}].pieceJointeComplementaireType missing",
                    "recommended_action": "Renseigner le type de pièce jointe attendu par Chorus.",
                }
            attachment: dict[str, Any] = {
                "pieceJointeComplementaireId": attachment_id,
                "pieceJointeComplementaireDesignation": designation,
                "pieceJointeComplementaireType": attachment_type,
            }
            if line_number is not None:
                attachment["pieceJointeComplementaireNumeroLigneFacture"] = line_number
            attachments.append(attachment)

    if not commentaire and not attachments:
        return {}, {
            "category": "VALIDATION",
            "human_message": "Ajouter au moins un commentaire ou une pièce jointe complémentaire.",
            "raw_message": "commentaire and pieceJointeComplementaire both empty",
            "recommended_action": "Saisir un commentaire ou sélectionner une pièce jointe déjà connue.",
        }

    payload: dict[str, Any] = {"identifiantFactureCPP": identifier}
    if commentaire:
        payload["commentaire"] = commentaire
    id_utilisateur = _as_positive_int(body.get("idUtilisateurCourant"))
    if id_utilisateur is not None:
        payload["idUtilisateurCourant"] = id_utilisateur
    if attachments:
        payload["pieceJointeComplementaire"] = attachments
    return payload, None


def _build_reception_complete_uploaded_attachment(
    item: dict[str, Any],
    *,
    upload_id: int,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    designation = _as_non_empty_string(item.get("designation") or item.get("name"))
    attachment_type = _as_non_empty_string(item.get("type")) or "DIVERS"
    line_number = _as_int(item.get("lineNumber"))
    if not designation:
        return {}, {
            "category": "VALIDATION",
            "human_message": "La désignation de la pièce jointe uploadée est obligatoire.",
            "raw_message": "attachmentFiles[].designation missing",
            "recommended_action": "Renseigner une désignation ou choisir un fichier nommé correctement.",
        }
    attachment: dict[str, Any] = {
        "pieceJointeComplementaireId": upload_id,
        "pieceJointeComplementaireDesignation": designation,
        "pieceJointeComplementaireType": attachment_type,
    }
    if line_number is not None:
        attachment["pieceJointeComplementaireNumeroLigneFacture"] = line_number
    return attachment, None


def _upload_reception_complete_attachments(
    client: ChorusClient,
    raw_files: Any,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    if raw_files in (None, ""):
        return [], None
    if not isinstance(raw_files, list):
        return [], {
            "category": "VALIDATION",
            "human_message": "Le champ attachmentFiles doit être une liste.",
            "raw_message": "attachmentFiles is not a list",
            "recommended_action": "Joindre un ou plusieurs fichiers complémentaires valides.",
        }

    attachments: list[dict[str, Any]] = []
    for index, item in enumerate(raw_files):
        if not isinstance(item, dict):
            return [], {
                "category": "VALIDATION",
                "human_message": f"Le fichier complémentaire #{index + 1} est invalide.",
                "raw_message": f"attachmentFiles[{index}] is not an object",
                "recommended_action": "Vérifier les fichiers joints.",
            }
        file_name = _as_non_empty_string(item.get("name"))
        file_base64 = _as_non_empty_string(item.get("base64"))
        if not file_name or not file_base64:
            return [], {
                "category": "VALIDATION",
                "human_message": f"Le fichier complémentaire #{index + 1} est incomplet.",
                "raw_message": f"attachmentFiles[{index}].name/base64 missing",
                "recommended_action": "Sélectionner à nouveau le fichier complémentaire.",
            }
        upload_result = client.upload_attachment_content(
            file_name=file_name,
            file_base64=file_base64,
            mime_type=_as_non_empty_string(item.get("mimeType")) or "application/octet-stream",
        )
        attachment, error = _build_reception_complete_uploaded_attachment(
            item,
            upload_id=upload_result.piece_jointe_id,
        )
        if error is not None:
            return [], error
        attachments.append(attachment)

    return attachments, None


@app.post(RECEPTION_PROCESS_PATH, dependencies=[Depends(require_auth)])
def handle_reception_process(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    payload, validation_error = _build_reception_process_payload(body)
    if validation_error is not None:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"ok": False, "success": False, **validation_error},
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug(
        "Traitement facture reçue start: idFacture=%s, nouveauStatut=%s, env=%s",
        payload["idFacture"],
        payload["nouveauStatut"],
        environment_override or "default",
    )

    settings = load_chorus_settings(environment_override=environment_override)
    client = ChorusClient(settings)
    try:
        client.reset_api_calls()
        status_code, chorus_response = client._post_json_raw(
            CHORUS_TRAITER_RECUE_PATH,
            payload,
            "Traitement facture reçue",
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = list(client.api_calls)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.warning(
            "Traitement facture reçue error: idFacture=%s, duration=%s ms, error=%s",
            payload["idFacture"],
            duration_ms,
            message,
        )
        normalized = normalize_chorus_error(message)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "payload": payload,
                "apiCalls": api_calls,
            },
        )

    api_calls = list(client.api_calls)
    code_retour = _as_int(chorus_response.get("codeRetour")) if isinstance(chorus_response, dict) else None
    libelle = chorus_response.get("libelle") if isinstance(chorus_response, dict) else None

    if status_code >= 400 or (code_retour is not None and code_retour != 0):
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.warning(
            "Traitement facture reçue refusé: idFacture=%s, codeRetour=%s, status=%s, duration=%s ms",
            payload["idFacture"],
            code_retour,
            status_code,
            duration_ms,
        )
        normalized = normalize_chorus_error(libelle, code_retour=code_retour)
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "payload": payload,
                "response": chorus_response,
                "apiCalls": api_calls,
            },
        )

    duration_ms = round((perf_counter() - started_at) * 1000)
    logger.debug(
        "Traitement facture reçue success: idFacture=%s, nouveauStatut=%s, duration=%s ms",
        payload["idFacture"],
        payload["nouveauStatut"],
        duration_ms,
    )
    processed_persisted = _persist_reception_processing_if_available(
        payload["idFacture"],
        new_status=payload["nouveauStatut"],
        response=chorus_response if isinstance(chorus_response, dict) else None,
    )
    return _json_response(
        HTTPStatus.OK,
        {
            "ok": True,
            "success": True,
            "payload": payload,
            "response": chorus_response,
            "processedPersisted": processed_persisted,
            "apiCalls": api_calls,
        },
    )


@app.post(RECEPTION_COMPLETE_PATH, dependencies=[Depends(require_auth)])
def handle_reception_complete(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    settings = load_chorus_settings(environment_override=environment_override)
    client = ChorusClient(settings)
    client.reset_api_calls()

    try:
        uploaded_attachments, upload_error = _upload_reception_complete_attachments(
            client,
            body.get("attachmentFiles"),
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        normalized = normalize_chorus_error(message)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "apiCalls": list(client.api_calls),
            },
        )
    if upload_error is not None:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"ok": False, "success": False, **upload_error},
        )
    if uploaded_attachments:
        existing_attachments = body.get("pieceJointeComplementaire")
        if isinstance(existing_attachments, list):
            body = {
                **body,
                "pieceJointeComplementaire": [*existing_attachments, *uploaded_attachments],
            }
        else:
            body = {
                **body,
                "pieceJointeComplementaire": uploaded_attachments,
            }

    payload, validation_error = _build_reception_complete_payload(body)
    if validation_error is not None:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"ok": False, "success": False, **validation_error},
        )

    identifier = payload["identifiantFactureCPP"]
    logger.debug(
        "Complément facture suspendue start: identifiantFactureCPP=%s, hasComment=%s, pjCount=%s, env=%s",
        identifier,
        "commentaire" in payload,
        len(payload.get("pieceJointeComplementaire", [])),
        environment_override or "default",
    )

    try:
        status_code, chorus_response = client._post_json_raw(
            CHORUS_COMPLETER_FACTURE_PATH,
            payload,
            "Complément facture suspendue",
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        normalized = normalize_chorus_error(message)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.warning(
            "Complément facture suspendue error: identifiantFactureCPP=%s, duration=%s ms, error=%s",
            identifier,
            duration_ms,
            message,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "payload": payload,
                "apiCalls": list(client.api_calls),
            },
        )

    api_calls = list(client.api_calls)
    code_retour = _as_int(chorus_response.get("codeRetour")) if isinstance(chorus_response, dict) else None
    libelle = chorus_response.get("libelle") if isinstance(chorus_response, dict) else None
    if status_code >= 400 or (code_retour is not None and code_retour != 0):
        normalized = normalize_chorus_error(libelle if libelle is not None else chorus_response, code_retour=code_retour)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.warning(
            "Complément facture suspendue refusé: identifiantFactureCPP=%s, codeRetour=%s, status=%s, duration=%s ms",
            identifier,
            code_retour,
            status_code,
            duration_ms,
        )
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "payload": payload,
                "response": chorus_response,
                "apiCalls": api_calls,
            },
        )

    duration_ms = round((perf_counter() - started_at) * 1000)
    logger.debug(
        "Complément facture suspendue success: identifiantFactureCPP=%s, duration=%s ms",
        identifier,
        duration_ms,
    )
    response_record = chorus_response if isinstance(chorus_response, dict) else {}
    return _json_response(
        HTTPStatus.OK,
        {
            "ok": True,
            "success": True,
            "identifiantFactureCPP": _as_int(response_record.get("identifiantFactureCPP")) or identifier,
            "numeroFacture": _as_non_empty_string(response_record.get("numeroFacture")),
            "dateTraitement": _as_non_empty_string(response_record.get("dateTraitement")),
            "libelle": _as_non_empty_string(response_record.get("libelle")),
            "payload": payload,
            "raw": response_record,
            "apiCalls": api_calls,
        },
    )


def _build_telecharger_groupe_payload(
    body: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Construit le payload `/v1/telecharger/groupe` ou retourne une erreur structurée.

    Supporte soit `idFacture` (un seul), soit `listeFacture: [{idFacture: ...}]`
    pour rester aligné avec le contrat Chorus (multi-factures).
    """
    raw_list = body.get("listeFacture")
    liste_facture: list[dict[str, int]] = []
    raw_invoice_ids = body.get("invoiceIds")
    if isinstance(raw_invoice_ids, list):
        for item in raw_invoice_ids:
            parsed = _as_positive_int(item)
            if parsed is not None:
                liste_facture.append({"idFacture": parsed})
    if isinstance(raw_list, list):
        for item in raw_list:
            if isinstance(item, dict):
                parsed = _as_positive_int(item.get("idFacture"))
                if parsed is not None:
                    liste_facture.append({"idFacture": parsed})
    if not liste_facture:
        single = _as_positive_int(body.get("idFacture") or body.get("identifiantFactureCPP"))
        if single is not None:
            liste_facture = [{"idFacture": single}]
    if not liste_facture:
        return {}, {
            "category": "VALIDATION",
            "human_message": "Le champ idFacture (ou listeFacture) est obligatoire.",
            "raw_message": "no idFacture provided",
            "recommended_action": "Fournir invoiceIds, idFacture ou listeFacture.",
        }

    raw_format = _as_non_empty_string(body.get("format")) or "PDF"
    requested_format = raw_format.upper()
    if requested_format not in RECEPTION_DOWNLOAD_FORMATS:
        return {}, {
            "category": "VALIDATION",
            "human_message": f"Format '{requested_format}' non supporté.",
            "raw_message": f"format={requested_format} not in {sorted(RECEPTION_DOWNLOAD_FORMATS)}",
            "recommended_action": "Choisir parmi : PDF, XML, PIVOT, ZIP.",
        }
    format_value = RECEPTION_DOWNLOAD_CHORUS_FORMAT_BY_REQUEST[requested_format]

    with_attachments_raw = (
        body.get("avecPiecesJointesComplementaires")
        if "avecPiecesJointesComplementaires" in body
        else body.get("withComplementaryAttachments")
    )
    default_with_attachments = requested_format in {"ZIP", "ZIP_WITH_ATTACHMENTS"}
    if isinstance(with_attachments_raw, bool):
        avec_pj = "Oui" if with_attachments_raw else "Non"
    elif isinstance(with_attachments_raw, str):
        normalized = with_attachments_raw.strip().lower()
        avec_pj = "Non" if normalized in {"false", "0", "non", "no"} else "Oui"
    else:
        avec_pj = "Oui" if default_with_attachments else "Non"

    payload: dict[str, Any] = {
        "format": format_value,
        "listeFacture": liste_facture,
        "avecPiecesJointesComplementaires": avec_pj,
    }

    id_espace = _as_positive_int(body.get("idEspace"))
    if id_espace is not None:
        payload["idEspace"] = id_espace
    id_user = _as_positive_int(body.get("idUtilisateurCourant"))
    if id_user is not None:
        payload["idUtilisateurCourant"] = id_user

    return payload, None


@app.post(INVOICE_DOWNLOAD_PATH, dependencies=[Depends(require_auth)])
@app.post(RECEPTION_DOWNLOAD_PATH, dependencies=[Depends(require_auth)])
def handle_reception_download(body: dict[str, Any] | None = Body(default=None)) -> Response:
    body = body or {}
    payload, validation_error = _build_telecharger_groupe_payload(body)
    if validation_error is not None:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {"ok": False, "success": False, **validation_error},
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    id_facture_first = payload["listeFacture"][0]["idFacture"]
    logger.debug(
        "Téléchargement groupe start: idFacture=%s, format=%s, avecPJ=%s, env=%s",
        id_facture_first,
        payload["format"],
        payload["avecPiecesJointesComplementaires"],
        environment_override or "default",
    )

    settings = load_chorus_settings(environment_override=environment_override)
    client = ChorusClient(settings)
    try:
        client.reset_api_calls()
        status_code, chorus_response = client._post_json_raw(
            CHORUS_TELECHARGER_GROUPE_PATH,
            payload,
            "Téléchargement groupe facture",
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        normalized = normalize_chorus_error(message)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.warning(
            "Téléchargement groupe error: idFacture=%s, duration=%s ms, error=%s",
            id_facture_first,
            duration_ms,
            message,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "payload": payload,
                "apiCalls": list(client.api_calls),
            },
        )

    api_calls = list(client.api_calls)
    code_retour = chorus_response.get("codeRetour") if isinstance(chorus_response, dict) else None
    libelle = chorus_response.get("libelle") if isinstance(chorus_response, dict) else None

    # 413 = dossier > 120 Mo. On expose un message dédié au lieu du normalizer générique.
    if status_code == 413:
        logger.warning(
            "Téléchargement groupe refusé (413 Payload Too Large): idFacture=%s",
            id_facture_first,
        )
        return _json_response(
            HTTPStatus.PAYLOAD_TOO_LARGE,
            {
                "ok": False,
                "success": False,
                "category": "VALIDATION",
                "human_message": "Le dossier dépasse 120 Mo : Chorus refuse le téléchargement groupé.",
                "raw_message": "HTTP 413 — dossier > 120 Mo",
                "recommended_action": (
                    "Demander un format moins lourd (XML seul) ou télécharger les factures une par une."
                ),
                "payload": payload,
                "response": chorus_response,
                "apiCalls": api_calls,
            },
        )

    if status_code >= 400 or (code_retour is not None and code_retour != 0):
        normalized = normalize_chorus_error(libelle, code_retour=code_retour)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.warning(
            "Téléchargement groupe refusé: idFacture=%s, codeRetour=%s, status=%s, duration=%s ms",
            id_facture_first,
            code_retour,
            status_code,
            duration_ms,
        )
        return _json_response(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "ok": False,
                "success": False,
                **normalized.to_dict(),
                "payload": payload,
                "response": chorus_response,
                "apiCalls": api_calls,
            },
        )

    file_b64 = chorus_response.get("fichierResultat") if isinstance(chorus_response, dict) else None
    if not isinstance(file_b64, str) or not file_b64.strip():
        logger.warning(
            "Téléchargement groupe : fichierResultat manquant pour idFacture=%s",
            id_facture_first,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "success": False,
                "category": "UNKNOWN",
                "human_message": "Chorus n'a pas renvoyé de fichier exploitable.",
                "raw_message": "fichierResultat missing or empty",
                "recommended_action": "Réessayer ; si le problème persiste, signaler le cas avec l'idFacture concerné.",
                "payload": payload,
                "response": chorus_response,
                "apiCalls": api_calls,
            },
        )

    try:
        file_bytes = base64.b64decode(file_b64, validate=False)
    except (ValueError, base64.binascii.Error) as decode_error:  # type: ignore[attr-defined]
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "success": False,
                "category": "UNKNOWN",
                "human_message": "Fichier Chorus illisible (base64 invalide).",
                "raw_message": str(decode_error),
                "recommended_action": "Réessayer ultérieurement.",
                "payload": payload,
                "apiCalls": api_calls,
            },
        )

    requested_format = (_as_non_empty_string(body.get("format")) or "PDF").upper()
    mime, suffix = RECEPTION_DOWNLOAD_MIME_BY_FORMAT.get(
        requested_format, ("application/octet-stream", "bin")
    )
    filename = (
        f"chorus-factures.{suffix}"
        if len(payload["listeFacture"]) > 1
        else f"chorus-facture-{id_facture_first}.{suffix}"
    )
    duration_ms = round((perf_counter() - started_at) * 1000)
    logger.debug(
        "Téléchargement groupe success: idFacture=%s, format=%s, bytes=%s, duration=%s ms",
        id_facture_first,
        payload["format"],
        len(file_bytes),
        duration_ms,
    )

    return Response(
        content=file_bytes,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Chorus-Code-Retour": str(code_retour) if code_retour is not None else "0",
            "X-Chorus-Libelle": libelle or "",
            "X-Chorus-Format": str(payload["format"]),
        },
    )


@app.post(INVOICE_HISTORY_PATH, dependencies=[Depends(require_auth)])
def handle_invoice_history(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    raw_payload = body.get("payload")
    if raw_payload is None:
        raw_payload = {
            key: value
            for key, value in body.items()
            if key not in {"environment", "chorusEnv", "env"}
        }
    if not isinstance(raw_payload, dict):
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": "Le champ payload doit être un objet JSON.",
            },
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)

    try:
        payload = _build_invoice_history_payload(raw_payload)
    except ValueError as error:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": str(error),
            },
        )

    logger.debug(
        "Consultation historique facture start: idFacture=%s, env=%s",
        payload.get("idFacture"),
        environment_override or "default",
    )

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        service = ChorusSubmissionService(settings)
        result = service.consult_invoice_history(payload)
        history_response = result.get("response") if isinstance(result, dict) else None
        history_status_persisted = _persist_reception_history_status_if_available(
            payload["idFacture"],
            history_response=history_response if isinstance(history_response, dict) else None,
        )
        if isinstance(result, dict):
            result = {
                **result,
                "historyStatusPersisted": history_status_persisted,
            }
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Consultation historique facture success: idFacture=%s, duration=%s ms",
            payload.get("idFacture"),
            duration_ms,
        )
        return _json_response(HTTPStatus.OK, result)
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = []
        if "service" in locals():
            api_calls = list(service.client.api_calls)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Consultation historique facture error: idFacture=%s, duration=%s ms, error=%s",
            payload.get("idFacture"),
            duration_ms,
            message,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )


@app.post(SIRET_INFO_PATH, dependencies=[Depends(require_auth)])
def handle_siret_info(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    raw_siret = body.get("siretStructure") or body.get("siret")
    if not isinstance(raw_siret, str) or not raw_siret.strip():
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": "Le champ siretStructure est obligatoire.",
            },
        )

    siret_structure = "".join(character for character in raw_siret if character.isdigit())
    if not siret_structure:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": "Le champ siretStructure doit contenir des chiffres.",
            },
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug("Consultation SIRET start: siret=%s, env=%s", siret_structure, environment_override or "default")

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        client = ChorusClient(settings)
        response_body = client.consult_siret_information(siret_structure)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Consultation SIRET success: siret=%s, duration=%s ms", siret_structure, duration_ms)
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "siretStructure": siret_structure,
                "info": response_body,
                "apiCalls": client.api_calls,
            },
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = list(client.api_calls) if "client" in locals() else []
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Consultation SIRET error: siret=%s, duration=%s ms, error=%s",
            siret_structure,
            duration_ms,
            message,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )


@app.post(ACTIVE_RECIPIENT_STRUCTURES_PATH, dependencies=[Depends(require_auth)])
def handle_active_recipient_structures(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug("Structures actives destinataire start (env=%s)", environment_override or "default")

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        client = ChorusClient(settings)
        preferred_supplier_id = _as_positive_int(body.get("idFournisseur")) or _as_positive_int(settings.default_supplier_id)
        supplier_id, structures, response_body = _resolve_supplier_id_from_active_recipient_structures(
            client,
            preferred_supplier_id=preferred_supplier_id,
        )
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Structures actives destinataire success: supplier=%s, structures=%s, duration=%s ms",
            supplier_id,
            len(structures),
            duration_ms,
        )
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "idFournisseur": supplier_id,
                "idStructureCPP": supplier_id,
                "structures": structures,
                "rawResponse": response_body,
                "apiCalls": client.api_calls,
            },
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = list(client.api_calls) if "client" in locals() else []
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Structures actives destinataire error: duration=%s ms, error=%s", duration_ms, message)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )


@app.post(SYNC_ANNUAIRE_PATH, dependencies=[Depends(require_auth)])
def handle_sync_annuaire(body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug("Synchronisation annuaire start (env=%s)", environment_override or "default")

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        client = ChorusClient(settings)
        response_body = client.download_destinataires_annuaire()
        build_result = build_annuaire_files_from_api_response(response_body)
        metadata = build_result.payload.get("metadata", {})
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Synchronisation annuaire success: structures=%s, services=%s, duration=%s ms",
            metadata.get("structureCount"),
            metadata.get("serviceCount"),
            duration_ms,
        )
        return _json_response(
            HTTPStatus.OK,
            {
                "ok": True,
                "codeRetour": response_body.get("codeRetour") if isinstance(response_body, dict) else None,
                "libelle": response_body.get("libelle") if isinstance(response_body, dict) else None,
                "generatedAt": metadata.get("generatedAt"),
                "sourceFile": metadata.get("sourceFile"),
                "structureCount": metadata.get("structureCount", 0),
                "serviceCount": metadata.get("serviceCount", 0),
                "jsonPath": relative_to_repo(build_result.json_path),
                "xmlPath": relative_to_repo(build_result.xml_path),
                "apiCalls": client.api_calls,
            },
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = list(client.api_calls) if "client" in locals() else []
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug("Synchronisation annuaire error: duration=%s ms, error=%s", duration_ms, message)
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )


@app.post(SUBMIT_PATH)
def handle_submit(
    request: Request,
    body: dict[str, Any] | None = Body(default=None),
    auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    audit_started_at = perf_counter()
    body = body or {}
    _print_received_post_debug(SUBMIT_PATH, body)
    payload = body.get("payload")
    main_file = body.get("mainFile")
    attachments = body.get("attachments") or []

    if not isinstance(payload, dict):
        error_message = "Le champ payload est obligatoire et doit être un objet JSON."
        return _audit_submit_response(
            request,
            user=auth_user,
            payload=None,
            http_status=HTTPStatus.BAD_REQUEST,
            response_payload={"ok": False, "error": error_message},
            started_at=audit_started_at,
            error_message=error_message,
        )

    if main_file is not None and not isinstance(main_file, dict):
        error_message = "Le champ mainFile doit être un objet JSON s'il est fourni."
        return _audit_submit_response(
            request,
            user=auth_user,
            payload=payload,
            http_status=HTTPStatus.BAD_REQUEST,
            response_payload={"ok": False, "error": error_message},
            started_at=audit_started_at,
            error_message=error_message,
        )

    if not isinstance(attachments, list):
        error_message = "Le champ attachments doit être une liste JSON s'il est fourni."
        return _audit_submit_response(
            request,
            user=auth_user,
            payload=payload,
            http_status=HTTPStatus.BAD_REQUEST,
            response_payload={"ok": False, "error": error_message},
            started_at=audit_started_at,
            error_message=error_message,
        )

    invalid_attachment = next((item for item in attachments if not isinstance(item, dict)), None)
    if invalid_attachment is not None:
        error_message = "Chaque pièce jointe complémentaire doit être un objet JSON."
        return _audit_submit_response(
            request,
            user=auth_user,
            payload=payload,
            http_status=HTTPStatus.BAD_REQUEST,
            response_payload={"ok": False, "error": error_message},
            started_at=audit_started_at,
            error_message=error_message,
        )

    state_provided, raw_current_state = extract_payment_request_state(body)
    if state_provided:
        try:
            validate_payment_request_state(raw_current_state)
        except InvalidPaymentRequestStateError as state_error:
            logger.warning(
                "Soumission bloquée: endpoint=%s, numero=%s, état=%s, motif=%s",
                SUBMIT_PATH,
                payload.get("numeroFactureSaisi"),
                state_error.current_state,
                state_error.reason,
            )
            response_payload = {
                "ok": False,
                "error": str(state_error),
                **state_error.to_error_payload(),
            }
            return _audit_submit_response(
                request,
                user=auth_user,
                payload=payload,
                http_status=HTTPStatus.UNPROCESSABLE_ENTITY,
                response_payload=response_payload,
                started_at=audit_started_at,
                error_message=str(state_error),
            )

    payload = _add_submitter_comment(payload, auth_user)
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug(
        "Soumission start: numero=%s, mainFile=%s, attachments=%s, env=%s",
        payload.get("numeroFactureSaisi"),
        isinstance(main_file, dict),
        len(attachments),
        environment_override or "default",
    )

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        service = ChorusSubmissionService(settings)
        result = service.submit_prepared_payload(
            payload,
            main_file=main_file,
            attachments=attachments,
        )
        result["externalId"] = _extract_external_id(result.get("response"))
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Soumission success: numero=%s, externalId=%s, duration=%s ms",
            payload.get("numeroFactureSaisi"),
            result.get("externalId"),
            duration_ms,
        )
        return _audit_submit_response(
            request,
            user=auth_user,
            payload=payload,
            http_status=HTTPStatus.OK,
            response_payload=result,
            started_at=audit_started_at,
            result=result,
        )
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = []
        if "service" in locals():
            api_calls = list(service.client.api_calls)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Soumission error: numero=%s, duration=%s ms, error=%s",
            payload.get("numeroFactureSaisi"),
            duration_ms,
            message,
        )

        return _audit_submit_response(
            request,
            user=auth_user,
            payload=payload,
            http_status=HTTPStatus.BAD_GATEWAY,
            response_payload={
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
            started_at=audit_started_at,
            error_message=message,
        )


@app.post(RECYCLE_PATH)
def handle_recycle(
    request: Request,
    body: dict[str, Any] | None = Body(default=None),
    auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    body = body or {}
    _print_received_post_debug(RECYCLE_PATH, body)
    payload = body.get("payload")

    if not isinstance(payload, dict):
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": "Le champ payload est obligatoire et doit être un objet JSON.",
            },
        )

    payload = _add_submitter_comment(payload, auth_user)
    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug(
        "Recyclage start: identifiantFactureCPP=%s, env=%s",
        payload.get("identifiantFactureCPP"),
        environment_override or "default",
    )

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        service = ChorusSubmissionService(settings)
        result = service.recycle_invoice(payload)
        result["externalId"] = _extract_external_id(result.get("response"))
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Recyclage success: identifiantFactureCPP=%s, externalId=%s, duration=%s ms",
            payload.get("identifiantFactureCPP"),
            result.get("externalId"),
            duration_ms,
        )
        _audit_chorus_operation(
            request,
            action="invoice.recycle",
            user=auth_user,
            payload=payload,
            status="success",
            http_status=HTTPStatus.OK,
            started_at=started_at,
            result=result,
        )
        return _json_response(HTTPStatus.OK, result)
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = []
        if "service" in locals():
            api_calls = list(service.client.api_calls)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Recyclage error: identifiantFactureCPP=%s, duration=%s ms, error=%s",
            payload.get("identifiantFactureCPP"),
            duration_ms,
            message,
        )
        _audit_chorus_operation(
            request,
            action="invoice.recycle",
            user=auth_user,
            payload=payload,
            status="failed",
            http_status=HTTPStatus.BAD_GATEWAY,
            started_at=started_at,
            error_message=message,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )


@app.post(CORRECT_VALIDATOR_PATH)
def handle_correct_validator(
    request: Request,
    body: dict[str, Any] | None = Body(default=None),
    auth_user: dict[str, Any] = Depends(require_submit_permission),
) -> JSONResponse:
    body = body or {}
    _print_received_post_debug(CORRECT_VALIDATOR_PATH, body)
    raw_payload = body.get("payload")

    if not isinstance(raw_payload, dict):
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": "Le champ payload est obligatoire et doit être un objet JSON.",
            },
        )

    try:
        payload = _build_correct_validator_payload(raw_payload)
    except ValueError as error:
        return _json_response(
            HTTPStatus.BAD_REQUEST,
            {
                "ok": False,
                "error": str(error),
            },
        )

    started_at = perf_counter()
    environment_override = _extract_environment_override(body)
    logger.debug(
        "Correction valideur start: idFacture=%s, idStructure=%s, identifiantStructure=%s, env=%s",
        payload.get("idFacture"),
        payload.get("idStructure"),
        payload.get("identifiantStructure"),
        environment_override or "default",
    )

    try:
        settings = load_chorus_settings(environment_override=environment_override)
        service = ChorusSubmissionService(settings)
        result = service.correct_invoice_validator(payload)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Correction valideur success: idFacture=%s, duration=%s ms",
            payload.get("idFacture"),
            duration_ms,
        )
        _audit_chorus_operation(
            request,
            action="invoice.validator.correct",
            user=auth_user,
            payload=payload,
            status="success",
            http_status=HTTPStatus.OK,
            started_at=started_at,
            result=result,
        )
        return _json_response(HTTPStatus.OK, result)
    except Exception as error:  # noqa: BLE001
        message = str(error) or error.__class__.__name__
        api_calls = []
        if "service" in locals():
            api_calls = list(service.client.api_calls)
        duration_ms = round((perf_counter() - started_at) * 1000)
        logger.debug(
            "Correction valideur error: idFacture=%s, duration=%s ms, error=%s",
            payload.get("idFacture"),
            duration_ms,
            message,
        )
        _audit_chorus_operation(
            request,
            action="invoice.validator.correct",
            user=auth_user,
            payload=payload,
            status="failed",
            http_status=HTTPStatus.BAD_GATEWAY,
            started_at=started_at,
            error_message=message,
        )
        return _json_response(
            HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            },
        )



def main() -> int:
    logging.basicConfig(level=os.environ.get("CHORUS_LOG_LEVEL", "INFO").upper())
    print(f"Python executable: {sys.executable}")
    print(f"Repository root:    {REPO_ROOT}")
    print(f"FastAPI listening on http://{HOST}:{PORT}")
    print(f"  - OAuth token: {OAUTH_TOKEN_PATH}")
    print(f"  - Submit:      {SUBMIT_PATH}")
    print(f"  - Flux:        /api/chorus/flux/* (formats, syntaxes, deposer)")
    print(f"  - Recycle:     {RECYCLE_PATH}")
    print(f"  - Validator:   {CORRECT_VALIDATOR_PATH}")
    print(f"  - Reception:   {RECEPTION_CONSULT_PATH}")
    print(f"  - Reception ×: {RECEPTION_CONSULT_BULK_PATH}")
    print(f"  - Reception →: {RECEPTION_PROCESS_PATH}")
    print(f"  - Reception +: {RECEPTION_COMPLETE_PATH}")
    print(f"  - Reception ↓: {RECEPTION_DOWNLOAD_PATH}")
    print(f"  - History:     {INVOICE_HISTORY_PATH}")
    print(f"  - Extract PDF: {EXTRACT_PDF_PATH}")
    print(f"  - Annuaire:    {SYNC_ANNUAIRE_PATH}")
    print(f"  - SIRET info:  {SIRET_INFO_PATH}")
    print(f"  - Structures:  {ACTIVE_RECIPIENT_STRUCTURES_PATH}")
    print(f"  - Invoices:    {SUPPLIER_INVOICES_SEARCH_PATH}")
    if _DB_ROUTER_AVAILABLE:
        print(f"  - DB routes:   /api/db/* (suppliers, invoices, sync)")
        sched_settings = load_scheduler_settings()
        if sched_settings.enabled:
            print(
                f"  - Cron sync:   ON (mode={sched_settings.mode}, "
                f"interval={sched_settings.interval_seconds}s, "
                f"pageSize={sched_settings.page_size}, "
                f"startupFull={sched_settings.startup_full_sync})"
            )
        else:
            print(
                f"  - Cron sync:   OFF (startupFull={sched_settings.startup_full_sync}; "
                f"set SYNC_CRON_ENABLED=true for periodic sync)"
            )
    else:
        print(f"  - DB routes:   DISABLED ({_DB_ROUTER_IMPORT_ERROR})")

    uvicorn.run(app, host=HOST, port=PORT)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
