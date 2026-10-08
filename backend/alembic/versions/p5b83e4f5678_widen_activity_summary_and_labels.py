"""Widen activity summaries and locale/actor columns that user input can fill.

Revision ID: p5b83e4f5678
Revises: o4f61c2d3456

activities.summary was varchar(512) and embeds the string key. Keys are
varchar(512), so "Created '<key>'" overflows on Postgres. Store the summary
as text. Locale tags accepted by the locale regex are up to 12 characters;
the old varchar(10) columns cannot hold them. Actor labels copy users.email,
which is varchar(320).
"""

import sqlalchemy as sa
from alembic import op

revision = "p5b83e4f5678"
down_revision = "o4f61c2d3456"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.alter_column(
            "summary",
            existing_type=sa.String(length=512),
            type_=sa.Text(),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "locale",
            existing_type=sa.String(length=10),
            type_=sa.String(length=16),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "actor_label",
            existing_type=sa.String(length=255),
            type_=sa.String(length=320),
            existing_nullable=False,
        )
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.alter_column(
            "base_language",
            existing_type=sa.String(length=10),
            type_=sa.String(length=16),
            existing_nullable=False,
        )
    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.alter_column(
            "locale",
            existing_type=sa.String(length=10),
            type_=sa.String(length=16),
            existing_nullable=False,
        )
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.alter_column(
            "created_by_label",
            existing_type=sa.String(length=255),
            type_=sa.String(length=320),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "updated_by_label",
            existing_type=sa.String(length=255),
            type_=sa.String(length=320),
            existing_nullable=True,
        )


_NARROW = [
    ("activities", "summary", 512),
    ("activities", "locale", 10),
    ("activities", "actor_label", 255),
    ("projects", "base_language", 10),
    ("translations", "locale", 10),
    ("strings", "created_by_label", 255),
    ("strings", "updated_by_label", 255),
]


def _assert_fits() -> None:
    bind = op.get_bind()
    for table, column, limit in _NARROW:
        n = bind.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE length({column}) > :n"),
            {"n": limit},
        ).scalar()
        if n:
            raise RuntimeError(
                f"Cannot downgrade p5b83e4f5678: {n} row(s) in {table}.{column} "
                f"exceed {limit} characters"
            )


def downgrade() -> None:
    _assert_fits()
    with op.batch_alter_table("strings", schema=None) as batch_op:
        batch_op.alter_column(
            "updated_by_label",
            existing_type=sa.String(length=320),
            type_=sa.String(length=255),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "created_by_label",
            existing_type=sa.String(length=320),
            type_=sa.String(length=255),
            existing_nullable=True,
        )
    with op.batch_alter_table("translations", schema=None) as batch_op:
        batch_op.alter_column(
            "locale",
            existing_type=sa.String(length=16),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.alter_column(
            "base_language",
            existing_type=sa.String(length=16),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.alter_column(
            "actor_label",
            existing_type=sa.String(length=320),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "locale",
            existing_type=sa.String(length=16),
            type_=sa.String(length=10),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "summary",
            existing_type=sa.Text(),
            type_=sa.String(length=512),
            existing_nullable=False,
        )
