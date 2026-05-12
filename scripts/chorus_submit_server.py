#!/usr/bin/env python3
from __future__ import annotations

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
from chorus_python.client import ChorusClient, sanitize_debug_value
from chorus_python.extraction import extract_pdf_text_from_base64_docling

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
                "error": f"Erreur Docling lors de l'extraction: {error}",
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


def main() -> int:
    logging.basicConfig(level=os.environ.get("CHORUS_LOG_LEVEL", "INFO").upper())
    print(f"Python executable: {sys.executable}")
    print(f"Repository root:    {REPO_ROOT}")
    print(f"FastAPI listening on http://{HOST}:{PORT}")
    print(f"  - OAuth token: {OAUTH_TOKEN_PATH}")
    print(f"  - Submit:      {SUBMIT_PATH}")
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
