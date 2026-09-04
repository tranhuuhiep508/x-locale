"""Placeholder for a local revision stamp that has no script file.

The SQLite database was already at this revision with the soft-delete schema
applied. This no-op restores the chain so later revisions can run.

Revision ID: f60718293b4c
Revises: e5f60718293a
Create Date: 2026-09-04

"""

from __future__ import annotations

revision = "f60718293b4c"
down_revision = "e5f60718293a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
