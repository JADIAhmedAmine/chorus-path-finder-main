"""Checkpoint after the flux deposit migrations.

Revision ID: e7a4bd3e24d6
Revises: 20260530_0004
Create Date: 2026-06-01 10:17:13.756378

No-op checkpoint. NB: do NOT chain ``20260522_0001`` (invoicepilot_core)
here — its migration file is NOT present in the repository, so referencing
it makes the Alembic graph unloadable on a fresh clone (KeyError
'20260522_0001'). Keep this linked only to the real preceding head
``20260530_0004``.
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
