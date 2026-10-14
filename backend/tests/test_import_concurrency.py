"""Imports and undo share a nonblocking transaction lock on real Postgres."""

import asyncio
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from itertools import product
from threading import Event

import httpx
import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import select

from app.auth import SESSION_COOKIE, create_session_token
from app.main import app
from app.models import Activity, Module, StringEntry, Tag, User
from app.routers import sync as sync_router
from app.services import activities, imports, write_transactions
from app.services.import_lock import acquire_import_lock
from tests.helpers import json_upload, make_project, publish_strings
from tests.test_project_members import _add_user
from tests.test_write_transactions import database_error

BUSY = {
    "detail": {
        "code": "import_in_progress",
        "message": "An import is already running for this project, try again when it finishes.",
    }
}
KINDS = ("json", "xlsx", "cli")


@pytest.fixture()
def project(client, session_factory):
    return seed_import_project(client, session_factory)


def seed_import_project(client, session_factory):
    project = make_project(client, "Import locking")
    with session_factory() as db:
        admin = db.scalar(select(User).where(User.oidc_issuer == "x-locale-dev"))
        # Bypass auth updates the shared dev-user row and would obscure contention.
        client.cookies.set(SESSION_COOKIE, create_session_token(admin))
    root = f"/api/projects/{project['id']}"
    module = client.post(f"{root}/modules", json={"slug": "incoming", "name": "Incoming"})
    assert module.status_code == 201, module.text
    tag = client.post(f"{root}/tags", json={"name": "original"}).json()
    changed = client.post(
        f"{root}/strings",
        json={
            "key": "changed",
            "source_text": "Before",
            "description": "Original context",
            "module_id": module.json()["id"],
            "tag_ids": [tag["id"]],
            "translations": {"en": "Original English"},
        },
    )
    assert changed.status_code == 201, changed.text
    publish_strings(client, project["id"], [changed.json()["id"]])
    unrelated = client.post(
        f"{root}/strings", json={"key": "unrelated", "source_text": "Leave alone"}
    )
    assert unrelated.status_code == 201, unrelated.text
    key = client.post(f"{root}/api-keys", json={"name": "CLI test"})
    assert key.status_code == 201, key.text
    project["api_key"] = key.json()["key"]
    return project


def import_request(project, kind, *, ref=None, module="incoming", dry_run=False):
    root = f"/api/projects/{ref or project['id']}"
    values = {"changed": "Imported", "added": "Created"}
    params = {"dry_run": dry_run}
    if kind == "cli":
        return f"{root}/strings/import", {
            "json": {"modules": {module: {"vi": values}}},
            "headers": {"X-API-Key": project["api_key"]},
            "params": params,
        }
    if kind == "json":
        return f"{root}/import", {
            "files": json_upload({"modules": {module: {"vi": values, "en": values}}}),
            "params": params,
        }
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = module
    sheet.append(["key", "vi", "en", "description", "tags"])
    for key, value in values.items():
        sheet.append([key, value, value, "Imported context", "imported-tag"])
    raw = io.BytesIO()
    workbook.save(raw)
    return f"{root}/import", {
        "files": {"file": ("import.xlsx", raw.getvalue())},
        "params": params,
    }


def catalog_state(session_factory, project):
    pid = uuid.UUID(project["id"])
    with session_factory() as db:
        strings = db.scalars(select(StringEntry).where(StringEntry.project_id == pid)).all()
        return {
            "strings": {row.id: activities._live_snapshot(row) for row in strings},
            "modules": set(db.scalars(select(Module.id).where(Module.project_id == pid))),
            "tags": set(db.scalars(select(Tag.id).where(Tag.project_id == pid))),
            "activities": {
                row.id: (row.before, row.after, row.batch_id, row.reverted_by_id)
                for row in db.scalars(select(Activity).where(Activity.project_id == pid))
            },
        }


@contextmanager
def pause_lock(monkeypatch, owner):
    entered, release = Event(), Event()
    original = owner.acquire_import_lock

    def pause(db, project_id):
        original(db, project_id)
        if not entered.is_set():
            entered.set()
            assert release.wait(10), "Import test did not release the transaction"

    with monkeypatch.context() as patch:
        patch.setattr(owner, "acquire_import_lock", pause)
        try:
            yield entered, release
        finally:
            release.set()


