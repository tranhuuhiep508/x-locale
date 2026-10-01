"""Require string module refs to belong to the same project.

Revision ID: l1c38f9a0123
Revises: k0f16d7e8f9a
Create Date: 2026-10-01

"""

from __future__ import annotations

from alembic import op
from app.services.catalog import scrub_foreign_module_refs

revision = "l1c38f9a0123"
down_revision = "k0f16d7e8f9a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing rows may point at another project's module. Null them before the
    # composite foreign key is added so the migration can apply.
    scrub_foreign_module_refs(op.get_bind())

    with op.batch_alter_table("modules", schema=None) as batch_op:
        batch_op.create_unique_constraint("uq_module_project_id", ["project_id", "id"])

    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.create_foreign_key(
            "fk_strings_project_module",
            "modules",
            ["project_id", "module_id"],
            ["project_id", "id"],
            ondelete="NO ACTION",
        )
        batch_op.create_foreign_key(
            "fk_strings_project_published_module",
            "modules",
            ["project_id", "published_module_id"],
            ["project_id", "id"],
            ondelete="NO ACTION",
        )


def downgrade() -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.drop_constraint("fk_strings_project_published_module", type_="foreignkey")
        batch_op.drop_constraint("fk_strings_project_module", type_="foreignkey")

    with op.batch_alter_table("modules", schema=None) as batch_op:
        batch_op.drop_constraint("uq_module_project_id", type_="unique")
