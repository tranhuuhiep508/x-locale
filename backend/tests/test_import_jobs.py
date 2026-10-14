"""Large imports and undos run as background jobs when the client opts in."""

import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.config import settings
from app.models import Activity, Job, JobStatus, Module, StringEntry
from app.services import import_lock, imports, jobs
from app.services.jobs import wants_async
from tests.helpers import make_project
from tests.test_import_concurrency import (
    BUSY,
    KINDS,
    catalog_state,
    import_request,
    seed_import_project,
)
from tests.test_project_members import _add_user, _as

ASYNC = {"Prefer": "respond-async"}


@pytest.fixture()
def project(client, session_factory):
    return seed_import_project(client, session_factory)


@pytest.fixture()
def small_threshold(monkeypatch):
    monkeypatch.setattr(settings, "import_async_threshold", 1)


def async_request(project, kind, **options):
    path, kwargs = import_request(project, kind, **options)
    kwargs["headers"] = {**kwargs.get("headers", {}), **ASYNC}
    return path, kwargs


def poll(client, project, kind, job_id, *, until_done=True, timeout=10):
    headers = {"X-API-Key": project["api_key"]} if kind == "cli" else {}
    deadline = time.monotonic() + timeout
    while True:
        response = client.get(f"/api/jobs/{job_id}", headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        if not until_done or body["status"] in ("completed", "failed"):
            return body
        if time.monotonic() >= deadline:
            return body
        time.sleep(0.02)


@pytest.mark.parametrize(
    "prefer,expected",
    [
        (None, False),
        ("", False),
        ("respond-async", True),
        ("wait=10, respond-async", True),
        ("Respond-Async; foo=bar", True),
        ("return=minimal", False),
    ],
)
def test_prefer_header_parsing(prefer, expected):
    assert wants_async(prefer) is expected


@pytest.mark.parametrize("kind", KINDS)
def test_large_import_returns_202_and_job_completes(
    client, project, session_factory, small_threshold, kind
):
    path, kwargs = async_request(project, kind)
    accepted = client.post(path, **kwargs)
    assert accepted.status_code == 202, accepted.text
    body = accepted.json()
    assert body["status"] == "running"
    assert body["kind"] == ("excel_import" if kind == "xlsx" else "import")
    assert accepted.headers["location"] == f"/api/jobs/{body['job_id']}"

    job = poll(client, project, kind, body["job_id"])
    assert job["status"] == "completed", job
    assert job["error"] is None
    assert job["progress"]["phase"] == "done"
    result = job["result"]
    assert (result["created"], result["updated"], result["dry_run"]) == (1, 1, False)
    with session_factory() as db:
        keys = set(
            db.scalars(
                select(StringEntry.key).where(StringEntry.project_id == uuid.UUID(project["id"]))
            )
        )
        audited = db.scalars(
            select(Activity).where(Activity.batch_id == uuid.UUID(result["batch_id"]))
        ).all()
    assert {"changed", "added", "unrelated"} <= keys
    assert {row.batch_kind.value for row in audited} == {
        "excel_import" if kind == "xlsx" else "import"
    }


@pytest.mark.parametrize("kind", KINDS)
def test_async_dry_run_reports_without_writing(
    client, project, session_factory, small_threshold, kind
):
    before = catalog_state(session_factory, project)
    path, kwargs = async_request(project, kind, dry_run=True)
    accepted = client.post(path, **kwargs)
    assert accepted.status_code == 202, accepted.text
    job = poll(client, project, kind, accepted.json()["job_id"])
    assert job["status"] == "completed", job
    assert job["result"]["dry_run"] is True
    assert job["result"]["diff"]["create_count"] == 1
    assert catalog_state(session_factory, project) == before


@pytest.mark.parametrize("kind", ["json", "cli"])
def test_small_or_not_opted_in_imports_stay_sync(client, project, monkeypatch, kind):
    monkeypatch.setattr(settings, "import_async_threshold", 1)
    path, kwargs = import_request(project, kind)
    response = client.post(path, **kwargs)
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1

    monkeypatch.setattr(settings, "import_async_threshold", 1000)
    path, kwargs = async_request(project, kind)
    response = client.post(path, **kwargs)
    assert response.status_code == 200, response.text
    assert "job_id" not in response.json()


def test_opted_in_excel_import_always_runs_as_job(client, project, monkeypatch):
    monkeypatch.setattr(settings, "import_async_threshold", 1000)
    path, kwargs = async_request(project, "xlsx")
    response = client.post(path, **kwargs)
    assert response.status_code == 202, response.text
    assert poll(client, project, "xlsx", response.json()["job_id"])["status"] == "completed"
    path, kwargs = import_request(project, "xlsx")
    assert client.post(path, **kwargs).status_code == 200


@pytest.mark.parametrize("kind", ["json", "cli"])
def test_running_job_is_visible_and_holds_import_lock(
    client, project, session_factory, small_threshold, monkeypatch, kind
):
    entered, release = Event(), Event()
    original = jobs.wait_for_import_lock

    def pause(db, project_id):
        original(db, project_id)
        entered.set()
        assert release.wait(10), "Job test did not release the worker"

    monkeypatch.setattr(jobs, "wait_for_import_lock", pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        path, kwargs = async_request(project, kind)
        submitting = pool.submit(client.post, path, **kwargs)
        try:
            assert entered.wait(5)
            with session_factory() as db:
                job_id = db.scalar(
                    select(Job.id).where(Job.project_id == uuid.UUID(project["id"]))
                )
            job = poll(client, project, kind, job_id, until_done=False)
            assert job["status"] == "running"
            assert job["progress"]["phase"] == "queued"

            path, kwargs = import_request(project, "cli", ref=project["slug"])
            rejected = client.post(path, **kwargs)
            assert rejected.status_code == 409 and rejected.json() == BUSY
            path, kwargs = async_request(project, "json")
            rejected = client.post(path, **kwargs)
            assert rejected.status_code == 409 and rejected.json() == BUSY
        finally:
            release.set()
        accepted = submitting.result(timeout=10)
    assert accepted.status_code == 202, accepted.text
    assert poll(client, project, kind, job_id)["status"] == "completed"
    with session_factory() as db:
        assert db.scalar(select(Job.status).where(Job.id == job_id)) == JobStatus.completed


@pytest.mark.parametrize("kind", ["json", "cli"])
def test_failed_job_stores_error_and_rolls_back(
    client, project, session_factory, small_threshold, monkeypatch, kind
):
    before = catalog_state(session_factory, project)

    def fail_import(db, project, *_args, **_kwargs):
        db.add(Module(project_id=project.id, slug="rolled-back", name="Rolled back"))
        db.add(StringEntry(project_id=project.id, key="rolled-back", source_text="Temporary"))
        db.flush()
        raise HTTPException(400, "Invalid import")

    path, kwargs = async_request(project, kind)
    with monkeypatch.context() as patch:
        # The worker runs after the response, so the patch must outlive post().
        patch.setattr(imports, "import_json_data", fail_import)
        accepted = client.post(path, **kwargs)
        assert accepted.status_code == 202, accepted.text
        job = poll(client, project, kind, accepted.json()["job_id"])
    assert job["status"] == "failed"
    assert job["error"] == "Invalid import"
    assert job["result"] == {"error": {"status_code": 400, "detail": "Invalid import"}}
    assert job["completed_at"] is not None
    assert catalog_state(session_factory, project) == before
    path, kwargs = import_request(project, kind)
    assert client.post(path, **kwargs).status_code == 200


def test_failed_job_keeps_structured_detail(client, project, session_factory, small_threshold):
    with session_factory() as db:
        row = db.scalar(select(StringEntry).where(StringEntry.key == "unrelated"))
        string_id = row.id
    deleted = client.delete(f"/api/projects/{project['id']}/strings/{string_id}")
    assert deleted.status_code in (200, 204), deleted.text
    path = f"/api/projects/{project['id']}/strings/import"
    accepted = client.post(
        path,
        json={"strings": {"unrelated": "Back", "fresh": "New"}},
        headers={"X-API-Key": project["api_key"], **ASYNC},
    )
    assert accepted.status_code == 202, accepted.text
    job = poll(client, project, "cli", accepted.json()["job_id"])
    assert job["status"] == "failed"
    error = job["result"]["error"]
    assert error["status_code"] == 409
    assert job["error"]


def test_job_polling_is_scoped_to_the_job_project(client, project, small_threshold):
    path, kwargs = async_request(project, "cli")
    job_id = client.post(path, **kwargs).json()["job_id"]

    other = make_project(client, "Other jobs project")
    other_key = client.post(f"/api/projects/{other['id']}/api-keys", json={"name": "Other"})
    assert other_key.status_code == 201, other_key.text

    own = client.get(f"/api/jobs/{job_id}", headers={"X-API-Key": project["api_key"]})
    assert own.status_code == 200
    foreign = client.get(f"/api/jobs/{job_id}", headers={"X-API-Key": other_key.json()["key"]})
    assert foreign.status_code == 404
    missing = client.get(f"/api/jobs/{uuid.uuid4()}", headers={"X-API-Key": project["api_key"]})
    assert missing.status_code == 404
    invalid = client.get(f"/api/jobs/{job_id}", headers={"X-API-Key": "invalid"})
    assert invalid.status_code == 401

    assert client.get(f"/api/jobs/{job_id}").status_code == 200
    outsider = _add_user("jobs-outsider@example.com")
    client.cookies.clear()
    assert client.get(f"/api/jobs/{job_id}", cookies=_as(outsider)).status_code == 404
    assert poll(client, project, "cli", job_id)["status"] == "completed"


def test_second_import_during_handoff_is_rejected(
    client, project, session_factory, small_threshold, monkeypatch
):
    entered, release = Event(), Event()
    original = import_lock.release_import_session_lock

    def pause(db, project_id):
        entered.set()
        assert release.wait(10), "Handoff test did not release the session lock"
        original(db, project_id)

    monkeypatch.setattr(import_lock, "release_import_session_lock", pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        path, kwargs = async_request(project, "cli")
        submitting = pool.submit(client.post, path, **kwargs)
        try:
            assert entered.wait(5), "Import did not reach the lock handoff"
            with session_factory() as db:
                source = db.scalar(
                    select(StringEntry.source_text).where(
                        StringEntry.project_id == uuid.UUID(project["id"]),
                        StringEntry.key == "changed",
                    )
                )
            assert source == "Before"
            rejected = client.post(
                f"/api/projects/{project['id']}/strings/import",
                json={"modules": {"incoming": {"vi": {"changed": "Newer", "added": "Newer"}}}},
                headers={"X-API-Key": project["api_key"]},
            )
            assert rejected.status_code == 409 and rejected.json() == BUSY
        finally:
            release.set()
        accepted = submitting.result(timeout=15)
    assert accepted.status_code == 202, accepted.text
    job = poll(client, project, "cli", accepted.json()["job_id"])
    assert job["status"] == "completed", job
    with session_factory() as db:
        source = db.scalar(
            select(StringEntry.source_text).where(
                StringEntry.project_id == uuid.UUID(project["id"]),
                StringEntry.key == "changed",
            )
        )
    assert source == "Imported"


@pytest.mark.parametrize("after_commit", [False, True])
def test_job_start_failure_releases_handoff_lock(
    client, project, small_threshold, monkeypatch, after_commit
):
    finished = Event()
    captured = {}
    original_hold = jobs._hold_session_lock
    original_start = jobs.start_job

    def hold(project_id, held, release):
        captured["release"] = release
        try:
            original_hold(project_id, held, release)
        finally:
            finished.set()

    def fail_start(*args, **kwargs):
        if after_commit:
            original_start(*args, **kwargs)
        raise HTTPException(503, "Job creation failed")

    monkeypatch.setattr(jobs, "_hold_session_lock", hold)
    monkeypatch.setattr(jobs, "start_job", fail_start)
    try:
        path, kwargs = async_request(project, "cli")
        response = client.post(path, **kwargs)
        assert response.status_code == 503, response.text
        assert finished.wait(2), "Failed startup left the handoff thread waiting"
        path, kwargs = import_request(project, "cli")
        response = client.post(path, **kwargs)
        assert response.status_code == 200, response.text
    finally:
        # Also clean up when this regression test runs against the old code.
        if "release" in captured:
            captured["release"].set()
        assert finished.wait(5)


def test_undo_completion_failure_rolls_back(
    client, project, session_factory, small_threshold, monkeypatch
):
    path, kwargs = import_request(project, "cli")
    imported = client.post(path, **kwargs)
    assert imported.status_code == 200, imported.text
    saved = catalog_state(session_factory, project)
    batch = imported.json()["batch_id"]
    original = jobs._finish

    def fail_completion(job, status, *, phase):
        if phase == "done":
            raise RuntimeError("completion failed")
        original(job, status, phase=phase)

    monkeypatch.setattr(jobs, "_finish", fail_completion)
    accepted = client.post(
        f"/api/projects/{project['id']}/activities/batch/{batch}/revert",
        headers=ASYNC,
    )
    assert accepted.status_code == 202, accepted.text
    job = poll(client, project, "session", accepted.json()["job_id"])
    assert job["status"] == "failed", job
    assert job["result"]["error"]["status_code"] == 500
    assert catalog_state(session_factory, project) == saved


def test_large_undo_runs_as_job(client, project, session_factory, monkeypatch):
    before = catalog_state(session_factory, project)["strings"]
    path, kwargs = import_request(project, "cli")
    imported = client.post(path, **kwargs)
    assert imported.status_code == 200, imported.text
    batch = imported.json()["batch_id"]
    undo = f"/api/projects/{project['id']}/activities/batch/{batch}/revert"

    monkeypatch.setattr(settings, "import_async_threshold", 1)
    accepted = client.post(undo, headers=ASYNC)
    assert accepted.status_code == 202, accepted.text
    assert accepted.json()["kind"] == "revert"
    job = poll(client, project, "session", accepted.json()["job_id"])
    assert job["status"] == "completed", job
    assert job["result"]["reverted"] == 2
    after = catalog_state(session_factory, project)["strings"]
    assert {sid: row for sid, row in after.items() if row["deleted_at"] is None} == before


def test_small_undo_stays_sync(client, project, monkeypatch):
    monkeypatch.setattr(settings, "import_async_threshold", 1000)
    path, kwargs = import_request(project, "cli")
    batch = client.post(path, **kwargs).json()["batch_id"]
    undone = client.post(
        f"/api/projects/{project['id']}/activities/batch/{batch}/revert", headers=ASYNC
    )
    assert undone.status_code == 200, undone.text
    assert undone.json()["reverted"] == 2
