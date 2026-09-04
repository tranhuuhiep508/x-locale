"""Add AI confidence score on translations.

Revision ID: f6a718293b4c
Revises: f60718293b4c
Create Date: 2026-09-04

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f6a718293b4c"
down_revision = "f60718293b4c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("confidence", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.drop_column("confidence")
