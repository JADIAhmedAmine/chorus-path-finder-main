from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    MappedAsDataclass,
    mapped_column,
    relationship,
)


class Base(MappedAsDataclass, DeclarativeBase, kw_only=True):
    """Declarative base. All ORM entities inherit from this."""


# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        init=False,
    )


# ---------------------------------------------------------------------------
# Suppliers (SupplierOrganization)
# ---------------------------------------------------------------------------


class Supplier(Base):
    __tablename__ = "suppliers"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "chorus_supplier_code", name="uq_suppliers_tenant_chorus_code"
        ),
        Index("ix_suppliers_tenant_active", "tenant_id", "active"),
        Index("ix_suppliers_siret", "siret"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    siret: Mapped[str] = mapped_column(String(32), nullable=False)
    vat_number: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    chorus_supplier_code: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        init=False,
    )

    invoices: Mapped[list["Invoice"]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan", default_factory=list
    )


# ---------------------------------------------------------------------------
# Public customers + services (destinataires Chorus)
# ---------------------------------------------------------------------------


class PublicCustomer(Base):
    __tablename__ = "public_customers"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "code_destinataire", name="uq_public_customers_tenant_code"
        ),
        Index("ix_public_customers_tenant_active", "tenant_id", "active"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    code_destinataire: Mapped[str] = mapped_column(String(64), nullable=False)
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    siret: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    structure_type: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        init=False,
    )

    services: Mapped[list["PublicService"]] = relationship(
        back_populates="customer", cascade="all, delete-orphan", default_factory=list
    )


