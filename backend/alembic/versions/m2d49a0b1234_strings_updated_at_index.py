"""Reuse the shared strings updated_at index from catalog sorting.

Revision ID: m2d49a0b1234
Revises: m2d49g0b1234
Create Date: 2026-10-04

"""

from __future__ import annotations

revision = "m2d49a0b1234"
down_revision = "m2d49g0b1234"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Catalog sorting owns the shared index. Retain this revision so databases
    # already upgraded on the time-range branch still have a recognized head.
    pass


def downgrade() -> None:
    # The index must remain while the catalog sorting revision is applied.
    pass
