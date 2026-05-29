from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from sqlalchemy import select

from ..audit import read_audit_events
from ..auth import get_current_auth_user, require_auth
from ..client import ChorusClient
from ..config import load_chorus_settings
from ..dashboard import CustomerLookup, build_dashboard_summary
from . import repositories
from .config import load_database_settings
from .entities import Supplier, Tenant
from .schemas import (
    InvoiceLineOut,
    InvoiceOut,
    PaginatedInvoices,
    PaginatedSuppliers,
    PublicCustomerOut,
    PublicServiceOut,
    SupplierOut,
    SyncRunOut,
    SyncTriggerRequest,
)
from .session import fastapi_session
from .sync import (
    load_allowed_supplier_ids,
    sync_invoices_for_supplier,
    sync_suppliers,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/db", tags=["database"], dependencies=[Depends(require_auth)])


def _resolve_tenant_id(explicit: Optional[str]) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    return load_database_settings().default_tenant_id


@router.get("/suppliers", response_model=PaginatedSuppliers)
def list_suppliers_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    active_only: bool = Query(default=True, alias="activeOnly"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500, alias="pageSize"),
    session: Session = Depends(fastapi_session),
) -> PaginatedSuppliers:
    result = repositories.list_suppliers(
        session,
        tenant_id=_resolve_tenant_id(tenant_id),
        active_only=active_only,
        page=page,
        page_size=page_size,
    )
    return PaginatedSuppliers(
        total=result.total,
        page=result.page,
        page_size=result.page_size,
        items=[SupplierOut.model_validate(item) for item in result.items],
    )


@router.get("/public-customers", response_model=list[PublicCustomerOut])
def list_public_customers_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    active_only: bool = Query(default=True, alias="activeOnly"),
    session: Session = Depends(fastapi_session),
) -> list[PublicCustomerOut]:
    items = repositories.list_public_customers(
        session,
        tenant_id=_resolve_tenant_id(tenant_id),
        active_only=active_only,
    )
    return [PublicCustomerOut.model_validate(item) for item in items]


@router.get("/public-services", response_model=list[PublicServiceOut])
def list_public_services_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    public_customer_id: Optional[str] = Query(default=None, alias="publicCustomerId"),
    session: Session = Depends(fastapi_session),
) -> list[PublicServiceOut]:
    items = repositories.list_public_services(
        session,
        tenant_id=_resolve_tenant_id(tenant_id),
        public_customer_id=public_customer_id,
    )
    return [PublicServiceOut.model_validate(item) for item in items]


@router.get("/invoices", response_model=PaginatedInvoices)
def list_invoices_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    supplier_id: Optional[str] = Query(default=None, alias="supplierId"),
    public_customer_id: Optional[str] = Query(default=None, alias="publicCustomerId"),
    status_internal: Optional[str] = Query(default=None, alias="statusInternal"),
    status_chorus: Optional[str] = Query(default=None, alias="statusChorus"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500, alias="pageSize"),
    session: Session = Depends(fastapi_session),
) -> PaginatedInvoices:
    result = repositories.list_invoices(
        session,
        tenant_id=_resolve_tenant_id(tenant_id),
        supplier_id=supplier_id,
        public_customer_id=public_customer_id,
        status_internal=status_internal,
        status_chorus=status_chorus,
        page=page,
        page_size=page_size,
    )
    return PaginatedInvoices(
        total=result.total,
        page=result.page,
        page_size=result.page_size,
        items=[InvoiceOut.model_validate(item) for item in result.items],
    )


@router.get("/invoice-lines", response_model=list[InvoiceLineOut])
def list_invoice_lines_endpoint(
    invoice_id: Optional[str] = Query(default=None, alias="invoiceId"),
    session: Session = Depends(fastapi_session),
) -> list[InvoiceLineOut]:
    if not invoice_id:
        return []
    items = repositories.list_invoice_lines(session, invoice_id=invoice_id)
    return [InvoiceLineOut.model_validate(item) for item in items]


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice_endpoint(
    invoice_id: str,
    session: Session = Depends(fastapi_session),
) -> InvoiceOut:
    invoice = repositories.get_invoice(session, invoice_id=invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
    return InvoiceOut.model_validate(invoice)


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Date invalide '{value}' (format attendu : YYYY-MM-DD).",
        ) from error


