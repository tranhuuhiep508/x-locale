"""No-op: do not drop activities.event_type.

This revision previously dropped event_type for older local DBs. The Activity
model still writes that column, so dropping it made CLI push 500. Leave the
column in place; h8c93a4b5d6e restores it when already dropped.

Revision ID: g7b8293a4c5d
Revises: f6a718293b4c
Create Date: 2026-09-04

"""

from __future__ import annotations

revision = "g7b8293a4c5d"
down_revision = "f6a718293b4c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
