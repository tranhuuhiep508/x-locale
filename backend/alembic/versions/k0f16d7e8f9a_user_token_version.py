"""Add users.token_version for session revocation on logout.

Revision ID: k0f16d7e8f9a
Revises: i9d04b5c6e7f
Create Date: 2026-09-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "k0f16d7e8f9a"
down_revision = "i9d04b5c6e7f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("token_version", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("token_version")
