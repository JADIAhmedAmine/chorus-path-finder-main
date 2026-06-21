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

from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import JSONResponse

from ...auth import get_current_auth_user
from ..base import ProviderError
from ..connections import (
    EncryptedTokenStore,
    InMemoryConnectionStore,
    ProviderConnection,
    ProviderRegistry,
)
from ..crypto import TokenCipher
from ..oauth import InMemoryTokenStore
from .config import load_iopole_config

logger = logging.getLogger("providers.iopole.routes")

router = APIRouter(prefix="/api/providers/iopole", tags=["iopole"])

_DEFAULT_TENANT = (os.getenv("CHORUS_DEFAULT_TENANT_ID") or "default").strip() or "default"
_registry: Optional[ProviderRegistry] = None


def _build_registry() -> ProviderRegistry:
    connections = InMemoryConnectionStore()
    cfg = load_iopole_config()
    if cfg.client_id and cfg.client_secret and cfg.customer_id:
        connections.put(
            ProviderConnection(
                tenant_id=_DEFAULT_TENANT,
                provider="iopole",
                environment=cfg.environment,
                customer_id=cfg.customer_id,
                client_id=cfg.client_id,
                client_secret=cfg.client_secret,
            )
        )
    key = (os.getenv("PROVIDERS_ENCRYPTION_KEY") or "").strip()
    token_store = EncryptedTokenStore(TokenCipher(key)) if key else InMemoryTokenStore()
    return ProviderRegistry(connections, token_store)


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
