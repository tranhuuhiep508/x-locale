"""Project membership roles and admin backfill from created_by.

Revision ID: o4f61c2d3456
Revises: n3e50b1c2345
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "o4f61c2d3456"
down_revision = "n3e50b1c2345"
branch_labels = None
depends_on = None


def _norm(value: object) -> str:
    return str(value).replace("-", "").lower()


def backfill_project_admins(connection: sa.Connection) -> int:
    """Insert an Admin membership for each project with created_by, if missing.

    Projects with created_by IS NULL are skipped. Existing rows are left
    unchanged, including a creator who was later demoted to editor.
    """
    projects = connection.execute(
        sa.text("SELECT id, created_by FROM projects WHERE created_by IS NOT NULL")
    ).fetchall()
    existing = connection.execute(
        sa.text("SELECT project_id, user_id FROM project_members")
    ).fetchall()
    have = {(_norm(row[0]), _norm(row[1])) for row in existing}
    members = sa.table(
        "project_members",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("project_id", sa.Uuid(as_uuid=True)),
        sa.column("user_id", sa.Uuid(as_uuid=True)),
        sa.column("role", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(UTC)
    pending: list[dict[str, object]] = []
    for project_id, user_id in projects:
        if (_norm(project_id), _norm(user_id)) in have:
            continue
        pending.append(
            {
                "id": uuid.uuid4(),
                "project_id": uuid.UUID(_norm(project_id)),
                "user_id": uuid.UUID(_norm(user_id)),
                "role": "admin",
                "created_at": now,
            }
        )
    if pending:
        connection.execute(members.insert(), pending)
    return len(pending)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "project_members" not in inspector.get_table_names():
        op.create_table(
            "project_members",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("project_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column(
                "role",
                sa.Enum("admin", "editor", name="memberrole", native_enum=False, length=16),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("project_id", "user_id", name="uq_project_member"),
        )
        op.create_index("ix_project_members_project_id", "project_members", ["project_id"])
        op.create_index("ix_project_members_user_id", "project_members", ["user_id"])
    backfill_project_admins(bind)


def downgrade() -> None:
    op.drop_index("ix_project_members_user_id", table_name="project_members")
    op.drop_index("ix_project_members_project_id", table_name="project_members")
    op.drop_table("project_members")
