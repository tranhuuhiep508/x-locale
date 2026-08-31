"""Add last-published snapshot columns on strings and translations.

Revision ID: d4e5f6071829
Revises: c3d4e5f60718
Create Date: 2026-08-30

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "d4e5f6071829"
down_revision = "c3d4e5f60718"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("published_key", sa.String(length=512), nullable=True))
        batch_op.add_column(sa.Column("published_module_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("published_source_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column("pending_delete", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_index(
            batch_op.f("ix_strings_published_module_id"),
            ["published_module_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            batch_op.f("fk_strings_published_module_id_modules"),
            "modules",
            ["published_module_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("published_value", sa.Text(), nullable=True))

    op.execute(
        """
        UPDATE strings
        SET published_key = key,
            published_module_id = module_id,
            published_source_text = source_text,
            published_at = CURRENT_TIMESTAMP
        WHERE status = 'public'
        """
    )
    op.execute(
        """
        UPDATE translations
        SET published_value = value
        WHERE string_id IN (SELECT id FROM strings WHERE status = 'public')
        """
    )

    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.alter_column("pending_delete", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.drop_column("published_value")

    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.drop_constraint(
            batch_op.f("fk_strings_published_module_id_modules"), type_="foreignkey"
        )
        batch_op.drop_index(batch_op.f("ix_strings_published_module_id"))
        batch_op.drop_column("pending_delete")
        batch_op.drop_column("published_at")
        batch_op.drop_column("published_source_text")
        batch_op.drop_column("published_module_id")
        batch_op.drop_column("published_key")
