"""Add detection metadata columns to chorus_flux_deposits

Revision ID: 20260530_0004
Revises: 20260530_0003
Create Date: 2026-05-30

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260530_0004"
down_revision: Union[str, None] = "20260530_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chorus_flux_deposits", sa.Column("file_sha256", sa.String(length=64)))
    op.add_column("chorus_flux_deposits", sa.Column("file_size", sa.Integer))
    op.add_column("chorus_flux_deposits", sa.Column("detected_file_type", sa.String(length=64)))
    op.add_column("chorus_flux_deposits", sa.Column("root_element", sa.String(length=128)))
    op.add_column("chorus_flux_deposits", sa.Column("namespace", sa.String(length=512)))
    op.alter_column(
        "chorus_flux_deposits",
        "status_local",
        existing_type=sa.String(length=16),
        type_=sa.String(length=32),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "chorus_flux_deposits",
        "status_local",
        existing_type=sa.String(length=32),
        type_=sa.String(length=16),
        existing_nullable=False,
    )
    op.drop_column("chorus_flux_deposits", "namespace")
    op.drop_column("chorus_flux_deposits", "root_element")
    op.drop_column("chorus_flux_deposits", "detected_file_type")
    op.drop_column("chorus_flux_deposits", "file_size")
    op.drop_column("chorus_flux_deposits", "file_sha256")
