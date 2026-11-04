"""Extend invoices with Chorus metadata columns

Revision ID: 20260504_0002
Revises: 20260504_0001
Create Date: 2026-05-04

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260504_0002"
down_revision: Union[str, None] = "20260504_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("chorus_invoice_type", sa.String(length=32)))
    op.add_column("invoices", sa.Column("recipient_chorus_id", sa.String(length=64)))
    op.add_column("invoices", sa.Column("recipient_chorus_code", sa.String(length=64)))
    op.add_column("invoices", sa.Column("recipient_chorus_name", sa.String(length=255)))
    op.add_column("invoices", sa.Column("service_chorus_id", sa.String(length=64)))
    op.add_column("invoices", sa.Column("service_chorus_code", sa.String(length=128)))
    op.add_column("invoices", sa.Column("service_chorus_name", sa.String(length=255)))
    op.add_column("invoices", sa.Column("supplier_chorus_code", sa.String(length=64)))
    op.add_column("invoices", sa.Column("supplier_chorus_name", sa.String(length=255)))
    op.add_column("invoices", sa.Column("amount_to_pay", sa.Numeric(15, 2)))
    op.add_column("invoices", sa.Column("created_by_name", sa.String(length=128)))
    op.add_column("invoices", sa.Column("status_changed_at", sa.DateTime(timezone=True)))
    op.add_column("invoices", sa.Column("rejection_processed", sa.Boolean()))
    op.add_column("invoices", sa.Column("attachment_count", sa.Integer()))

    op.create_index(
        "ix_invoices_chorus_invoice_type",
        "invoices",
        ["tenant_id", "chorus_invoice_type"],
    )
    op.create_index(
        "ix_invoices_recipient_chorus_id",
        "invoices",
        ["recipient_chorus_id"],
    )
    op.create_index(
        "ix_invoices_status_changed_at",
        "invoices",
        ["tenant_id", "status_changed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_invoices_status_changed_at", table_name="invoices")
    op.drop_index("ix_invoices_recipient_chorus_id", table_name="invoices")
    op.drop_index("ix_invoices_chorus_invoice_type", table_name="invoices")
    op.drop_column("invoices", "attachment_count")
    op.drop_column("invoices", "rejection_processed")
    op.drop_column("invoices", "status_changed_at")
    op.drop_column("invoices", "created_by_name")
    op.drop_column("invoices", "amount_to_pay")
    op.drop_column("invoices", "supplier_chorus_name")
    op.drop_column("invoices", "supplier_chorus_code")
    op.drop_column("invoices", "service_chorus_name")
    op.drop_column("invoices", "service_chorus_code")
    op.drop_column("invoices", "service_chorus_id")
    op.drop_column("invoices", "recipient_chorus_name")
    op.drop_column("invoices", "recipient_chorus_code")
    op.drop_column("invoices", "recipient_chorus_id")
    op.drop_column("invoices", "chorus_invoice_type")
