"""Checkpoint after the flux deposit migrations.

Revision ID: e7a4bd3e24d6
Revises: 20260530_0004
Create Date: 2026-06-01 10:17:13.756378

The original file referenced a non-existent ``20260522_0001`` revision. That
revision was never present in the repository history; keeping it made the
entire Alembic graph unloadable. Preserve this revision ID as a no-op
checkpoint while linking it to the actual preceding head.
"""
from __future__ import annotations

from typing import Sequence, Union

revision: str = 'e7a4bd3e24d6'
down_revision: Union[str, None] = '20260530_0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
