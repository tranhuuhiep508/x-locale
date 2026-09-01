"""Add event_type to activities and backfill from snapshots.

Revision ID: f60718293b4c
Revises: e5f60718293a
Create Date: 2026-09-01

"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

from app.services.activity_events import classify_event

revision = "f60718293b4c"
down_revision = "e5f60718293a"
branch_labels = None
depends_on = None


def _parse_json(raw: object) -> dict | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return value if isinstance(value, dict) else None
    return None


def upgrade() -> None:
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "event_type",
                sa.String(length=64),
                nullable=False,
                server_default="string.updated",
            )
        )
        batch_op.create_index(batch_op.f("ix_activities_event_type"), ["event_type"], unique=False)

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, action, before, after, batch_kind FROM activities")
    ).fetchall()
    for row in rows:
        classified = classify_event(
            action=row.action,
            before=_parse_json(row.before),
            after=_parse_json(row.after),
            batch_kind=row.batch_kind,
        )
        conn.execute(
            sa.text(
                "UPDATE activities SET event_type = :event_type, summary = :summary, locale = COALESCE(locale, :locale) "
                "WHERE id = :id"
            ),
            {
                "event_type": classified.event_type,
                "summary": classified.summary,
                "locale": classified.locale,
                "id": row.id,
            },
        )

    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.alter_column("event_type", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_activities_event_type"))
        batch_op.drop_column("event_type")
