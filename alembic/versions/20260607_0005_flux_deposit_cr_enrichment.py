"""Enrich chorus_flux_deposits with compte rendu (CR) data — P2-3

Adds the columns needed to persist the official `etatCourantFlux` and the
errors returned by `consulterCR` / `consulterCRDetaille`. Purely additive
(all nullable) — does not touch P2-1 behaviour.

Revision ID: 20260607_0005
Revises: e7a4bd3e24d6
Create Date: 2026-06-07

The preceding no-op checkpoint keeps the historical revision ID
`e7a4bd3e24d6` and follows the real flux migration head `20260530_0004`.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260607_0005"
down_revision: Union[str, None] = "e7a4bd3e24d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chorus_flux_deposits", sa.Column("etat_courant_flux", sa.String(length=64)))
    op.add_column("chorus_flux_deposits", sa.Column("cr_summary_json", postgresql.JSONB))
    op.add_column("chorus_flux_deposits", sa.Column("invoice_count", sa.Integer))
    op.add_column("chorus_flux_deposits", sa.Column("error_count", sa.Integer))
    op.add_column("chorus_flux_deposits", sa.Column("cr_available", sa.Boolean))
    op.add_column("chorus_flux_deposits", sa.Column("last_cr_checked_at", sa.DateTime(timezone=True)))
    op.add_column("chorus_flux_deposits", sa.Column("last_cr_error", sa.Text))


def downgrade() -> None:
    op.drop_column("chorus_flux_deposits", "last_cr_error")
    op.drop_column("chorus_flux_deposits", "last_cr_checked_at")
    op.drop_column("chorus_flux_deposits", "cr_available")
    op.drop_column("chorus_flux_deposits", "error_count")
    op.drop_column("chorus_flux_deposits", "invoice_count")
    op.drop_column("chorus_flux_deposits", "cr_summary_json")
    op.drop_column("chorus_flux_deposits", "etat_courant_flux")
