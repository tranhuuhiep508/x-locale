"""Soft-delete strings instead of removing rows.

Revision ID: e5f60718293a
Revises: d4e5f6071829
Create Date: 2026-08-30

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5f60718293a"
down_revision = "d4e5f6071829"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.drop_constraint("uq_project_module_key", type_="unique")

    op.execute(
        """
        CREATE UNIQUE INDEX uq_project_module_key_alive
        ON strings (project_id, module_id, key)
        WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_project_module_key_alive")
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.create_unique_constraint(
            "uq_project_module_key", ["project_id", "module_id", "key"]
        )
        batch_op.drop_column("deleted_at")
