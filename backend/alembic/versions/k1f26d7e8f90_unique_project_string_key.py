"""One live string key per project.

Revision ID: k1f26d7e8f90
Revises: j0e15c6d7e8f
Create Date: 2026-09-23

"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "k1f26d7e8f90"
down_revision = "j0e15c6d7e8f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    duplicates = conn.execute(
        sa.text(
            """
            SELECT project_id, key
            FROM strings
            WHERE deleted_at IS NULL
            GROUP BY project_id, key
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()
    if duplicates:
        listed = ", ".join(f"{project_id} key={key}" for project_id, key in duplicates)
        raise RuntimeError(
            "Cannot add uq_project_key_alive; live duplicate keys already exist: "
            f"{listed}"
        )

    op.execute("DROP INDEX IF EXISTS uq_project_module_key_alive")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_project_key_alive
        ON strings (project_id, key)
        WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_project_key_alive")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_project_module_key_alive
        ON strings (project_id, module_id, key)
        WHERE deleted_at IS NULL
        """
    )