@router.get("/dashboard/summary")
def dashboard_summary_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date: Optional[str] = Query(default=None, alias="to"),
    audit_window: int = Query(default=200, ge=1, le=1000, alias="auditWindow"),
    session: Session = Depends(fastapi_session),
) -> dict[str, Any]:
    resolved_tenant = _resolve_tenant_id(tenant_id)
    period_from = _parse_iso_date(from_date)
    period_to = _parse_iso_date(to_date)

    invoices = repositories.list_invoices_for_dashboard(
        session,
        tenant_id=resolved_tenant,
        from_date=period_from,
        to_date=period_to,
    )
    customers = repositories.list_public_customers(session, tenant_id=resolved_tenant)
    customer_lookups = [
        CustomerLookup(public_customer_id=customer.id, name=customer.legal_name)
        for customer in customers
    ]
    audit_events = read_audit_events(limit=audit_window)

    summary = build_dashboard_summary(
        invoices,
        audit_events=audit_events,
        customers=customer_lookups,
        period_from=period_from.isoformat() if period_from else None,
        period_to=period_to.isoformat() if period_to else None,
    )
    return summary.to_dict()


@router.get("/sync-runs", response_model=list[SyncRunOut])
def list_sync_runs_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    entity: Optional[str] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
    session: Session = Depends(fastapi_session),
) -> list[SyncRunOut]:
    runs = repositories.list_recent_sync_runs(
        session,
        tenant_id=_resolve_tenant_id(tenant_id),
        entity=entity,
        limit=limit,
    )
    return [SyncRunOut.model_validate(run) for run in runs]


@router.get("/tenant/current")
def get_current_tenant_endpoint(
    tenant_id: Optional[str] = Query(default=None, alias="tenantId"),
    session: Session = Depends(fastapi_session),
) -> dict[str, Any]:
    resolved_tenant_id = _resolve_tenant_id(tenant_id)
    tenant = session.scalar(select(Tenant).where(Tenant.id == resolved_tenant_id))
    if tenant is None:
        return {
            "id": resolved_tenant_id,
            "code": resolved_tenant_id,
            "name": resolved_tenant_id,
            "active": True,
            "createdAt": "1970-01-01T00:00:00Z",
            "updatedAt": "1970-01-01T00:00:00Z",
        }
    return {
        "id": tenant.id,
        "code": tenant.code,
        "name": tenant.name,
        "active": tenant.active,
        "createdAt": tenant.created_at,
        "updatedAt": tenant.updated_at,
    }


