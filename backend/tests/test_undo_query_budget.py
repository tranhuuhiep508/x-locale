"""Set-based query budgets and exact audit snapshots for batch Undo."""

from collections import Counter

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.database import register_activity_listener
from app.models import Project
from app.services.activities import preview_revert_batch, revert_batch
from benchmarks.undo import ACTOR, engine_for, seed, sql_counter, validate


@pytest.mark.parametrize("size", [100, 1000])
@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize("rich", [False, True])
def test_undo_query_budget_preserves_exact_audit_snapshots(throwaway_database, size, force, rich):
    register_activity_listener()
    project_id, batch, locales = seed(throwaway_database, size, rich, force)
    engine = engine_for(throwaway_database)
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
            assert counter["statements"] <= 30, counter
            assert counter["string_full_loads"] == 1
            assert counter["executemany_calls"] == 0
            # Rich rows carry both module_id and published_module_id.
            # One preloaded SELECT covers every ref; a per-string lookup would be 2 * size.
            assert counter["module_reads"] == int(rich)
        validate(engine, batch, size, rich, locales, force)
    finally:
        engine.dispose()
