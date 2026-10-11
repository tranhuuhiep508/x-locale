"""XLOCALE-47: real row locks, atomic retries, and fresh request authorization."""

import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, create_session_token, hash_api_key
from app.models import Activity, ApiKey, Module, ProjectMember, StringEntry, User
from app.services import activities, catalog, write_transactions
from app.services.activity_state import SnapshotReferences
from tests.helpers import make_project, publish_strings
from tests.test_write_transactions import database_error


@pytest.fixture()
def no_retry_delay(monkeypatch):
    delays = []
    monkeypatch.setattr(write_transactions.time, "sleep", delays.append)
    return delays


def setup_batch(client, session_factory):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    mid = client.post(f"{root}/modules", json={"slug": "auth", "name": "Auth"}).json()["id"]
    ids, versions = [], []
    for key in ("a", "b"):
        created = client.post(
            f"{root}/strings", json={"key": key, "source_text": "A1", "module_id": mid}
        )
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        ids.append(sid)
        versions.append(client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"])
    publish_strings(client, pid, ids)
    imported = client.post(f"{root}/strings/import", json={"strings": {"a": "A2", "b": "A2"}})
    assert imported.status_code == 200, imported.text
    batch = imported.json()["batch_id"]
    with session_factory() as db:
        edit = (
            db.query(Activity)
            .filter(Activity.batch_id == uuid.UUID(batch), Activity.string_id == uuid.UUID(ids[0]))
            .one()
        )
        edit_id = str(edit.id)
        baseline = db.query(Activity).count()
        admin = db.query(User).filter(User.oidc_issuer == "x-locale-dev").one()
        client.cookies.set(SESSION_COOKIE, create_session_token(admin))
        user_id = admin.id
    return dict(
        pid=pid,
        root=root,
        mid=mid,
        ids=ids,
        versions=versions,
        batch=batch,
        edit_id=edit_id,
        baseline=baseline,
        user_id=user_id,
    )


def undo_request(client, case, operation="batch", *, force=True, headers=None):
    root = case["root"]
    if operation == "batch":
        return client.post(
            f"{root}/activities/batch/{case['batch']}/revert",
            params={"force": force},
            headers=headers,
        )
    if operation == "single":
        return client.post(
            f"{root}/activities/{case['edit_id']}/revert", params={"force": force}, headers=headers
        )
    if operation == "version":
        return client.post(
            f"{root}/strings/{case['ids'][0]}/activities/{case['versions'][0]}/restore",
            headers=headers,
        )
    return client.post(
        f"{root}/strings/batch",
        json={"action": "restore_last_history", "string_ids": case["ids"]},
        headers=headers,
    )


def wait_for_database_block(database_engine, waiter_pid):
    deadline = time.monotonic() + 5
    with database_engine.connect() as observer:
        while time.monotonic() < deadline:
            if observer.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": waiter_pid}
            ):
                return
    pytest.fail("request did not reach the expected Postgres lock wait")


