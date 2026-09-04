"""Drop leftover activities.event_type column.

Older local SQLite databases still have a NOT NULL event_type column that the
current Activity model no longer writes. Saving a string then fails when the
audit row is inserted.

Revision ID: g7b8293a4c5d
Revises: f6a718293b4c
Create Date: 2026-09-04

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g7b8293a4c5d"
down_revision = "f6a718293b4c"
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.add_column(sa.Column("event_type", sa.String(length=64), nullable=True))
        batch_op.create_index("ix_activities_event_type", ["event_type"], unique=False)