@pytest.mark.parametrize("winner,loser", list(product(KINDS, repeat=2)))
def test_overlapping_import_rejects_without_writes_and_undo_restores_before_state(
    client, project, session_factory, monkeypatch, winner, loser
):
    before = catalog_state(session_factory, project)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pause_lock(monkeypatch, sync_router) as (entered, release):
            path, kwargs = import_request(project, winner)
            importing = pool.submit(client.post, path, **kwargs)
            try:
                assert entered.wait(5)
                path, kwargs = import_request(
                    project, loser, ref=project["slug"], module="rejected-module"
                )
                rejected = client.post(path, **kwargs)
                assert rejected.status_code == 409, rejected.text
                assert rejected.json() == BUSY
                assert catalog_state(session_factory, project) == before
            finally:
                release.set()
            imported = importing.result(timeout=10)
    assert imported.status_code == 200, imported.text
    batch = imported.json()["batch_id"]
    with session_factory() as db:
        audited = db.scalars(
            select(Activity)
            .where(Activity.batch_id == uuid.UUID(batch))
            .order_by(Activity.created_at, Activity.id)
        ).all()
        changed_before = next(
            row.before for row in audited if row.before and row.before["key"] == "changed"
        )
        original = next(row for row in before["strings"].values() if row["key"] == "changed")
        assert changed_before == original
    undone = client.post(f"/api/projects/{project['id']}/activities/batch/{batch}/revert")
    assert undone.status_code == 200, undone.text
    after = catalog_state(session_factory, project)["strings"]
    assert {sid: row for sid, row in after.items() if row["deleted_at"] is None} == before[
        "strings"
    ]
    assert next(row for row in after.values() if row["key"] == "added")["deleted_at"] is not None


@pytest.mark.asyncio
async def test_upload_does_not_block_shared_event_loop(client, project, monkeypatch):
    with pause_lock(monkeypatch, sync_router) as (entered, release):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            cookies=dict(client.cookies),
        ) as http:
            path, kwargs = import_request(project, "json")
            importing = asyncio.create_task(http.post(path, **kwargs))
            try:
                assert await asyncio.to_thread(entered.wait, 5)
                assert not importing.done()
                health, catalog = await asyncio.wait_for(
                    asyncio.gather(
                        http.get("/health"), http.get(f"/api/projects/{project['id']}/strings")
                    ),
                    timeout=3,
                )
                assert health.status_code == catalog.status_code == 200
                assert not importing.done()
            finally:
                release.set()
                result = await asyncio.wait_for(importing, timeout=10)
            assert result.status_code == 200, result.text


@pytest.mark.parametrize("finish", ["commit", "rollback", "close"])
def test_transaction_end_releases_lock(project, session_factory, finish):
    pid = uuid.UUID(project["id"])
    with session_factory() as first, session_factory() as second:
        acquire_import_lock(first, pid)
        with pytest.raises(HTTPException) as caught:
            acquire_import_lock(second, pid)
        assert caught.value.status_code == 409
        assert {"detail": caught.value.detail} == BUSY
        getattr(first, finish)()
        acquire_import_lock(second, pid)


@pytest.mark.parametrize("kind", KINDS)
def test_busy_dry_run_rejects_then_preview_releases_lock(client, project, session_factory, kind):
    with session_factory() as holder:
        acquire_import_lock(holder, uuid.UUID(project["id"]))
        path, kwargs = import_request(project, kind, dry_run=True)
        rejected = client.post(path, **kwargs)
        assert rejected.status_code == 409 and rejected.json() == BUSY
    preview = client.post(path, **kwargs)
    assert preview.status_code == 200, preview.text
    assert preview.json()["dry_run"]
    path, kwargs = import_request(project, kind)
    assert client.post(path, **kwargs).status_code == 200


def test_auth_and_base_language_checks_precede_import_lock(client, project, session_factory):
    path = f"/api/projects/{project['slug']}/strings/import"
    with session_factory() as holder:
        acquire_import_lock(holder, uuid.UUID(project["id"]))
        unauthorized = client.post(
            path, headers={"X-API-Key": "invalid"}, json={"strings": {"k": "Value"}}
        )
        assert unauthorized.status_code == 401
        mismatch = client.post(
            path,
            headers={"X-API-Key": project["api_key"]},
            json={"strings": {"k": "Value"}, "base_language": "de"},
        )
        assert mismatch.status_code == 409
        assert mismatch.json()["detail"]["code"] == "base_language_mismatch"


