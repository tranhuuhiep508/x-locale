"""Partial index for strings catalog updated_at sort.

Revision ID: m2d49g0b1234
Revises: l1c38f9a0123
Create Date: 2026-10-04
"""

from __future__ import annotations

from alembic import op

revision = "m2d49g0b1234"
down_revision = "l1c38f9a0123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX ix_strings_project_updated_at_alive
        ON strings (project_id, updated_at)
        WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_strings_project_updated_at_alive")
