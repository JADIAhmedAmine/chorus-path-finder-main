"""Add chorus_flux_deposits table (Dépôt de flux module)

Revision ID: 20260530_0003
Revises: d55c148e31ff
Create Date: 2026-05-30

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260530_0003"
down_revision: Union[str, None] = "d55c148e31ff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chorus_flux_deposits",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(length=64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("nom_fichier", sa.String(length=255), nullable=False),
        sa.Column("format_flux", sa.String(length=64), nullable=False),
        sa.Column("syntaxe_flux", sa.String(length=64), nullable=False),
        sa.Column("avec_signature", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("id_utilisateur_courant", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("http_status", sa.Integer),
        sa.Column("code_retour", sa.Integer),
        sa.Column("libelle", sa.Text),
        sa.Column("date_depot", sa.String(length=32)),
        sa.Column("numero_flux_depot", sa.String(length=128)),
        sa.Column("raw_response", postgresql.JSONB),
        sa.Column("status_local", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_chorus_flux_deposits_tenant_created",
        "chorus_flux_deposits",
        ["tenant_id", "created_at"],
    )
    op.create_index(
        "ix_chorus_flux_deposits_tenant_status",
        "chorus_flux_deposits",
        ["tenant_id", "status_local"],
    )
    op.create_index(
        "ix_chorus_flux_deposits_numero",
        "chorus_flux_deposits",
        ["numero_flux_depot"],
    )


def downgrade() -> None:
    op.drop_index("ix_chorus_flux_deposits_numero", table_name="chorus_flux_deposits")
    op.drop_index("ix_chorus_flux_deposits_tenant_status", table_name="chorus_flux_deposits")
    op.drop_index("ix_chorus_flux_deposits_tenant_created", table_name="chorus_flux_deposits")
    op.drop_table("chorus_flux_deposits")
