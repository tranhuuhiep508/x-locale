"""Make string/module composite foreign keys deferrable.

Revision ID: q6c94f5a6789
Revises: p5b83e4f5678

The composite keys are ON DELETE NO ACTION. A composite SET NULL would also
null project_id. Immediate NO ACTION checks race the single-column
ON DELETE SET NULL triggers, and that order flips after pg_dump restore and
on a create_all schema. Deferring the checks until commit lets SET NULL win
on every Postgres version. Module delete also clears the refs in the app.
"""

from alembic import op

revision = "q6c94f5a6789"
down_revision = "p5b83e4f5678"
branch_labels = None
depends_on = None


def _replace_module_fks(*, deferrable: bool) -> None:
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.drop_constraint("fk_strings_project_published_module", type_="foreignkey")
        batch_op.drop_constraint("fk_strings_project_module", type_="foreignkey")
        options: dict[str, object] = {"ondelete": "NO ACTION"}
        if deferrable:
            options["deferrable"] = True
            options["initially"] = "DEFERRED"
        batch_op.create_foreign_key(
            "fk_strings_project_module",
            "modules",
            ["project_id", "module_id"],
            ["project_id", "id"],
            **options,
        )
        batch_op.create_foreign_key(
            "fk_strings_project_published_module",
            "modules",
            ["project_id", "published_module_id"],
            ["project_id", "id"],
            **options,
        )


def upgrade() -> None:
    _replace_module_fks(deferrable=True)


def downgrade() -> None:
    _replace_module_fks(deferrable=False)
