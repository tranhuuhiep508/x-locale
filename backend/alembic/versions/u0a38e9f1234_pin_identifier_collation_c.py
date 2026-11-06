"""Pin identifier columns to collation C.

Keys, module slugs and tag names sort in byte order (same as Python sorted())
on any database collation, and their indexes no longer depend on glibc rules.
Free text keeps the database default so ILIKE folds non-ASCII case.

Revision ID: u0a38e9f1234
Revises: t9f27d8e0123
"""

from alembic import op

revision = "u0a38e9f1234"
down_revision = "t9f27d8e0123"
branch_labels = None
depends_on = None

# Lengths are frozen here on purpose; migrations must not follow app/limits.py.
_COLUMNS = (
    ("strings", "key", 512),
    ("strings", "published_key", 512),
    ("modules", "slug", 128),
    ("tags", "name", 128),
)


def _set_collation(collation: str) -> None:
    # Postgres rebuilds the indexes on each column as part of the ALTER.
    for table, column, length in _COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f'TYPE varchar({length}) COLLATE "{collation}"'
        )


def upgrade() -> None:
    _set_collation("C")


def downgrade() -> None:
    _set_collation("default")
