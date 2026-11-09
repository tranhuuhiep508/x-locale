"""Pin project slugs to collation C.

Slugs are identifiers: unique, compared exactly, and exported as names.
COLLATE "C" keeps that index on byte order on every database locale, the same
way module slugs already work. Free text stays on the database collation.

Revision ID: v1b49f0a2345
Revises: u0a38e9f1234
"""

from alembic import op

revision = "v1b49f0a2345"
down_revision = "u0a38e9f1234"
branch_labels = None
depends_on = None

# Length is frozen here on purpose; migrations must not follow app/limits.py.
_SLUG_LENGTH = 128


def _set_collation(collation: str) -> None:
    # Postgres rebuilds the unique index as part of the ALTER.
    op.execute(
        "ALTER TABLE projects ALTER COLUMN slug "
        f'TYPE varchar({_SLUG_LENGTH}) COLLATE "{collation}"'
    )


def upgrade() -> None:
    _set_collation("C")


def downgrade() -> None:
    _set_collation("default")
