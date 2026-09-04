"""Restore activities.event_type after it was dropped in error.

g7b8293a4c5d dropped the column for old local DBs, but the Activity model still
writes event_type. CLI push then 500s with "table activities has no column
named event_type". Re-add the column when missing.

Revision ID: h8c93a4b5d6e
Revises: g7b8293a4c5d
Create Date: 2026-09-04

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "h8c93a4b5d6e"
down_revision = "g7b8293a4c5d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("activities")}
    if "event_type" in columns:
        return
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "event_type",
                sa.String(length=64),
                nullable=False,
                server_default="string.updated",
            )
        )
        batch_op.create_index("ix_activities_event_type", ["event_type"], unique=False)
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.alter_column("event_type", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("activities")}
    if "event_type" not in columns:
        return
    indexes = {index["name"] for index in inspector.get_indexes("activities")}
    with op.batch_alter_table("activities", schema=None) as batch_op:
        if "ix_activities_event_type" in indexes:
            batch_op.drop_index("ix_activities_event_type")
        batch_op.drop_column("event_type")
