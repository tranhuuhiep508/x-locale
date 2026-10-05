"""Optional project and module translation context.

Revision ID: n3e50b1c2345
Revises: m2d49a0b1234
"""

import sqlalchemy as sa
from alembic import op

revision = "n3e50b1c2345"
down_revision = "m2d49a0b1234"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("translation_context", sa.Text(), nullable=True))
    op.add_column("modules", sa.Column("translation_context", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("modules", "translation_context")
    op.drop_column("projects", "translation_context")