@pytest.mark.parametrize("operation", ["batch", "single", "version", "last_history"])
@pytest.mark.parametrize("winner", ["undo", "delete"])
def test_undo_and_delete_use_module_before_string_order(
    client, session_factory, database_engine, monkeypatch, no_retry_delay, operation, winner
):
    case = setup_batch(client, session_factory)
    held, resume, waiter_started = Event(), Event(), Event()
    pids = {}
    load = SnapshotReferences._load_modules
    clear = catalog._clear_module_refs
    run_delete = catalog.run_write
    paused = False

    def load_modules(self, ids):
        nonlocal paused
        if not self.lock_modules:
            return load(self, ids)
        if "undo" not in pids:
            self.db.execute(text("SET LOCAL statement_timeout = '10s'"))
            pids["undo"] = self.db.scalar(text("SELECT pg_backend_pid()"))
            if winner == "delete":
                waiter_started.set()
        load(self, ids)
        if winner == "undo" and not paused:
            paused = True
            held.set()
            assert resume.wait(7)

    def delete_transaction(db, project_id, operation_name, write):
        db.execute(text("SET LOCAL statement_timeout = '10s'"))
        pids["delete"] = db.scalar(text("SELECT pg_backend_pid()"))
        if winner == "undo":
            waiter_started.set()
        return run_delete(db, project_id, operation_name, write)

    def clear_refs(db, project_id, module_id):
        clear(db, project_id, module_id)
        if winner == "delete":
            held.set()
            assert resume.wait(7)

    monkeypatch.setattr(SnapshotReferences, "_load_modules", load_modules)
    monkeypatch.setattr(catalog, "run_write", delete_transaction)
    monkeypatch.setattr(catalog, "_clear_module_refs", clear_refs)

    def undo():
        return undo_request(client, case, operation)

    def delete():
        return client.delete(f"{case['root']}/modules/{case['mid']}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(undo if winner == "undo" else delete)
        try:
            assert held.wait(5)
            second = pool.submit(delete if winner == "undo" else undo)
            assert waiter_started.wait(5)
            wait_for_database_block(database_engine, pids["delete" if winner == "undo" else "undo"])
        finally:
            resume.set()
        first_result, second_result = first.result(timeout=12), second.result(timeout=12)
    undone, deleted = (
        (first_result, second_result) if winner == "undo" else (second_result, first_result)
    )
    assert undone.status_code == 200, undone.text
    assert deleted.status_code == 204, deleted.text
    assert no_retry_delay == []
    with session_factory() as db:
        assert db.get(Module, uuid.UUID(case["mid"])) is None
        rows = db.query(StringEntry).all()
        assert all(row.module_id is None and row.published_module_id is None for row in rows)
        assert sum(row.source_text == "A1" for row in rows) == (
            1 if operation in {"single", "version"} else 2
        )


@pytest.mark.parametrize("operation", ["batch", "single", "version", "last_history"])
def test_delete_completed_before_preload_clears_historical_refs(client, session_factory, operation):
    case = setup_batch(client, session_factory)
    assert client.delete(f"{case['root']}/modules/{case['mid']}").status_code == 204
    response = undo_request(client, case, operation)
    assert response.status_code == 200, response.text
    with session_factory() as db:
        assert all(
            row.module_id is None and row.published_module_id is None
            for row in db.query(StringEntry)
        )


@pytest.mark.parametrize("column", ["module_id", "published_module_id"])
@pytest.mark.parametrize("persistent", [False, True])
def test_real_fk_failure_after_prior_inverse_flush_retries_atomically(
    client, session_factory, monkeypatch, no_retry_delay, column, persistent
):
    case = setup_batch(client, session_factory)
    execute = activities._execute_inverse
    calls = []

    def fail_second_inverse(db, activity, *, force, references):
        calls.append(force)
        result = execute(db, activity, force=force, references=references)
        if len(calls) == 2 or (persistent and len(calls) == 4):
            # The first inverse and its marker already flushed in this attempt.
            db.execute(
                text(f"UPDATE strings SET {column} = :missing WHERE id = :id"),
                {"missing": uuid.uuid4(), "id": uuid.UUID(activity.entity_id)},
            )
        return result

    monkeypatch.setattr(activities, "_execute_inverse", fail_second_inverse)
    response = undo_request(client, case)
    assert response.status_code == (409 if persistent else 200), response.text
    if persistent:
        assert response.json()["detail"] == write_transactions.retryable_write_conflict(
            "module_reference_conflict"
        ).detail
    assert calls == [True] * 4 and len(no_retry_delay) == 1
    with session_factory() as db:
        assert db.query(Activity).count() == case["baseline"] + (0 if persistent else 2)
        originals = db.query(Activity).filter(Activity.batch_id == uuid.UUID(case["batch"])).all()
        if persistent:
            assert all(activity.reverted_by_id is None for activity in originals)
        else:
            assert all(activity.reverted_by_id for activity in originals)
            assert len({activity.reverted_by_id for activity in originals}) == 2
        assert all(row.source_text == ("A2" if persistent else "A1") for row in db.query(StringEntry))


@pytest.mark.parametrize("operation", ["batch", "single", "version", "last_history", "delete"])
def test_commit_deadlock_retries_whole_operation_once(
    client, session_factory, monkeypatch, no_retry_delay, operation
):
    case = setup_batch(client, session_factory)
    commit = Session.commit
    calls = []

    def fail_first_commit(db):
        calls.append(True)
        if len(calls) == 1:
            db.flush()
            raise database_error()
        return commit(db)

    monkeypatch.setattr(Session, "commit", fail_first_commit)
    response = (
        client.delete(f"{case['root']}/modules/{case['mid']}")
        if operation == "delete"
        else undo_request(client, case, operation)
    )
    assert response.status_code == (204 if operation == "delete" else 200), response.text
    assert len(calls) == 2 and len(no_retry_delay) == 1
    with session_factory() as db:
        expected_rows = (
            0 if operation == "delete" else (1 if operation in {"single", "version"} else 2)
        )
        assert db.query(Activity).count() == case["baseline"] + expected_rows


@pytest.mark.parametrize("authority", ["membership", "session", "api_key"])
def test_retry_rechecks_request_authorization(client, session_factory, monkeypatch, authority):
    case = setup_batch(client, session_factory)
    headers = None
    if authority == "api_key":
        created = client.post(f"{case['root']}/api-keys", json={"name": "retry key"})
        assert created.status_code == 201, created.text
        raw_key = created.json()["key"]
        headers = {"X-API-Key": raw_key}
    load = SnapshotReferences._load_modules
    calls = []

    def deadlock_once(self, ids):
        load(self, ids)
        if self.lock_modules:
            calls.append(True)
            if len(calls) == 1:
                raise database_error()

    def revoke_during_backoff(delay):
        assert 0.05 <= delay <= 0.15
        with session_factory() as other:
            if authority == "membership":
                other.query(ProjectMember).filter(
                    ProjectMember.project_id == uuid.UUID(case["pid"]),
                    ProjectMember.user_id == case["user_id"],
                ).delete()
            elif authority == "session":
                other.get(User, case["user_id"]).token_version += 1
            else:
                from datetime import UTC, datetime

                other.query(ApiKey).filter(ApiKey.key_hash == hash_api_key(raw_key)).update(
                    {ApiKey.revoked_at: datetime.now(UTC)}
                )
            other.commit()

    monkeypatch.setattr(SnapshotReferences, "_load_modules", deadlock_once)
    monkeypatch.setattr(write_transactions.time, "sleep", revoke_during_backoff)
    response = undo_request(client, case, headers=headers)
    assert response.status_code == (404 if authority == "membership" else 401), response.text
    assert calls == [True]
    with session_factory() as db:
        assert db.query(Activity).count() == case["baseline"]
        assert all(row.source_text == "A2" for row in db.query(StringEntry))


@pytest.mark.parametrize("operation", ["batch", "single"])
def test_retry_does_not_force_over_a_new_content_conflict(
    client, session_factory, monkeypatch, operation
):
    case = setup_batch(client, session_factory)
    execute = activities._execute_inverse
    calls = []

    def deadlock_once(db, activity, *, force, references):
        calls.append(force)
        if len(calls) == 1:
            raise database_error()
        return execute(db, activity, force=force, references=references)

    def edit_during_backoff(delay):
        with session_factory() as db:
            db.get(StringEntry, uuid.UUID(case["ids"][0])).source_text = "A3"
            db.commit()

    monkeypatch.setattr(activities, "_execute_inverse", deadlock_once)
    monkeypatch.setattr(write_transactions.time, "sleep", edit_during_backoff)
    response = undo_request(client, case, operation, force=False)
    assert response.status_code == 409, response.text
    assert "Pass force=true" in response.json()["detail"]
    assert all(force is False for force in calls)
    with session_factory() as db:
        assert db.get(StringEntry, uuid.UUID(case["ids"][0])).source_text == "A3"
        assert not db.query(Activity).filter(Activity.revert_of_id.isnot(None)).count()


def test_preview_has_no_row_lock_and_nonkey_module_edit_is_allowed(client, session_factory):
    case = setup_batch(client, session_factory)
    with session_factory() as preview, session_factory() as edit:
        refs = SnapshotReferences(preview, uuid.UUID(case["pid"]), [{"module_id": case["mid"]}])
        assert refs.module(case["mid"]) == case["mid"]
        edit.execute(text("SET LOCAL lock_timeout = '1s'"))
        edit.execute(
            text("SELECT id FROM modules WHERE id = :id FOR UPDATE"), {"id": uuid.UUID(case["mid"])}
        )
        edit.rollback()
        SnapshotReferences(
            preview, uuid.UUID(case["pid"]), [{"module_id": case["mid"]}], lock_modules=True
        )
        edit.execute(text("SET LOCAL lock_timeout = '1s'"))
        edit.query(Module).filter(Module.id == uuid.UUID(case["mid"])).update(
            {Module.name: "Renamed"}
        )
        edit.commit()
