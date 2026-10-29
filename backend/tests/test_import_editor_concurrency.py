"""Import snapshots and editor saves describe the same committed transitions."""

import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event

import pytest
from openpyxl import Workbook
from sqlalchemy import select, text

from app.config import settings
from app.models import Activity
from app.services import import_bulk, strings
from tests.helpers import json_upload
from tests.test_activity_module_concurrency import wait_for_database_block
from tests.test_import_concurrency import catalog_state, seed_import_project
from tests.test_import_jobs import poll

KINDS = ("json", "cli", "xlsx", "job")
EDITS = ("description", "translation", "source_text")


@pytest.fixture()
def project(client, session_factory):
    return seed_import_project(client, session_factory)


def source_import(client, project, kind):
    root = f"/api/projects/{project['id']}"
    values = {"changed": "Imported", "added": "Created"}
    data = {"modules": {"incoming": {"vi": values}}}
    if kind == "cli":
        response = client.post(
            f"{root}/strings/import", json=data, headers={"X-API-Key": project["api_key"]}
        )
    elif kind == "xlsx":
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "incoming"
        sheet.append(["key", "vi"])
        for key, value in values.items():
            sheet.append([key, value])
        raw = io.BytesIO()
        workbook.save(raw)
        response = client.post(f"{root}/import", files={"file": ("import.xlsx", raw.getvalue())})
    else:
        response = client.post(
            f"{root}/import",
            files=json_upload(data),
            headers={"Prefer": "respond-async"} if kind == "job" else {},
        )
    assert response.status_code == (202 if kind == "job" else 200), response.text
    if kind == "job":
        job = poll(client, project, "json", response.json()["job_id"])
        assert job["status"] == "completed", job
        return job["result"]
    return response.json()


def changed_snapshot(session_factory, project):
    return next(
        row
        for row in catalog_state(session_factory, project)["strings"].values()
        if row["key"] == "changed"
    )


def editor_payload(before, edit):
    if edit == "translation":
        return {
            "translations": {"en": "Editor English"},
            "expected": {"translations": {"en": before["translations"]["en"]}},
        }
    return {edit: "Editor value", "expected": {edit: before[edit]}}


