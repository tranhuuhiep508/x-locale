"""Deterministic query budgets for the measured rich Undo workload."""

from collections import Counter

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.database import register_activity_listener
from app.models import Project
from app.services.activities import preview_revert_batch, revert_batch
from benchmarks.undo import ACTOR, engine_for, seed, sql_counter, validate


@pytest.mark.parametrize("size", [25, 100])
@pytest.mark.parametrize("force", [False, True])
def test_rich_undo_read_budget_preserves_exact_audit_snapshots(tmp_path, size, force):
    register_activity_listener()
    path = tmp_path / "benchmark.db"
    project_id, batch, locales = seed(path, size, True, force)
    engine = engine_for(path)
    try:
        with Session(engine, autoflush=False) as db:
            project = db.get(Project, project_id)
            counter = Counter()
            hook = sql_counter(counter)
            event.listen(engine, "before_cursor_execute", hook)
            try:
                preview = preview_revert_batch(db, project, batch)
            finally:
                event.remove(engine, "before_cursor_execute", hook)
            assert preview.can_revert and preview.requires_force == force
            assert counter["select"] <= 30  # Bulk reads, including bounded collection loading.
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = dict(ACTOR)
            project = db.get(Project, project_id)
            counter = Counter()
            hook = sql_counter(counter)
            event.listen(engine, "before_cursor_execute", hook)
            try:
                assert revert_batch(db, project, batch, force=force)["reverted"] == size
            finally:
                event.remove(engine, "before_cursor_execute", hook)
            assert counter["string_full_loads"] <= 2 * size
            assert counter["select"] <= 12 * size + 30
        validate(engine, batch, size, True, locales, force)
    finally:
        engine.dispose()
