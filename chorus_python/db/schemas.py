from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


SyncMode = Literal["recent", "delta", "full"]


_camel_alias_overrides = {
    "id": "id",
}


def _to_camel(name: str) -> str:
    if name in _camel_alias_overrides:
        return _camel_alias_overrides[name]
    parts = name.split("_")
    return parts[0] + "".join(part.title() for part in parts[1:])


class _ApiModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=_to_camel,
        ser_json_timedelta="iso8601",
    )


class SupplierOut(_ApiModel):
    id: str
    tenant_id: str
    legal_name: str
    siret: str
    vat_number: Optional[str] = None
    chorus_supplier_code: Optional[str] = None
    active: bool
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class PublicCustomerOut(_ApiModel):
    id: str
    tenant_id: str
    code_destinataire: str
    legal_name: str
    siret: Optional[str] = None
    structure_type: Optional[str] = None
    active: bool
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class PublicServiceOut(_ApiModel):
    id: str
    tenant_id: str
    public_customer_id: str
    code_service_executant: str
    label: str
    engagement_required: bool
    purchase_order_required: bool
    active: bool
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class InvoiceLineOut(_ApiModel):
    id: str
    tenant_id: str
    invoice_id: str
    line_number: int
    description: str
    quantity: Decimal
    unit_code: str
    unit_price_ht: Decimal
    vat_rate: Decimal
    line_total_ht: Decimal
    line_total_ttc: Decimal
    created_at: datetime
    updated_at: datetime


class InvoiceOut(_ApiModel):
    id: str
    tenant_id: str
    supplier_id: str = Field(validation_alias="supplier_id", serialization_alias="supplierOrganizationId")
    public_customer_id: Optional[str] = None
    public_service_id: Optional[str] = None
    source_format: str
    target_format: Optional[str] = None
    supplier_invoice_number: str
    chorus_invoice_number: Optional[str] = None
    external_reference: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    currency_code: str
    total_ht: Decimal
    total_vat: Decimal
    total_ttc: Decimal
    engagement_number: Optional[str] = None
    purchase_order_number: Optional[str] = None
    market_number: Optional[str] = None
    deposit_mode: Optional[str] = None
    status_internal: str
    status_chorus: Optional[str] = None
    status_reason_code: Optional[str] = None
    status_reason_label: Optional[str] = None
    extraction_confidence: Optional[Decimal] = None
    requires_human_review: bool
    current_revision: int
    submitted_at: Optional[datetime] = None
    last_status_sync_at: Optional[datetime] = None
    status_changed_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    chorus_invoice_type: Optional[str] = None
    recipient_chorus_id: Optional[str] = None
    recipient_chorus_code: Optional[str] = None
    recipient_chorus_name: Optional[str] = None
    service_chorus_id: Optional[str] = None
    service_chorus_code: Optional[str] = None
    service_chorus_name: Optional[str] = None
    supplier_chorus_code: Optional[str] = None
    supplier_chorus_name: Optional[str] = None
    amount_to_pay: Optional[Decimal] = None
    created_by_name: Optional[str] = None
    rejection_processed: Optional[bool] = None
    attachment_count: Optional[int] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    raw_payload: Optional[dict] = None
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    lines: list[InvoiceLineOut] = Field(default_factory=list)


class SyncRunOut(_ApiModel):
    id: str
    tenant_id: str
    entity: str
    trigger: str
    status: str
    chorus_environment: Optional[str] = None
    rows_fetched: int
    rows_upserted: int
    rows_failed: int
    error_message: Optional[str] = None
    payload_summary: Optional[dict] = None
    started_at: datetime
    finished_at: Optional[datetime] = None


class SyncTriggerRequest(_ApiModel):
    tenant_id: Optional[str] = None
    environment: Optional[str] = None
    supplier_id: Optional[int] = None
    mode: SyncMode = "recent"
    page_size: Optional[int] = Field(default=None, ge=1, le=5000)
    since: Optional[date] = None


class PaginatedInvoices(_ApiModel):
    total: int
    page: int
    page_size: int
    items: list[InvoiceOut]


class PaginatedSuppliers(_ApiModel):
    total: int
    page: int
    page_size: int
    items: list[SupplierOut]
