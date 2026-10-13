"""Atomic stale-plan rejection and batch-scoped ownership reads on Postgres."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.models import Activity, Project, StringEntry
from app.services import activities, activity_bulk, write_transactions
from app.services.strings import promote_string
from benchmarks.undo import ACTOR, engine_for, seed
from tests.test_activity_module_concurrency import wait_for_database_block


@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize("edit", ["description", "translation", "publish"])
def test_edit_after_planning_rejects_even_forced_undo(throwaway_database, monkeypatch, force, edit):
    project_id, batch, _ = seed(throwaway_database, 2, True, force)
    engine = engine_for(throwaway_database)
    persist = activities._persist_revert_plan
    expected, calls = {}, []
    try:

        def save_after_planning(db, project_id, plan, **kwargs):
            calls.append(True)
            with Session(engine) as other:
                other.info["activity"] = {
                    "actor_type": "user",
                    "actor_id": "editor",
                    "actor_label": "Concurrent editor",
                }
                entry = other.scalar(
                    select(StringEntry)
                    .options(selectinload(StringEntry.translations), selectinload(StringEntry.tags))
                    .where(StringEntry.key == "bench.1")
                )
                if edit == "description":
                    entry.description = "Saved after planning"
                elif edit == "translation":
                    next(
                        t for t in entry.translations if t.locale == "en"
                    ).value = "New translation"
                else:
                    promote_string(entry)
                other.commit()
                expected.update(
                    {
                        row.id: activities._live_snapshot(row)
                        for row in other.scalars(select(StringEntry))
                    }
                )
            return persist(db, project_id, plan, **kwargs)

        monkeypatch.setattr(activities, "_persist_revert_plan", save_after_planning)
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = dict(ACTOR)
            with pytest.raises(HTTPException) as raised:
                activities.revert_batch(db, db.get(Project, project_id), batch, force=force)
            assert raised.value.status_code == 409
            assert (
                raised.value.detail
                == write_transactions.retryable_write_conflict("concurrent_modification").detail
            )
        assert calls == [True]  # A stale plan never triggers an automatic forced retry.
        with Session(engine) as db:
            assert {
                row.id: activities._live_snapshot(row) for row in db.scalars(select(StringEntry))
            } == expected
            assert db.scalar(select(func.count()).select_from(Activity)) == 3
            assert not db.scalar(select(Activity.id).where(Activity.revert_of_id.is_not(None)))
            assert not db.scalar(select(Activity.id).where(Activity.reverted_by_id.is_not(None)))
    finally:
        engine.dispose()


def test_writer_after_guard_waits_and_preserves_its_edit(throwaway_database, monkeypatch):
    project_id, batch, _ = seed(throwaway_database, 2, False, False)
    engine = engine_for(throwaway_database)
    guarded, release, writer_started = Event(), Event(), Event()
    pids = {}
    claim = activities.claim_rows
    try:

        def pause_after_guard(db, table, rows):
            matched = claim(db, table, rows)
            guarded.set()
            assert release.wait(7)
            return matched

        monkeypatch.setattr(activities, "claim_rows", pause_after_guard)

        def undo():
            with Session(engine, autoflush=False) as db:
                db.info["activity"] = dict(ACTOR)
                db.execute(text("SET LOCAL statement_timeout = '10s'"))
                return activities.revert_batch(db, db.get(Project, project_id), batch)

        def edit():
            with Session(engine) as db:
                db.info["activity"] = {**ACTOR, "actor_label": "Late editor"}
                db.execute(text("SET LOCAL statement_timeout = '10s'"))
                pids["writer"] = db.scalar(text("SELECT pg_backend_pid()"))
                db.scalar(
                    select(StringEntry).where(StringEntry.key == "bench.0")
                ).description = "After guard"
                writer_started.set()
                db.commit()

        with ThreadPoolExecutor(max_workers=2) as pool:
            undone = pool.submit(undo)
            try:
                assert guarded.wait(5)
                edited = pool.submit(edit)
                assert writer_started.wait(5)
                wait_for_database_block(engine, pids["writer"])
                assert not edited.done()
            finally:
                release.set()
            assert undone.result(timeout=12)["reverted"] == 2
            edited.result(timeout=12)
        with Session(engine) as db:
            entries = db.scalars(select(StringEntry)).all()
            assert all(row.source_text == "A1" for row in entries)
            assert next(row for row in entries if row.key == "bench.0").description == "After guard"
            markers = db.scalars(select(Activity).where(Activity.revert_of_id.is_not(None))).all()
            assert len(markers) == 2
            assert all(marker.after["description"] is None for marker in markers)
    finally:
        engine.dispose()


def test_guard_does_not_change_metadata_or_audit(throwaway_database):
    seed(throwaway_database, 2, True, False)
    engine = engine_for(throwaway_database)
    try:
        with Session(engine) as db:
            before = {
                entry.id: {c.name: getattr(entry, c.name) for c in StringEntry.__table__.columns}
                for entry in db.scalars(select(StringEntry))
            }
        versions = [{"id": sid, "updated_at": state["updated_at"]} for sid, state in before.items()]
        with Session(engine) as db:
            db.info["activity"] = {**ACTOR, "actor_label": "Guard actor"}
            assert activity_bulk.claim_rows(db, StringEntry.__table__, versions) == before.keys()
            db.commit()
        with Session(engine) as db:
            after = {
                entry.id: {c.name: getattr(entry, c.name) for c in StringEntry.__table__.columns}
                for entry in db.scalars(select(StringEntry))
            }
            assert before == after
            assert db.scalar(select(func.count()).select_from(Activity)) == 2
    finally:
        engine.dispose()


@pytest.mark.parametrize("old_key", ["bench.0", "", "unrelated.50000"])
def test_small_undo_reads_only_candidate_key_owners(throwaway_database, old_key):
    project_id, batch, _ = seed(throwaway_database, 1, False, False)
    engine = engine_for(throwaway_database)
    fetched, key_arrays = [], []
    try:
        with Session(engine) as db:
            db.info["activity"] = {**ACTOR, "batch_kind": "revert"}
            entry = db.scalar(select(StringEntry))
            entry.key = "renamed"
            original = db.scalar(select(Activity))
            original.before = {**original.before, "key": old_key}
            original.after = {**original.after, "key": "renamed"}
            db.commit()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO strings (id, project_id, key, source_text, status, pending_delete) "
                    "SELECT gen_random_uuid(), :pid, 'unrelated.' || value, 'Unrelated', 'draft', false "
                    "FROM generate_series(1, 50000) AS value"
                ),
                {"pid": project_id},
            )

        def count_owners(conn, cursor, statement, parameters, context, executemany):
            if statement.startswith("SELECT strings.key AS strings_key, strings.id AS strings_id"):
                fetched.append(cursor.rowcount)
                key_arrays.append(set(parameters["undo_keys"]))

        event.listen(engine, "after_cursor_execute", count_owners)
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = dict(ACTOR)
            project = db.get(Project, project_id)
            if old_key.startswith("unrelated."):
                with pytest.raises(HTTPException) as raised:
                    activities.revert_batch(db, project, batch)
                assert raised.value.detail["code"] == "key_conflict"
                assert raised.value.detail["key"] == old_key
            else:
                assert activities.revert_batch(db, project, batch)["reverted"] == 1
                assert (
                    db.scalar(select(StringEntry.id).where(StringEntry.key == old_key)) is not None
                )
        assert fetched == [2 if old_key.startswith("unrelated.") else 1]
        assert key_arrays == [{old_key, "renamed"}]
    finally:
        engine.dispose()