def import_activity(session_factory, batch_id, string_id):
    with session_factory() as db:
        return db.scalar(
            select(Activity).where(
                Activity.batch_id == uuid.UUID(batch_id),
                Activity.string_id == uuid.UUID(string_id),
            )
        )


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("edit", EDITS)
def test_editor_first_is_in_import_history_and_survives_undo(
    client, project, session_factory, database_engine, monkeypatch, kind, edit
):
    monkeypatch.setattr(settings, "import_async_threshold", 1)
    before = changed_snapshot(session_factory, project)
    url = f"/api/projects/{project['id']}/strings/{before['id']}"
    checked, release, importing = Event(), Event(), Event()
    pids = {}
    check = strings._check_editor_expected
    lock = import_bulk._lock_import_entries

    def pause_editor(entry, payload):
        check(entry, payload)
        checked.set()
        assert release.wait(10), "Editor was not released"

    def track_import(db, *args):
        pids["import"] = db.scalar(text("SELECT pg_backend_pid()"))
        importing.set()
        return lock(db, *args)

    monkeypatch.setattr(strings, "_check_editor_expected", pause_editor)
    monkeypatch.setattr(import_bulk, "_lock_import_entries", track_import)
    with ThreadPoolExecutor(max_workers=2) as pool:
        saving = pool.submit(client.patch, url, json=editor_payload(before, edit))
        try:
            assert checked.wait(5)
            importing_result = pool.submit(source_import, client, project, kind)
            assert importing.wait(5)
            wait_for_database_block(database_engine, pids["import"])
        finally:
            release.set()
        saved = saving.result(timeout=10)
        assert saved.status_code == 200, saved.text
        result = importing_result.result(timeout=15)

    expected_before = deepcopy(before)
    if edit == "translation":
        expected_before["translations"]["en"] = "Editor English"
    else:
        expected_before[edit] = "Editor value"
    activity = import_activity(session_factory, result["batch_id"], before["id"])
    assert activity.before == expected_before
    assert activity.after == changed_snapshot(session_factory, project)
    expected_after = deepcopy(expected_before)
    expected_after["source_text"] = "Imported"
    assert activity.after == expected_after
    undone = client.post(
        f"/api/projects/{project['id']}/activities/batch/{result['batch_id']}/revert"
    )
    assert undone.status_code == 200, undone.text
    assert changed_snapshot(session_factory, project) == expected_before


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("edit", EDITS)
def test_import_first_blocks_editor_then_checks_latest_values(
    client, project, session_factory, database_engine, monkeypatch, kind, edit
):
    monkeypatch.setattr(settings, "import_async_threshold", 1)
    before = changed_snapshot(session_factory, project)
    root = f"/api/projects/{project['id']}"
    loaded, release, editing = Event(), Event(), Event()
    pids = {}
    load = import_bulk._load_catalog
    lock = strings._locked_editor_entry

    def pause_import(*args):
        catalog = load(*args)
        loaded.set()
        assert release.wait(10), "Import was not released"
        return catalog

    def track_editor(db, pid, sid):
        if str(sid) == before["id"]:
            pids["editor"] = db.scalar(text("SELECT pg_backend_pid()"))
            editing.set()
        return lock(db, pid, sid)

    monkeypatch.setattr(import_bulk, "_load_catalog", pause_import)
    monkeypatch.setattr(strings, "_locked_editor_entry", track_editor)
    with ThreadPoolExecutor(max_workers=2) as pool:
        importing = pool.submit(source_import, client, project, kind)
        try:
            assert loaded.wait(5)
            unrelated = next(
                row
                for row in catalog_state(session_factory, project)["strings"].values()
                if row["key"] == "unrelated"
            )
            other = client.patch(
                f"{root}/strings/{unrelated['id']}", json={"description": "Still editable"}
            )
            assert other.status_code == 200, other.text
            saving = pool.submit(
                client.patch, f"{root}/strings/{before['id']}", json=editor_payload(before, edit)
            )
            assert editing.wait(5)
            wait_for_database_block(database_engine, pids["editor"])
        finally:
            release.set()
        result = importing.result(timeout=15)
        saved = saving.result(timeout=10)

    activity = import_activity(session_factory, result["batch_id"], before["id"])
    assert activity.before == before
    expected_after = deepcopy(before)
    expected_after["source_text"] = "Imported"
    assert activity.after == expected_after
    undo = f"{root}/activities/batch/{result['batch_id']}/revert"
    if edit == "source_text":
        assert saved.status_code == 409, saved.text
        assert saved.json()["detail"]["code"] == "stale_editor_save"
        assert changed_snapshot(session_factory, project) == activity.after
        assert client.post(undo).status_code == 200
        assert changed_snapshot(session_factory, project) == before
    else:
        assert saved.status_code == 200, saved.text
        current = changed_snapshot(session_factory, project)
        if edit == "translation":
            expected_after["translations"]["en"] = "Editor English"
        else:
            expected_after[edit] = "Editor value"
        assert current == expected_after
        assert client.post(undo).status_code == 409
        assert changed_snapshot(session_factory, project) == current


@pytest.mark.parametrize("status", ["draft", "public"])
def test_preview_does_not_lock_editor_rows(client, project, session_factory, monkeypatch, status):
    before = changed_snapshot(session_factory, project)
    root = f"/api/projects/{project['id']}"
    loaded, release = Event(), Event()
    load = import_bulk._load_catalog

    def pause_import(*args):
        catalog = load(*args)
        loaded.set()
        assert release.wait(10), "Preview was not released"
        return catalog

    monkeypatch.setattr(import_bulk, "_load_catalog", pause_import)
    with ThreadPoolExecutor(max_workers=1) as pool:
        preview = pool.submit(
            client.post,
            f"{root}/import",
            files=json_upload({"vi": {"changed": "Imported"}}),
            params={"dry_run": True, "status": status},
        )
        try:
            assert loaded.wait(5)
            saved = client.patch(
                f"{root}/strings/{before['id']}", json=editor_payload(before, "description")
            )
            assert saved.status_code == 200, saved.text
            after_save = catalog_state(session_factory, project)
        finally:
            release.set()
        response = preview.result(timeout=10)
    assert response.status_code == 200, response.text
    assert catalog_state(session_factory, project) == after_save
