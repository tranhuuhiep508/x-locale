"""Module lock ordering and catalog changes between import lock reads."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import text

from app.config import settings
from app.models import Module
from app.services import catalog, import_bulk
from app.services.write_transactions import retryable_write_conflict
from tests.helpers import json_upload, publish_strings
from tests.test_activity_module_concurrency import wait_for_database_block
from tests.test_import_concurrency import catalog_state, import_request, seed_import_project
from tests.test_import_jobs import poll

CONFLICT = retryable_write_conflict("concurrent_modification").detail


@pytest.fixture()
def project(client, session_factory):
    return seed_import_project(client, session_factory)


def import_result(client, project, kind, **options):
    path, kwargs = import_request(project, "json" if kind == "job" else kind, **options)
    if kind == "job":
        kwargs["headers"] = {"Prefer": "respond-async"}
    response = client.post(path, **kwargs)
    if kind != "job":
        return response.status_code, response.json()
    assert response.status_code == 202, response.text
    job = poll(client, project, "json", response.json()["job_id"])
    if job["status"] == "completed":
        return 200, job["result"]
    assert job["status"] == "failed", job
    error = job["result"]["error"]
    return error["status_code"], {"detail": error["detail"]}


@pytest.mark.parametrize("winner", ["import", "delete"])
@pytest.mark.parametrize("kind", ["json", "job"])
def test_import_and_module_deletion_use_module_before_string_locks(
    client, project, session_factory, database_engine, monkeypatch, winner, kind
):
    monkeypatch.setattr(settings, "import_async_threshold", 1)
    root = f"/api/projects/{project['id']}"
    before = catalog_state(session_factory, project)
    mid = next(row["module_id"] for row in before["strings"].values() if row["key"] == "changed")
    paused, release, started = Event(), Event(), Event()
    pids = {}
    load = import_bulk._load_catalog
    clear = catalog._clear_module_refs
    lock = import_bulk._lock_import_modules
    run_write = catalog.run_write

    def pause_load(*args):
        result = load(*args)
        if winner == "import":
            paused.set()
            assert release.wait(10)
        return result

    def pause_clear(*args):
        if winner == "delete":
            paused.set()
            assert release.wait(10)
        return clear(*args)

    def track_import(db, *args):
        if winner == "delete":
            pids["waiter"] = db.scalar(text("SELECT pg_backend_pid()"))
            started.set()
        return lock(db, *args)

    def track_delete(db, *args, **kwargs):
        if winner == "import":
            pids["waiter"] = db.scalar(text("SELECT pg_backend_pid()"))
            started.set()
        return run_write(db, *args, **kwargs)

    monkeypatch.setattr(import_bulk, "_load_catalog", pause_load)
    monkeypatch.setattr(catalog, "_clear_module_refs", pause_clear)
    monkeypatch.setattr(import_bulk, "_lock_import_modules", track_import)
    monkeypatch.setattr(catalog, "run_write", track_delete)
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            if winner == "import":
                importing = pool.submit(import_result, client, project, kind)
                assert paused.wait(5)
                deleting = pool.submit(client.delete, f"{root}/modules/{mid}")
            else:
                deleting = pool.submit(client.delete, f"{root}/modules/{mid}")
                assert paused.wait(5)
                importing = pool.submit(import_result, client, project, kind)
            assert started.wait(5)
            wait_for_database_block(database_engine, pids["waiter"])
        finally:
            release.set()
        deleted = deleting.result(timeout=15)
        status, result = importing.result(timeout=15)
    assert deleted.status_code == 204, deleted.text
    assert status == (200 if winner == "import" else 409), result
    after = catalog_state(session_factory, project)
    assert uuid.UUID(mid) not in after["modules"]
    changed = next(row for row in after["strings"].values() if row["key"] == "changed")
    assert changed["module_id"] is None
    assert changed["published_module_id"] is None
    assert changed["source_text"] == ("Imported" if winner == "import" else "Before")
    if winner == "import":
        added = next(row for row in after["strings"].values() if row["key"] == "added")
        assert added["module_id"] is None
    else:
        assert not any(row["key"] == "added" for row in after["strings"].values())
        assert after["activities"] == before["activities"]


@pytest.mark.parametrize("kind", ["json", "cli", "xlsx", "job"])
@pytest.mark.parametrize("candidate", ["live", "tombstone", "duplicate"])
def test_rename_into_incoming_key_rejects_without_import_writes(
    client, project, session_factory, monkeypatch, kind, candidate
):
    monkeypatch.setattr(settings, "import_async_threshold", 1)
    root = f"/api/projects/{project['id']}"
    if candidate == "duplicate":
        assert client.patch(root, json={"allow_duplicate_keys": True}).status_code == 200
        response = client.post(f"{root}/strings", json={"key": "added", "source_text": "Other"})
        assert response.status_code == 201, response.text
    before = catalog_state(session_factory, project)
    entry = next(row for row in before["strings"].values() if row["key"] == "unrelated")
    mid = next(row["module_id"] for row in before["strings"].values() if row["key"] == "changed")
    paused, release = Event(), Event()
    load = import_bulk._load_catalog

    def pause_before_load(*args):
        paused.set()
        assert release.wait(10)
        return load(*args)

    with monkeypatch.context() as patch, ThreadPoolExecutor(max_workers=1) as pool:
        patch.setattr(import_bulk, "_load_catalog", pause_before_load)
        importing = pool.submit(import_result, client, project, kind)
        try:
            assert paused.wait(5)
            saved = client.patch(
                f"{root}/strings/{entry['id']}",
                json={"key": "added", "module_id": mid},
            )
            assert saved.status_code == 200, saved.text
            saved = client.patch(
                f"{root}/strings/{entry['id']}",
                json={
                    "description": "Earlier editor context",
                    "translations": {"en": "Earlier English"},
                },
            )
            assert saved.status_code == 200, saved.text
            if candidate == "tombstone":
                assert client.delete(f"{root}/strings/{entry['id']}").status_code == 204
            after_edit = catalog_state(session_factory, project)
        finally:
            release.set()
        status, body = importing.result(timeout=15)
    assert status == 409, body
    assert body == {"detail": CONFLICT}
    assert catalog_state(session_factory, project) == after_edit
    # CLI pushes deliberately reject tombstones; restore before retrying that case.
    if candidate == "tombstone":
        restored = client.post(
            f"{root}/strings/batch", json={"action": "restore", "string_ids": [entry["id"]]}
        )
        assert restored.status_code == 200, restored.text
        after_edit = catalog_state(session_factory, project)
    status, result = import_result(client, project, kind)
    assert status == 200, result
    undone = client.post(f"{root}/activities/batch/{result['batch_id']}/revert")
    assert undone.status_code == 200, undone.text
    assert catalog_state(session_factory, project)["strings"] == after_edit["strings"]


@pytest.mark.parametrize("published", [False, True])
def test_module_reference_changed_before_string_lock_is_rejected(
    client, project, session_factory, monkeypatch, published
):
    root = f"/api/projects/{project['id']}"
    new_module = client.post(f"{root}/modules", json={"slug": "other", "name": "Other"}).json()
    before = catalog_state(session_factory, project)
    entry = next(row for row in before["strings"].values() if row["key"] == "changed")
    paused, release = Event(), Event()
    lock = import_bulk._lock_import_entries

    def pause_before_strings(*args):
        paused.set()
        assert release.wait(10)
        return lock(*args)

    monkeypatch.setattr(import_bulk, "_lock_import_entries", pause_before_strings)
    with ThreadPoolExecutor(max_workers=1) as pool:
        importing = pool.submit(import_result, client, project, "json")
        try:
            assert paused.wait(5)
            url = f"{root}/strings/{entry['id']}"
            assert client.patch(url, json={"module_id": new_module["id"]}).status_code == 200
            if published:
                publish_strings(client, project["id"], [entry["id"]])
                assert client.patch(url, json={"module_id": entry["module_id"]}).status_code == 200
            after_edit = catalog_state(session_factory, project)
        finally:
            release.set()
        status, body = importing.result(timeout=15)
    assert status == 409 and body == {"detail": CONFLICT}
    assert catalog_state(session_factory, project) == after_edit


@pytest.mark.parametrize("phase", ["catalog", "insert"])
def test_concurrently_discovered_module_is_not_adopted_without_lock(
    client, project, session_factory, monkeypatch, phase
):
    root = f"/api/projects/{project['id']}"
    load, insert = import_bulk._load_catalog, import_bulk.insert_rows
    external = {}

    def create_module():
        response = client.post(f"{root}/modules", json={"slug": "new", "name": "External"})
        assert response.status_code == 201, response.text
        external.update(catalog_state(session_factory, project))

    def before_load(*args):
        if phase == "catalog":
            create_module()
        return load(*args)

    def before_insert(db, table, rows, **kwargs):
        if phase == "insert" and table is Module.__table__:
            create_module()
        return insert(db, table, rows, **kwargs)

    monkeypatch.setattr(import_bulk, "_load_catalog", before_load)
    monkeypatch.setattr(import_bulk, "insert_rows", before_insert)
    response = client.post(
        f"{root}/import",
        files=json_upload(
            {
                "modules": {
                    "new": {"vi": {"fresh": "Created"}},
                    "own": {"vi": {"own-key": "Created"}},
                }
            }
        ),
    )
    assert response.status_code == 409, response.text
    assert response.json() == {"detail": CONFLICT}
    assert catalog_state(session_factory, project) == external
