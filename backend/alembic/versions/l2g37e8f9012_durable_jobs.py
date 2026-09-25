"""Persist translation targets and worker leases.

Revision ID: l2g37e8f9012
Revises: k0f16d7e8f9a
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "l2g37e8f9012"
down_revision = "k0f16d7e8f9a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("lease_owner", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0")
        )
    op.create_table(
        "job_targets",
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("string_id", sa.Uuid(), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_job_targets_job_position", "job_targets", ["job_id", "position"])
    # Jobs from the old web-process task runner have no persisted target list.
    op.execute(
        "UPDATE jobs SET status = 'failed', error = 'Interrupted by worker migration' "
        "WHERE status IN ('pending', 'running')"
    )


def downgrade() -> None:
    op.drop_index("ix_job_targets_job_position", table_name="job_targets")
    op.drop_table("job_targets")
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_column("attempts")
        batch_op.drop_column("lease_expires_at")
        batch_op.drop_column("lease_owner")
