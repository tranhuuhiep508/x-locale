"""Index current published snapshots for translation memory.

Revision ID: t9f27d8e0123
Revises: s8e16c7d9012
"""

from alembic import op
import sqlalchemy as sa

revision = "t9f27d8e0123"
down_revision = "s8e16c7d9012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_strings_published_source_trgm",
        "strings",
        ["published_source_text"],
        postgresql_using="gin",
        postgresql_ops={"published_source_text": "gin_trgm_ops"},
        postgresql_with={"fastupdate": "off"},
        postgresql_where=sa.text(
            "status = 'public' AND deleted_at IS NULL AND NOT pending_delete AND published_source_text IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_strings_published_source_trgm", table_name="strings")
    # The extension may serve other indexes; leave it installed.