class PublicService(Base):
    __tablename__ = "public_services"
    __table_args__ = (
        UniqueConstraint(
            "public_customer_id",
            "code_service_executant",
            name="uq_public_services_customer_code",
        ),
        Index("ix_public_services_tenant_active", "tenant_id", "active"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    public_customer_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("public_customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    code_service_executant: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    engagement_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    purchase_order_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        init=False,
    )

    customer: Mapped[PublicCustomer] = relationship(
        back_populates="services", default=None
    )


# ---------------------------------------------------------------------------
# Invoices + lines
# ---------------------------------------------------------------------------


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint(
            "supplier_id",
            "supplier_invoice_number",
            name="uq_invoices_supplier_number",
        ),
        Index("ix_invoices_tenant_supplier_date", "tenant_id", "supplier_id", "invoice_date"),
        Index("ix_invoices_status_internal", "tenant_id", "status_internal"),
        Index("ix_invoices_status_chorus", "tenant_id", "status_chorus"),
        Index("ix_invoices_chorus_number", "chorus_invoice_number"),
        Index("ix_invoices_public_customer", "public_customer_id"),
        CheckConstraint("total_ht >= 0", name="ck_invoices_total_ht_positive"),
        CheckConstraint("total_vat >= 0", name="ck_invoices_total_vat_positive"),
        CheckConstraint("total_ttc >= 0", name="ck_invoices_total_ttc_positive"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    supplier_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False
    )
    public_customer_id: Mapped[Optional[str]] = mapped_column(
        String(64), ForeignKey("public_customers.id", ondelete="RESTRICT"), default=None
    )
    public_service_id: Mapped[Optional[str]] = mapped_column(
        String(128), ForeignKey("public_services.id", ondelete="SET NULL"), default=None
    )

    source_format: Mapped[str] = mapped_column(String(16), nullable=False, default="PDF")
    target_format: Mapped[Optional[str]] = mapped_column(String(16), default=None)

    supplier_invoice_number: Mapped[str] = mapped_column(String(64), nullable=False)
    chorus_invoice_number: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    external_reference: Mapped[Optional[str]] = mapped_column(String(128), default=None)

    invoice_date: Mapped[Optional[date]] = mapped_column(Date, default=None)
    due_date: Mapped[Optional[date]] = mapped_column(Date, default=None)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")

    total_ht: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))
    total_vat: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))
    total_ttc: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))

    engagement_number: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    purchase_order_number: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    market_number: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    deposit_mode: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    status_internal: Mapped[str] = mapped_column(
        String(32), nullable=False, default="DRAFT_STRUCTURED"
    )
    status_chorus: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    status_reason_code: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    status_reason_label: Mapped[Optional[str]] = mapped_column(Text, default=None)

    extraction_confidence: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4), default=None
    )
    requires_human_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )
    last_status_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )
    status_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )

    chorus_invoice_type: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    recipient_chorus_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    recipient_chorus_code: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    recipient_chorus_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    service_chorus_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    service_chorus_code: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    service_chorus_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    supplier_chorus_code: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    supplier_chorus_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    amount_to_pay: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2), default=None)
    created_by_name: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    rejection_processed: Mapped[Optional[bool]] = mapped_column(Boolean, default=None)
    attachment_count: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    created_by: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    updated_by: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        init=False,
    )

    supplier: Mapped[Supplier] = relationship(back_populates="invoices", default=None)
    lines: Mapped[list["InvoiceLine"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLine.line_number",
        default_factory=list,
    )


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    __table_args__ = (
        UniqueConstraint("invoice_id", "line_number", name="uq_invoice_lines_invoice_line"),
        CheckConstraint("quantity >= 0", name="ck_invoice_lines_quantity_positive"),
        CheckConstraint("unit_price_ht >= 0", name="ck_invoice_lines_unit_price_positive"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    invoice_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(16), nullable=False, default="UNITE")
    unit_price_ht: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    line_total_ht: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    line_total_ttc: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        init=False,
    )

    invoice: Mapped[Invoice] = relationship(back_populates="lines", default=None)


# ---------------------------------------------------------------------------
# Sync runs (audit trail for Chorus -> DB synchronizations)
# ---------------------------------------------------------------------------


class SyncRun(Base):
    __tablename__ = "sync_runs"
    __table_args__ = (
        Index("ix_sync_runs_tenant_entity_started", "tenant_id", "entity", "started_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    entity: Mapped[str] = mapped_column(String(32), nullable=False)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    chorus_environment: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    rows_fetched: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_upserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, default=None)
    payload_summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None
    )


# ---------------------------------------------------------------------------
# Chorus Pro "Dépôt de flux" deposits (deposer/flux audit trail)
# ---------------------------------------------------------------------------


class ChorusFluxDeposit(Base):
    """Trace d'un dépôt de flux Chorus Pro (`/v1/deposer/flux`).

    Indépendant de la table ``invoices`` (dépôt unitaire) : ce module dépose
    un fichier de flux structuré (XML / PDF-A3) et conserve la réponse Chorus.
    """

    __tablename__ = "chorus_flux_deposits"
    __table_args__ = (
        Index("ix_chorus_flux_deposits_tenant_created", "tenant_id", "created_at"),
        Index("ix_chorus_flux_deposits_tenant_status", "tenant_id", "status_local"),
        Index("ix_chorus_flux_deposits_numero", "numero_flux_depot"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    nom_fichier: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    format_flux: Mapped[str] = mapped_column(String(64), nullable=False)
    syntaxe_flux: Mapped[str] = mapped_column(String(64), nullable=False)
    detected_file_type: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    root_element: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    namespace: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    avec_signature: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    id_utilisateur_courant: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    http_status: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    code_retour: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    libelle: Mapped[Optional[str]] = mapped_column(Text, default=None)
    date_depot: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    numero_flux_depot: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    raw_response: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    status_local: Mapped[str] = mapped_column(String(32), nullable=False)
    # --- Enrichissement compte rendu (CR) — P2-3 (consulterCR / consulterCRDetaille) ---
    etat_courant_flux: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    cr_summary_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, default=None)
    invoice_count: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    error_count: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    cr_available: Mapped[Optional[bool]] = mapped_column(Boolean, default=None)
    last_cr_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    last_cr_error: Mapped[Optional[str]] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )


# ---------------------------------------------------------------------------
# Provider connections & tokens (multi-tenant : Iopole, etc.)
# ---------------------------------------------------------------------------


class ProviderConnectionRecord(Base):
    """Connexion d'un tenant à un provider (ex. Iopole), secret chiffré au repos."""

    __tablename__ = "provider_connections"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_provider_connections_tenant_provider"),
        Index("ix_provider_connections_tenant", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)  # "<tenant_id>:<provider>"
    tenant_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    environment: Mapped[str] = mapped_column(String(16), nullable=False, default="ppd")
    customer_id: Mapped[str] = mapped_column(String(128), nullable=False)
    client_id: Mapped[str] = mapped_column(String(255), nullable=False)
    client_secret_enc: Mapped[str] = mapped_column(Text, nullable=False)  # chiffré (Fernet)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, init=False
    )


class ProviderTokenRecord(Base):
    """Cache de token OAuth d'une connexion provider, chiffré au repos."""

    __tablename__ = "provider_tokens"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)  # "<tenant_id>:<provider>"
    token_enc: Mapped[str] = mapped_column(Text, nullable=False)  # JSON chiffré (Fernet)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, init=False
    )
