"""Denormalize string created/updated actor metadata.

Revision ID: j0e15c6d7e8f
Revises: h8c93a4b5d6e
Create Date: 2026-09-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "j0e15c6d7e8f"
down_revision = "h8c93a4b5d6e"
branch_labels = None
depends_on = None

_ACTOR_TYPE = sa.Enum("user", "api_key", "system", name="actortype", native_enum=False)


def upgrade() -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_by_type", _ACTOR_TYPE, nullable=True))
        batch_op.add_column(sa.Column("created_by_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("created_by_label", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("updated_by_type", _ACTOR_TYPE, nullable=True))
        batch_op.add_column(sa.Column("updated_by_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("updated_by_label", sa.String(length=255), nullable=True))

    op.execute(
        """
        UPDATE strings SET
          updated_by_type = (
            SELECT a.actor_type FROM activities a
            WHERE a.string_id = strings.id
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 1
          ),
          updated_by_id = (
            SELECT a.actor_id FROM activities a
            WHERE a.string_id = strings.id
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 1
          ),
          updated_by_label = (
            SELECT a.actor_label FROM activities a
            WHERE a.string_id = strings.id
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 1
          )
        """
    )

    op.execute(
        """
        UPDATE strings SET
          created_by_type = (
            SELECT a.actor_type FROM activities a
            WHERE a.string_id = strings.id
            ORDER BY a.created_at ASC, a.id ASC
            LIMIT 1
          ),
          created_by_id = (
            SELECT a.actor_id FROM activities a
            WHERE a.string_id = strings.id
            ORDER BY a.created_at ASC, a.id ASC
            LIMIT 1
          ),
          created_by_label = (
            SELECT a.actor_label FROM activities a
            WHERE a.string_id = strings.id
            ORDER BY a.created_at ASC, a.id ASC
            LIMIT 1
          )
        """
    )

    op.execute(
        """
        UPDATE strings SET
          created_by_type = updated_by_type,
          created_by_id = updated_by_id,
          created_by_label = updated_by_label
        WHERE created_by_label IS NULL AND updated_by_label IS NOT NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.drop_column("updated_by_label")
        batch_op.drop_column("updated_by_id")
        batch_op.drop_column("updated_by_type")
        batch_op.drop_column("created_by_label")
        batch_op.drop_column("created_by_id")
        batch_op.drop_column("created_by_type")
