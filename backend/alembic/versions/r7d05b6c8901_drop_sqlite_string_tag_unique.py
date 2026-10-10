"""Drop the SQLite-only string_tags unique constraint.

Revision ID: r7d05b6c8901
Revises: q6c94f5a6789

The initial migration declared both a primary key and UniqueConstraint
uq_string_tag on (string_id, tag_id). Postgres keeps one primary key under
that name. SQLite keeps a separate UNIQUE, which `alembic check` reports
once the model stops declaring it. Drop that UNIQUE on SQLite only, and
rename the Postgres primary key to the name create_all uses.
"""

import sqlalchemy as sa

from alembic import op

revision = "r7d05b6c8901"
down_revision = "q6c94f5a6789"
branch_labels = None
depends_on = None


def _rename_pk(bind, old: str, new: str) -> None:
    # create_all and a pg_dump of a create_all database already use string_tags_pkey.
    if sa.inspect(bind).get_pk_constraint("string_tags").get("name") == old:
        op.execute(f"ALTER TABLE string_tags RENAME CONSTRAINT {old} TO {new}")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":  # parity with create_all naming
        _rename_pk(bind, "uq_string_tag", "string_tags_pkey")
        return
    uniques = {item["name"] for item in sa.inspect(bind).get_unique_constraints("string_tags")}
    if "uq_string_tag" in uniques:
        with op.batch_alter_table("string_tags") as batch_op:
            batch_op.drop_constraint("uq_string_tag", type_="unique")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        _rename_pk(bind, "string_tags_pkey", "uq_string_tag")
    else:
        with op.batch_alter_table("string_tags") as batch_op:
            batch_op.create_unique_constraint("uq_string_tag", ["string_id", "tag_id"])
