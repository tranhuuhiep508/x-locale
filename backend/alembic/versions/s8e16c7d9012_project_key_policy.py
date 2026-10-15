"""Configurable project-wide versus module-scoped string keys.

Revision ID: s8e16c7d9012
Revises: r7d05b6c8901
"""

import sqlalchemy as sa
from alembic import op

revision = "s8e16c7d9012"
down_revision = "r7d05b6c8901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("allow_duplicate_keys", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_unique_constraint("uq_project_key_policy", "projects", ["id", "allow_duplicate_keys"])
    op.add_column(
        "strings",
        sa.Column(
            "key_policy_allows_duplicates", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_foreign_key(
        "fk_strings_key_policy",
        "strings",
        "projects",
        ["project_id", "key_policy_allows_duplicates"],
        ["id", "allow_duplicate_keys"],
        onupdate="CASCADE",
        ondelete="CASCADE",
    )
    op.drop_index("uq_project_key_alive", table_name="strings")
    op.create_index(
        "uq_project_key_alive",
        "strings",
        ["project_id", "key"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND NOT key_policy_allows_duplicates"),
    )
    op.create_index(
        "uq_project_module_key_alive",
        "strings",
        ["project_id", "module_id", "key"],
        unique=True,
        postgresql_nulls_not_distinct=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    duplicates = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT project_id, key FROM strings WHERE deleted_at IS NULL "
                "GROUP BY project_id, key HAVING count(*) > 1"
            )
        )
        .fetchall()
    )
    if duplicates:
        raise RuntimeError(f"Resolve live duplicate keys before downgrade: {duplicates}")
    op.drop_index("uq_project_module_key_alive", table_name="strings")
    op.drop_index("uq_project_key_alive", table_name="strings")
    op.create_index(
        "uq_project_key_alive",
        "strings",
        ["project_id", "key"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_constraint("fk_strings_key_policy", "strings", type_="foreignkey")
    op.drop_column("strings", "key_policy_allows_duplicates")
    op.drop_constraint("uq_project_key_policy", "projects", type_="unique")
    op.drop_column("projects", "allow_duplicate_keys")
