"""Move status from translations to strings.

Revision ID: a1b2c3d4e5f6
Revises: 62e6b7e3c195
Create Date: 2026-08-12

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f6"
down_revision = "62e6b7e3c195"
branch_labels = None
depends_on = None

status_enum = sa.Enum("draft", "public", name="translationstatus", native_enum=False)


def upgrade() -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                status_enum,
                nullable=False,
                server_default="draft",
            )
        )

    # Backfill: public only when all translation rows were public (and at least one existed).
    op.execute(
        """
        UPDATE strings
        SET status = 'public'
        WHERE id IN (
            SELECT string_id
            FROM translations
            GROUP BY string_id
            HAVING COUNT(*) > 0
               AND SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) = 0
        )
        """
    )

    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.drop_column("status")


def downgrade() -> None:
    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                status_enum,
                nullable=False,
                server_default="draft",
            )
        )

    # Copy string status to all translation rows for that string.
    op.execute(
        """
        UPDATE translations
        SET status = (
            SELECT strings.status
            FROM strings
            WHERE strings.id = translations.string_id
        )
        """
    )

    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.drop_column("status")
