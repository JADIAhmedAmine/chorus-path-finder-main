"""merge alembic heads

Revision ID: e7a4bd3e24d6
Revises: 20260522_0001, 20260530_0004
Create Date: 2026-06-01 10:17:13.756378

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7a4bd3e24d6'
down_revision: Union[str, None] = ('20260522_0001', '20260530_0004')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
