"""provider connections and tokens (multi-tenant providers)

Revision ID: 20260621_0006
Revises: 20260607_0005
Create Date: 2026-06-21

Tables pour la couche providers multi-tenant (Iopole, etc.) : connexions et
cache de tokens, secrets chiffrés au repos (Fernet) côté application.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260621_0006"
down_revision: Union[str, None] = "20260607_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "provider_connections",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.String(64),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("environment", sa.String(16), nullable=False, server_default="ppd"),
        sa.Column("customer_id", sa.String(128), nullable=False),
        sa.Column("client_id", sa.String(255), nullable=False),
        sa.Column("client_secret_enc", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "provider", name="uq_provider_connections_tenant_provider"),
    )
    op.create_index("ix_provider_connections_tenant", "provider_connections", ["tenant_id"])

    op.create_table(
        "provider_tokens",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("provider_tokens")
    op.drop_index("ix_provider_connections_tenant", table_name="provider_connections")
    op.drop_table("provider_connections")
