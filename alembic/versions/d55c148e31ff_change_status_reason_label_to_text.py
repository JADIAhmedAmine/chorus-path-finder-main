"""change status reason label to text

Revision ID: d55c148e31ff
Revises: 20260504_0002
Create Date: 2026-05-04 15:56:51.220714

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd55c148e31ff'
down_revision: Union[str, None] = '20260504_0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.alter_column(
        "invoices",
        "status_reason_label",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "invoices",
        "status_reason_label",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )