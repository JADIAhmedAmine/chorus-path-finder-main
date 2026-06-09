"""Merge the invoicepilot_core and flux-deposit branches.

Revision ID: e7a4bd3e24d6
Revises: 20260530_0004, 20260522_0001
Create Date: 2026-06-01 10:17:13.756378

True merge node: both the ``invoicepilot_core`` branch (``20260522_0001``)
and the flux-deposit branch (``20260530_0004``) descend from
``d55c148e31ff`` and converge here. Earlier this file linked only to
``20260530_0004``, leaving ``20260522_0001`` as a dangling second head so
``alembic upgrade head`` failed with "multiple head revisions". The
invoicepilot schema (provider_name / channel / external_invoice_id columns,
invoice_events + api_logs tables) is in active use, so it belongs in the
graph. No-op body — merge only.
"""
from __future__ import annotations

from typing import Sequence, Union

revision: str = 'e7a4bd3e24d6'
down_revision: Union[str, Sequence[str], None] = ('20260530_0004', '20260522_0001')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