@pytest.mark.parametrize("kind", ["json", "cli"])
def test_failed_import_rolls_back_partial_writes_and_releases_lock(
    client, project, session_factory, monkeypatch, kind
):
    before = catalog_state(session_factory, project)

    def fail_import(db, project, *_args, **_kwargs):
        db.add(Module(project_id=project.id, slug="rolled-back", name="Rolled back"))
        db.add(StringEntry(project_id=project.id, key="rolled-back", source_text="Temporary"))
        db.flush()
        raise HTTPException(400, "Invalid import")

    path, kwargs = import_request(project, kind)
    with monkeypatch.context() as patch:
        patch.setattr(imports, "import_json_data", fail_import)
        assert client.post(path, **kwargs).status_code == 400
    assert catalog_state(session_factory, project) == before
    assert client.post(path, **kwargs).status_code == 200


@pytest.mark.parametrize("batch", [False, True])
def test_undo_and_import_mutually_reject_while_locked(
    client, project, session_factory, monkeypatch, batch
):
    path, kwargs = import_request(project, "cli")
    imported = client.post(path, **kwargs)
    assert imported.status_code == 200, imported.text
    with session_factory() as db:
        activity = db.scalar(
            select(Activity).where(Activity.batch_id == uuid.UUID(imported.json()["batch_id"]))
        )
        target = f"batch/{activity.batch_id}" if batch else str(activity.id)
    undo_path = f"/api/projects/{project['id']}/activities/{target}/revert"
    before = catalog_state(session_factory, project)
    with session_factory() as holder:
        acquire_import_lock(holder, uuid.UUID(project["id"]))
        rejected = client.post(undo_path, params={"force": True})
        assert rejected.status_code == 409 and rejected.json() == BUSY
        assert client.get(f"{undo_path}/preview").status_code == 200
    assert catalog_state(session_factory, project) == before
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pause_lock(monkeypatch, activities) as (entered, release):
            undoing = pool.submit(client.post, undo_path)
            try:
                assert entered.wait(5)
                rejected = client.post(path, **kwargs)
                assert rejected.status_code == 409 and rejected.json() == BUSY
            finally:
                release.set()
            undone = undoing.result(timeout=10)
    assert undone.status_code == 200, undone.text


@pytest.mark.parametrize("batch", [False, True])
def test_undo_retry_reacquires_lock_before_writing(
    client, project, session_factory, monkeypatch, batch
):
    path, kwargs = import_request(project, "cli")
    imported = client.post(path, **kwargs)
    assert imported.status_code == 200, imported.text
    before = catalog_state(session_factory, project)
    with session_factory() as db:
        activity = db.scalar(
            select(Activity).where(Activity.batch_id == uuid.UUID(imported.json()["batch_id"]))
        )
        target = f"batch/{activity.batch_id}" if batch else str(activity.id)
    calls = []
    original = activities.SnapshotReferences

    def fail_once(*args, **kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise database_error()
        return original(*args, **kwargs)

    with session_factory() as holder:
        monkeypatch.setattr(activities, "SnapshotReferences", fail_once)
        monkeypatch.setattr(
            write_transactions.time,
            "sleep",
            lambda _: acquire_import_lock(holder, uuid.UUID(project["id"])),
        )
        rejected = client.post(f"/api/projects/{project['id']}/activities/{target}/revert")
        assert rejected.status_code == 409 and rejected.json() == BUSY
    assert calls == [True]
    assert catalog_state(session_factory, project) == before


def test_other_projects_and_administration_proceed_during_import(client, project, monkeypatch):
    other = make_project(client, "Other project")
    new_member = _add_user("import-member@example.com")
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pause_lock(monkeypatch, sync_router) as (entered, release):
            path, kwargs = import_request(project, "json")
            importing = pool.submit(client.post, path, **kwargs)
            try:
                assert entered.wait(5)
                path, kwargs = import_request(other, "json")
                assert client.post(path, **kwargs).status_code == 200
                root = f"/api/projects/{project['id']}"
                assert (
                    client.post(
                        f"{root}/members", json={"email": new_member["email"], "role": "editor"}
                    ).status_code
                    == 201
                )
                assert (
                    client.post(f"{root}/api-keys", json={"name": "During import"}).status_code
                    == 201
                )
                assert (
                    client.patch(root, json={"translation_context": "New context"}).status_code
                    == 200
                )
            finally:
                release.set()
            assert importing.result(timeout=10).status_code == 200
