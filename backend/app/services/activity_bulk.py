"""Bounded, set-based writes used by batch undo (no ORM flush or audit listener)."""

import uuid
from collections.abc import Iterator
from typing import Any

from sqlalchemy import Table, cast, column, func, insert, select, update, values
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

MAX_ROWS = 1000
MAX_PARAMETERS = 30_000


def _chunks(rows: list[dict[str, Any]]) -> Iterator[list[dict[str, Any]]]:
    if not rows:
        return
    size = min(MAX_ROWS, MAX_PARAMETERS // len(rows[0]))
    for offset in range(0, len(rows), size):
        yield rows[offset : offset + size]


def insert_rows(db: Session, table: Table, rows: list[dict[str, Any]]) -> None:
    for chunk in _chunks(rows):
        source = _row_source(table, chunk)
        db.execute(insert(table).from_select(list(chunk[0]), select(source)))


def _row_source(table: Table, rows: list[dict[str, Any]]):
    names = list(rows[0])
    # Bind one typed array per column, avoiding thousands of individual SQL parameters.
    arrays = values(
        *(column(name, ARRAY(table.c[name].type)) for name in names), name="undo_arrays"
    ).data([tuple([row[name] for row in rows] for name in names)])
    return (
        select(
            *(
                func.unnest(cast(arrays.c[name], ARRAY(table.c[name].type))).label(name)
                for name in names
            )
        )
        .select_from(arrays)
        .subquery("undo_values")
    )


def update_rows(db: Session, table: Table, rows: list[dict[str, Any]]) -> int:
    affected = 0
    for chunk in _chunks(rows):
        names = list(chunk[0])
        source = _row_source(table, chunk)
        # Explicit casts also type columns whose entire VALUES input is NULL.
        result = db.execute(
            update(table)
            .where(table.c.id == source.c.id)
            .values(
                {name: cast(source.c[name], table.c[name].type) for name in names if name != "id"}
            )
        )
        affected += result.rowcount
    return affected


def claim_rows(db: Session, table: Table, rows: list[dict[str, Any]]) -> set[uuid.UUID]:
    """Hold update locks on matching versions without changing content or timestamps."""
    matched = set()
    for chunk in _chunks(rows):
        source = _row_source(table, chunk)
        result = db.execute(
            update(table)
            .where(table.c.id == source.c.id, table.c.updated_at == source.c.updated_at)
            .values(updated_at=table.c.updated_at)
            .returning(table.c.id)
        )
        matched.update(result.scalars())
    return matched
