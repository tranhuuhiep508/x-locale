"""Composite indexes for activity feed queries.

Revision ID: i9d04b5c6e7f
Revises: h8c93a4b5d6e
Create Date: 2026-09-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "i9d04b5c6e7f"
down_revision = "h8c93a4b5d6e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("activities")}
    with op.batch_alter_table("activities", schema=None) as batch_op:
        if "ix_activities_project_created_at" not in indexes:
            batch_op.create_index(
                "ix_activities_project_created_at",
                ["project_id", "created_at"],
                unique=False,
            )
        if "ix_activities_project_batch_id" not in indexes:
            batch_op.create_index(
                "ix_activities_project_batch_id",
                ["project_id", "batch_id"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("activities")}
    with op.batch_alter_table("activities", schema=None) as batch_op:
        if "ix_activities_project_batch_id" in indexes:
            batch_op.drop_index("ix_activities_project_batch_id")
        if "ix_activities_project_created_at" in indexes:
            batch_op.drop_index("ix_activities_project_created_at")