@router.get("/users/me")
def get_current_user_endpoint(
    user: dict[str, Any] = Depends(get_current_auth_user),
) -> dict[str, Any]:
    return {
        "id": user.get("id") or user["email"],
        "tenantId": user.get("tenantId") or load_database_settings().default_tenant_id,
        "email": user["email"],
        "firstName": user.get("firstName") or user["email"].split("@", 1)[0],
        "lastName": user.get("lastName") or "",
        "roleCode": user.get("roleCode") or "GESTIONNAIRE",
        "active": user.get("active", True),
        "createdAt": user.get("createdAt") or "1970-01-01T00:00:00Z",
        "updatedAt": user.get("updatedAt") or "1970-01-01T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# Sync triggers
# ---------------------------------------------------------------------------


@router.post("/sync/suppliers", response_model=SyncRunOut)
def trigger_sync_suppliers(
    body: Optional[SyncTriggerRequest] = None,
    session: Session = Depends(fastapi_session),
) -> SyncRunOut:
    body = body or SyncTriggerRequest()
    settings = load_chorus_settings(environment_override=body.environment)
    client = ChorusClient(settings)
    try:
        run = sync_suppliers(
            session,
            settings=settings,
            client=client,
            tenant_id=_resolve_tenant_id(body.tenant_id),
            trigger="api",
        )
    except Exception as error:  # noqa: BLE001
        logger.exception("Sync suppliers failed")
        raise HTTPException(status_code=502, detail=str(error)) from error
    return SyncRunOut.model_validate(run)


def _resolve_supplier_ids_to_sync(
    session: Session,
    *,
    tenant_id: str,
    explicit: Optional[int],
    fallback_default: Optional[int],
) -> list[str]:
    allowed = load_allowed_supplier_ids()

    if explicit is not None:
        explicit_str = str(explicit)
        if allowed is None or explicit_str in allowed:
            return [explicit_str]
        logger.warning(
            "Ignoring supplierId=%s because it is not in CHORUS_ALLOWED_SUPPLIER_IDS; falling back to configured supplier",
            explicit_str,
        )

    supplier_ids = [
        str(value)
        for value in session.scalars(
            select(Supplier.chorus_supplier_code)
            .where(
                Supplier.tenant_id == tenant_id,
                Supplier.active.is_(True),
                Supplier.chorus_supplier_code.is_not(None),
            )
        )
    ]
    if allowed is not None:
        supplier_ids = [sid for sid in supplier_ids if sid in allowed]
    if supplier_ids:
        return supplier_ids
    if fallback_default is not None:
        default_str = str(fallback_default)
        if allowed is None or default_str in allowed:
            return [default_str]
    return []


@router.post("/sync/invoices", response_model=list[SyncRunOut])
def trigger_sync_invoices(
    body: Optional[SyncTriggerRequest] = None,
    session: Session = Depends(fastapi_session),
) -> list[SyncRunOut]:
    body = body or SyncTriggerRequest()
    settings = load_chorus_settings(environment_override=body.environment)
    tenant_id = _resolve_tenant_id(body.tenant_id)

    supplier_ids = _resolve_supplier_ids_to_sync(
        session,
        tenant_id=tenant_id,
        explicit=body.supplier_id,
        fallback_default=settings.default_supplier_id,
    )
    if not supplier_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                "Aucun fournisseur à synchroniser. Lancez /sync/suppliers d'abord, "
                "ou passez supplierId, ou définissez CHORUS_<ENV>_SUPPLIER_ID."
            ),
        )

    client = ChorusClient(settings)
    runs: list[SyncRunOut] = []
    for supplier_id in supplier_ids:
        try:
            run = sync_invoices_for_supplier(
                session,
                settings=settings,
                client=client,
                tenant_id=tenant_id,
                supplier_id=supplier_id,
                mode=body.mode,
                page_size=body.page_size,
                since=body.since,
                trigger="api",
            )
            runs.append(SyncRunOut.model_validate(run))
        except Exception as error:  # noqa: BLE001
            logger.exception("Sync invoices failed for supplier %s", supplier_id)
            raise HTTPException(status_code=502, detail=str(error)) from error
    return runs


@router.post("/sync/all", response_model=dict[str, SyncRunOut])
def trigger_sync_all(
    body: Optional[SyncTriggerRequest] = None,
    session: Session = Depends(fastapi_session),
) -> dict[str, SyncRunOut]:
    body = body or SyncTriggerRequest()
    settings = load_chorus_settings(environment_override=body.environment)
    client = ChorusClient(settings)
    tenant_id = _resolve_tenant_id(body.tenant_id)

    response: dict[str, Any] = {}
    try:
        suppliers_run = sync_suppliers(
            session,
            settings=settings,
            client=client,
            tenant_id=tenant_id,
            trigger="api",
        )
        response["suppliers"] = SyncRunOut.model_validate(suppliers_run)

        supplier_id = body.supplier_id or settings.default_supplier_id
        if supplier_id is not None:
            invoices_run = sync_invoices_for_supplier(
                session,
                settings=settings,
                client=client,
                tenant_id=tenant_id,
                supplier_id=str(supplier_id),
                mode=body.mode,
                page_size=body.page_size,
                since=body.since,
                trigger="api",
            )
            response["invoices"] = SyncRunOut.model_validate(invoices_run)
    except Exception as error:  # noqa: BLE001
        logger.exception("Sync all failed")
        raise HTTPException(status_code=502, detail=str(error)) from error
    return response
