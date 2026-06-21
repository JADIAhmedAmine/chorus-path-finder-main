"""Routes FastAPI Iopole (préfixe ``/api/providers/iopole``), scopées au tenant.

Bridge mono-tenant : tant que la persistance DB n'est pas en place, la connexion
Iopole vient de ``.env.local`` (un seul jeu), exposée comme le tenant par défaut.
À remplacer par un ``ConnectionStore`` PostgreSQL chiffré (voir PROVIDERS_STATUS.md).

Sécurité : credentials côté serveur ; aucun secret/token renvoyé au frontend ;
aucun contenu de facture journalisé.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, File, Query, Response, UploadFile
from fastapi.responses import JSONResponse

from ...auth import get_current_auth_user, require_submit_permission
from ..base import ProviderError
from ..connections import ProviderConnection, ProviderRegistry

logger = logging.getLogger("providers.iopole.routes")

router = APIRouter(prefix="/api/providers/iopole", tags=["iopole"])

_DEFAULT_TENANT = (os.getenv("CHORUS_DEFAULT_TENANT_ID") or "default").strip() or "default"
_registry: Optional[ProviderRegistry] = None


def _build_registry() -> ProviderRegistry:
    # DB multi-tenant si dispo (clé + tables), sinon bridge .env.local.
    from ..db_stores import build_provider_registry

    return build_provider_registry()


def _registry_instance() -> ProviderRegistry:
    global _registry
    if _registry is None:
        _registry = _build_registry()
    return _registry


def _provider(user: dict[str, Any]):
    reg = _registry_instance()
    tenant = user.get("tenantId") or _DEFAULT_TENANT
    try:
        return reg.iopole_for(tenant)
    except ProviderError:
        # Bridge : retombe sur la connexion par défaut tant que le multi-tenant DB n'existe pas.
        return reg.iopole_for(_DEFAULT_TENANT)


def _error(exc: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={"error": str(exc), "provider": "iopole", "requestId": exc.request_id},
    )


@router.get("/health")
def iopole_health(user: dict[str, Any] = Depends(get_current_auth_user)) -> dict[str, Any]:
    try:
        return {"ok": _provider(user).health_check()}
    except ProviderError:
        return {"ok": False}


@router.get("/invoices")
def iopole_invoices(
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    user: dict[str, Any] = Depends(get_current_auth_user),
):
    try:
        refs = _provider(user).search_invoices(
            query=q, limit=limit, expand=("businessData", "lastStatusData")
        )
    except ProviderError as exc:
        return _error(exc)
    return {
        "invoices": [
            {"id": r.external_id, "reference": r.reference, "raw": r.raw} for r in refs
        ]
    }


@router.get("/invoices/{invoice_id}/status")
def iopole_status(
    invoice_id: str, user: dict[str, Any] = Depends(get_current_auth_user)
):
    provider = _provider(user)
    try:
        status = provider.get_lifecycle_status(invoice_id)
        history = provider.get_status_history(invoice_id)
    except ProviderError as exc:
        return _error(exc)
    return {
        "id": invoice_id,
        "lifecycleStatus": status.lifecycle_status,
        "history": [
            {"code": (h.get("status") or {}).get("code"), "date": h.get("date")}
            for h in history
            if isinstance(h, dict)
        ],
    }


@router.get("/invoices/{invoice_id}")
def iopole_invoice_detail(
    invoice_id: str, user: dict[str, Any] = Depends(get_current_auth_user)
):
    try:
        return _provider(user).get_invoice(invoice_id)
    except ProviderError as exc:
        return _error(exc)


@router.get("/invoices/{invoice_id}/history")
def iopole_invoice_history(
    invoice_id: str, user: dict[str, Any] = Depends(get_current_auth_user)
):
    try:
        history = _provider(user).get_status_history(invoice_id)
    except ProviderError as exc:
        return _error(exc)
    return {
        "id": invoice_id,
        "history": [
            {
                "code": (h.get("status") or {}).get("code"),
                "date": h.get("date"),
                "destType": h.get("destType"),
            }
            for h in history
            if isinstance(h, dict)
        ],
    }


@router.get("/invoices/{invoice_id}/download")
def iopole_invoice_download(
    invoice_id: str,
    readable: bool = Query(default=False),
    user: dict[str, Any] = Depends(get_current_auth_user),
):
    provider = _provider(user)
    try:
        content = (
            provider.download_readable(invoice_id) if readable else provider.download_invoice(invoice_id)
        )
    except ProviderError as exc:
        return _error(exc)
    suffix = "lisible.pdf" if readable else "original"
    return Response(
        content=content,
        media_type="application/pdf" if readable else "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="iopole-{invoice_id}-{suffix}"'},
    )


@router.get("/inbox")
def iopole_inbox(user: dict[str, Any] = Depends(get_current_auth_user)):
    """Factures reçues non encore vues (parallèle de la réception Chorus)."""
    try:
        ids = _provider(user).list_not_seen()
    except ProviderError as exc:
        return _error(exc)
    return {"notSeen": ids, "count": len(ids)}


@router.post("/invoices/{invoice_id}/seen")
def iopole_mark_seen(
    invoice_id: str, user: dict[str, Any] = Depends(require_submit_permission)
):
    try:
        _provider(user).mark_as_seen(invoice_id)
    except ProviderError as exc:
        return _error(exc)
    return {"id": invoice_id, "seen": True}


@router.get("/directory/french")
def iopole_directory_french(
    q: str = Query(...), user: dict[str, Any] = Depends(get_current_auth_user)
):
    try:
        return {"results": _provider(user).search_french_directory(q)}
    except ProviderError as exc:
        return _error(exc)


@router.post("/emit")
async def iopole_emit(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_auth_user),
):
    content = await file.read()
    try:
        ref = _provider(user).deposit(content, filename=file.filename or "invoice.pdf")
    except ProviderError as exc:
        return _error(exc)
    return {"id": ref.external_id, "raw": ref.raw}


@router.post("/notifications")
async def iopole_notifications(payload: dict[str, Any] = Body(default={})):
    """Webhook Push : accuse réception d'une notification de statut Iopole.

    TODO : vérifier la signature + persister dans ``provider_invoices`` + réconcilier.
    """
    logger.info("Notification Iopole reçue (clés: %s)", sorted(payload.keys()))
    return {"received": True}


@router.post("/connect")
def iopole_connect(
    body: dict[str, Any] = Body(default={}),
    user: dict[str, Any] = Depends(require_submit_permission),
):
    """Provisionne (chiffré, en DB) la connexion Iopole du tenant courant.

    Réservé aux rôles autorisés (``require_submit_permission``). Nécessite
    ``PROVIDERS_ENCRYPTION_KEY`` + les tables ``provider_connections``.
    """
    from ..db_stores import provision_connection

    global _registry
    tenant = user.get("tenantId") or _DEFAULT_TENANT
    connection = ProviderConnection(
        tenant_id=tenant,
        provider="iopole",
        environment=(body.get("environment") or "ppd"),
        customer_id=(body.get("customerId") or body.get("customer_id") or "").strip(),
        client_id=(body.get("clientId") or body.get("client_id") or "").strip(),
        client_secret=(body.get("clientSecret") or body.get("client_secret") or "").strip(),
    )
    if not (connection.customer_id and connection.client_id and connection.client_secret):
        return JSONResponse(
            status_code=400,
            content={"error": "customerId, clientId et clientSecret sont requis."},
        )
    try:
        provision_connection(connection)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"error": f"Provisioning indisponible: {exc}"})
    _registry = None  # force la reconstruction avec la nouvelle connexion
    return {
        "connected": True,
        "tenantId": tenant,
        "provider": "iopole",
        "environment": connection.environment,
    }


@router.post("/convert-pdf")
async def iopole_convert_pdf(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_auth_user),
):
    """N'IMPORTE QUEL PDF -> brouillon extrait + JSON Iopole (à relire/corriger).

    Réutilise l'extraction existante (``chorus_pdf_invoice_extractor``) puis mappe
    vers le modèle JSON Iopole. Ne génère ni ne dépose : étape de relecture.
    """
    from ...chorus_pdf_invoice_extractor import extract_invoice_draft
    from .mapping import map_draft_to_iopole_json

    content = await file.read()
    result = extract_invoice_draft(content, file.filename or "facture.pdf")
    draft = result.get("draft", {}) if isinstance(result, dict) else {}
    return {
        "draft": draft,
        "iopoleJson": map_draft_to_iopole_json(draft),
        "warnings": result.get("warnings", []) if isinstance(result, dict) else [],
        "confidence": result.get("confidence", {}) if isinstance(result, dict) else {},
    }


@router.post("/emit-from-json")
def iopole_emit_from_json(
    body: dict[str, Any] = Body(...),
    user: dict[str, Any] = Depends(require_submit_permission),
):
    """JSON Iopole (relu) -> génération Factur-X/UBL conforme -> dépôt.

    En cas d'échec de validation EN16931, renvoie le détail (``detail``) pour que
    l'utilisateur sache quoi corriger (ex. n° TVA vendeur manquant).
    """
    provider = _provider(user)
    invoice = body.get("invoice") if isinstance(body.get("invoice"), dict) else body
    kind = body.get("kind") or "facturx"
    flavor = body.get("flavor") or "EN16931"
    extra = {"language": "FRENCH"} if kind == "facturx" else {}
    try:
        document = provider.generate_invoice_document(invoice, kind=kind, flavor=flavor, **extra)
    except ProviderError as exc:
        return JSONResponse(
            status_code=422,
            content={"error": "Génération refusée (validation).", "detail": exc.detail},
        )
    try:
        suffix = ".pdf" if kind == "facturx" else ".xml"
        ref = provider.deposit(document, filename=(invoice.get("invoiceId") or "facture") + suffix)
    except ProviderError as exc:
        return _error(exc)
    return {"id": ref.external_id, "generated": True}
