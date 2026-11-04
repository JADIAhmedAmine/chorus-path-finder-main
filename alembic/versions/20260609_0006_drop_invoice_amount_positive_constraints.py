"""Drop positive-amount CHECK constraints on invoices

Invoices synced from Chorus Pro can legitimately carry negative totals:
credit notes (avoirs) and rejected invoices (REJETEE) come back with
negative total_ht / total_vat / total_ttc. The original
``total_* >= 0`` checks were written for app-created outbound invoices
and wrongly reject these inbound rows, breaking the supplier sync.

Revision ID: 20260609_0006
Revises: 20260607_0005
Create Date: 2026-06-09
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260609_0006"
down_revision: Union[str, None] = "20260607_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF EXISTS so the migration stays safe even if the constraints were already
    # dropped manually (e.g. to unblock a running dev DB before rebuilding).
    op.execute("ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_total_ht_positive")
    op.execute("ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_total_vat_positive")
    op.execute("ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_total_ttc_positive")


def downgrade() -> None:
    op.create_check_constraint(
        "ck_invoices_total_ttc_positive", "invoices", "total_ttc >= 0"
    )
    op.create_check_constraint(
        "ck_invoices_total_vat_positive", "invoices", "total_vat >= 0"
    )
    op.create_check_constraint(
        "ck_invoices_total_ht_positive", "invoices", "total_ht >= 0"
    )
