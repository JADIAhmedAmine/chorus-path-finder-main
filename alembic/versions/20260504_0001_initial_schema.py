"""Initial schema: tenants, suppliers, public_customers, public_services, invoices, invoice_lines, sync_runs

Revision ID: 20260504_0001
Revises:
Create Date: 2026-05-04

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260504_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("legal_name", sa.String(length=255), nullable=False),
        sa.Column("siret", sa.String(length=32), nullable=False),
        sa.Column("vat_number", sa.String(length=32)),
        sa.Column("chorus_supplier_code", sa.String(length=64)),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("raw_payload", postgresql.JSONB),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "chorus_supplier_code",
            name="uq_suppliers_tenant_chorus_code",
        ),
    )
    op.create_index("ix_suppliers_tenant_active", "suppliers", ["tenant_id", "active"])
    op.create_index("ix_suppliers_siret", "suppliers", ["siret"])

    op.create_table(
        "public_customers",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("code_destinataire", sa.String(length=64), nullable=False),
        sa.Column("legal_name", sa.String(length=255), nullable=False),
        sa.Column("siret", sa.String(length=32)),
        sa.Column("structure_type", sa.String(length=32)),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("raw_payload", postgresql.JSONB),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "code_destinataire",
            name="uq_public_customers_tenant_code",
        ),
    )
    op.create_index(
        "ix_public_customers_tenant_active",
        "public_customers",
        ["tenant_id", "active"],
    )

    op.create_table(
        "public_services",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "public_customer_id",
            sa.String(length=64),
            sa.ForeignKey("public_customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_service_executant", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column(
            "engagement_required",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "purchase_order_required",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("raw_payload", postgresql.JSONB),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "public_customer_id",
            "code_service_executant",
            name="uq_public_services_customer_code",
        ),
    )
    op.create_index(
        "ix_public_services_tenant_active",
        "public_services",
        ["tenant_id", "active"],
    )

    op.create_table(
        "invoices",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "supplier_id",
            sa.String(length=64),
            sa.ForeignKey("suppliers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "public_customer_id",
            sa.String(length=64),
            sa.ForeignKey("public_customers.id", ondelete="RESTRICT"),
        ),
        sa.Column(
            "public_service_id",
            sa.String(length=128),
            sa.ForeignKey("public_services.id", ondelete="SET NULL"),
        ),
        sa.Column("source_format", sa.String(length=16), nullable=False, server_default="PDF"),
        sa.Column("target_format", sa.String(length=16)),
        sa.Column("supplier_invoice_number", sa.String(length=64), nullable=False),
        sa.Column("chorus_invoice_number", sa.String(length=64)),
        sa.Column("external_reference", sa.String(length=128)),
        sa.Column("invoice_date", sa.Date),
        sa.Column("due_date", sa.Date),
        sa.Column("currency_code", sa.String(length=3), nullable=False, server_default="EUR"),
        sa.Column("total_ht", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("total_vat", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("total_ttc", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("engagement_number", sa.String(length=64)),
        sa.Column("purchase_order_number", sa.String(length=64)),
        sa.Column("market_number", sa.String(length=64)),
        sa.Column("deposit_mode", sa.String(length=32)),
        sa.Column(
            "status_internal",
            sa.String(length=32),
            nullable=False,
            server_default="DRAFT_STRUCTURED",
        ),
        sa.Column("status_chorus", sa.String(length=64)),
        sa.Column("status_reason_code", sa.String(length=64)),
        sa.Column("status_reason_label", sa.String(length=255)),
        sa.Column("extraction_confidence", sa.Numeric(5, 4)),
        sa.Column(
            "requires_human_review",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("current_revision", sa.Integer, nullable=False, server_default="1"),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("last_status_sync_at", sa.DateTime(timezone=True)),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(length=64)),
        sa.Column("updated_by", sa.String(length=64)),
        sa.Column("raw_payload", postgresql.JSONB),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "supplier_id",
            "supplier_invoice_number",
            name="uq_invoices_supplier_number",
        ),
        sa.CheckConstraint("total_ht >= 0", name="ck_invoices_total_ht_positive"),
        sa.CheckConstraint("total_vat >= 0", name="ck_invoices_total_vat_positive"),
        sa.CheckConstraint("total_ttc >= 0", name="ck_invoices_total_ttc_positive"),
    )
    op.create_index(
        "ix_invoices_tenant_supplier_date",
        "invoices",
        ["tenant_id", "supplier_id", "invoice_date"],
    )
    op.create_index(
        "ix_invoices_status_internal", "invoices", ["tenant_id", "status_internal"]
    )
    op.create_index(
        "ix_invoices_status_chorus", "invoices", ["tenant_id", "status_chorus"]
    )
    op.create_index("ix_invoices_chorus_number", "invoices", ["chorus_invoice_number"])
    op.create_index("ix_invoices_public_customer", "invoices", ["public_customer_id"])

    op.create_table(
        "invoice_lines",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "invoice_id",
            sa.String(length=64),
            sa.ForeignKey("invoices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("line_number", sa.Integer, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("quantity", sa.Numeric(15, 4), nullable=False),
        sa.Column("unit_code", sa.String(length=16), nullable=False, server_default="UNITE"),
        sa.Column("unit_price_ht", sa.Numeric(15, 4), nullable=False),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=False),
        sa.Column("line_total_ht", sa.Numeric(15, 2), nullable=False),
        sa.Column("line_total_ttc", sa.Numeric(15, 2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "invoice_id", "line_number", name="uq_invoice_lines_invoice_line"
        ),
        sa.CheckConstraint("quantity >= 0", name="ck_invoice_lines_quantity_positive"),
        sa.CheckConstraint(
            "unit_price_ht >= 0", name="ck_invoice_lines_unit_price_positive"
        ),
    )

    op.create_table(
        "sync_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("entity", sa.String(length=32), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("chorus_environment", sa.String(length=32)),
        sa.Column("rows_fetched", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows_upserted", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rows_failed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text),
        sa.Column("payload_summary", postgresql.JSONB),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_sync_runs_tenant_entity_started",
        "sync_runs",
        ["tenant_id", "entity", "started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_sync_runs_tenant_entity_started", table_name="sync_runs")
    op.drop_table("sync_runs")
    op.drop_table("invoice_lines")
    op.drop_index("ix_invoices_public_customer", table_name="invoices")
    op.drop_index("ix_invoices_chorus_number", table_name="invoices")
    op.drop_index("ix_invoices_status_chorus", table_name="invoices")
    op.drop_index("ix_invoices_status_internal", table_name="invoices")
    op.drop_index("ix_invoices_tenant_supplier_date", table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_public_services_tenant_active", table_name="public_services")
    op.drop_table("public_services")
    op.drop_index("ix_public_customers_tenant_active", table_name="public_customers")
    op.drop_table("public_customers")
    op.drop_index("ix_suppliers_siret", table_name="suppliers")
    op.drop_index("ix_suppliers_tenant_active", table_name="suppliers")
    op.drop_table("suppliers")
    op.drop_table("tenants")
