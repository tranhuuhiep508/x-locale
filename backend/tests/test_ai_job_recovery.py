"""AI worker ownership, terminal fencing, and interruption on real Postgres."""

import os
import selectors
import signal
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import PendingRollbackError
from sqlalchemy.orm import sessionmaker

from app import database
from app.main import app
from app.models import Activity, Job, JobStatus, Translation
from app.services import import_lock, job_progress, jobs, translate
from app.services.job_progress import write_job_progress
from tests.helpers import make_project
from tests.test_job_recovery import running_job


@pytest.fixture
def project(client):
    project = make_project(client, "AI recovery", targets=["en"])
    response = client.post(
        f"/api/projects/{project['id']}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
    )
    assert response.status_code == 201, response.text
    project["string_id"] = response.json()["id"]
    return project


def run_worker(kind, project, job_id):
    args = (uuid.UUID(project["id"]), [uuid.UUID(project["string_id"])], ["en"], False)
    if kind == "translate":
        return translate.run_translate_job(*args, uuid.uuid4(), job_id)
    return translate.run_propose_job(*args, job_id)


def fake_batch(source_locale, items, on_progress=None):
    if on_progress:
        on_progress("translating", 1, 1)
    return {item.id: {"en": "Hello"} for item in items}


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
@pytest.mark.parametrize("status", [JobStatus.pending, JobStatus.running])
def test_abandoned_ai_job_fails_once(client, session_factory, project, kind, status):
    job_id = running_job(session_factory, project, kind=kind, status=status)
    with session_factory() as db:
        # AI recovery does not wait for an unrelated import in the same project.
        import_lock.acquire_import_lock(db, uuid.UUID(project["id"]))
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sum(pool.map(lambda _: jobs.recover_abandoned_jobs(), range(2))) == 1
    body = client.get(f"/api/jobs/{job_id}").json()
    assert body["status"] == "failed"
    assert body["completed_at"] is not None
    assert body["progress"]["phase"] == "failed"
    assert body["error"] == jobs.INTERRUPTED_MESSAGE
    assert body["result"]["error"] == {
        "status_code": 503,
        "detail": {"code": "job_interrupted", "message": jobs.INTERRUPTED_MESSAGE},
    }
    assert jobs.recover_abandoned_jobs() == 0


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
@pytest.mark.parametrize(
    "status,age",
    [
        (JobStatus.pending, 20),
        (JobStatus.running, 20),
        (JobStatus.completed, 120),
        (JobStatus.failed, 120),
    ],
)
def test_recovery_leaves_recent_and_terminal_ai_jobs(session_factory, project, kind, status, age):
    job_id = running_job(session_factory, project, kind=kind, status=status, age=age)
    assert jobs.recover_abandoned_jobs() == 0
    with session_factory() as db:
        assert db.get(Job, job_id).status == status


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
def test_live_ai_worker_survives_transactions_progress_and_startup(
    client,
    session_factory,
    project,
    monkeypatch,
    kind,
):
    job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)
    original_load = translate._load_entries_by_ids

    def checked_load(db, ids):
        entries = original_load(db, ids)
        db.rollback()
        assert jobs.recover_abandoned_jobs() == 0
        db.execute(text("SELECT 1"))
        db.commit()
        write_job_progress(job_id, "translating", 0, 1)
        assert jobs.recover_abandoned_jobs() == 0
        with session_factory() as observer:
            assert not jobs.try_job_lock(observer, job_id)
        with TestClient(app) as second_worker:
            body = second_worker.get(f"/api/jobs/{job_id}").json()
            assert body["status"] == "running"
            assert body["progress"]["phase"] == "translating"
        return entries

    monkeypatch.setattr(translate, "_load_entries_by_ids", checked_load)
    monkeypatch.setattr(translate, "translate_batch", fake_batch)
    run_worker(kind, project, job_id)
    body = client.get(f"/api/jobs/{job_id}").json()
    assert body["status"] == "completed"
    assert body["progress"]["phase"] == "done"
    with session_factory() as db:
        assert jobs.try_job_lock(db, job_id)


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
@pytest.mark.parametrize("status", [JobStatus.failed, JobStatus.completed, JobStatus.running])
def test_late_callback_cannot_restart_a_job(
    client, session_factory, project, monkeypatch, kind, status
):
    job_id = running_job(session_factory, project, kind=kind, status=status)
    if status == JobStatus.failed:
        with session_factory() as db:
            db.get(Job, job_id).status = JobStatus.pending
            db.commit()
        assert jobs.recover_abandoned_jobs() == 1
    before = client.get(f"/api/jobs/{job_id}").json()

    def forbidden(*args, **kwargs):
        pytest.fail("A late callback must not generate or load translation work")

    monkeypatch.setattr(translate, "_load_entries_by_ids", forbidden)
    monkeypatch.setattr(translate, "translate_batch", forbidden)
    run_worker(kind, project, job_id)
    assert client.get(f"/api/jobs/{job_id}").json() == before


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
@pytest.mark.parametrize("raises", [False, True])
def test_late_result_error_and_progress_preserve_terminal_state(
    client,
    session_factory,
    project,
    monkeypatch,
    kind,
    raises,
):
    job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)

    def finish_elsewhere(source_locale, items, on_progress=None):
        with session_factory() as db:
            job = db.get(Job, job_id)
            jobs._finish(job, JobStatus.failed, phase="failed")
            job.error = jobs.INTERRUPTED_MESSAGE
            job.result = {"original": True}
            db.commit()
        write_job_progress(job_id, "translating", 1, 1)
        if raises:
            raise RuntimeError("Late failure")
        return fake_batch(source_locale, items)

    monkeypatch.setattr(translate, "translate_batch", finish_elsewhere)
    if raises:
        with pytest.raises(RuntimeError, match="AI translation failed"):
            run_worker(kind, project, job_id)
    else:
        run_worker(kind, project, job_id)
    body = client.get(f"/api/jobs/{job_id}").json()
    assert body["status"] == "failed"
    assert body["error"] == jobs.INTERRUPTED_MESSAGE
    assert body["result"] == {"original": True}
    assert body["progress"]["phase"] == "failed"
    with session_factory() as db:
        assert not db.query(Translation).filter(Translation.value == "Hello").count()


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
def test_ai_failure_rolls_back_work_and_releases_ownership(
    client,
    session_factory,
    project,
    monkeypatch,
    kind,
):
    job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)
    with session_factory() as db:
        activities_before = db.query(Activity).count()
    original_save = translate.save_translations

    def fail_save(db, *args, **kwargs):
        original_save(db, *args, **kwargs)
        db.flush()
        raise RuntimeError("Generation failed")

    def fail_propose(*args, **kwargs):
        raise RuntimeError("Generation failed")

    monkeypatch.setattr(translate, "translate_batch", fake_batch)
    monkeypatch.setattr(translate, "save_translations", fail_save)
    monkeypatch.setattr(translate, "proposals_from_results", fail_propose)
    with pytest.raises(RuntimeError, match="AI translation failed"):
        run_worker(kind, project, job_id)
    body = client.get(f"/api/jobs/{job_id}").json()
    assert body["status"] == "failed"
    assert body["error"] == "AI translation failed. Please try again."
    assert body["progress"]["phase"] == "failed"
    with session_factory() as db:
        assert jobs.try_job_lock(db, job_id)
        assert db.query(Activity).count() == activities_before
        assert not db.query(Translation).filter(Translation.value == "Hello").count()


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
def test_lost_ownership_connection_leaves_failure_to_recovery(
    client,
    session_factory,
    project,
    monkeypatch,
    kind,
):
    job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)
    original_load = translate._load_entries_by_ids
    original_owned = translate.owned_job_connection
    lock_holder = {}

    @contextmanager
    def capturing(job_id):
        with original_owned(job_id) as conn:
            lock_holder["conn"] = conn
            yield conn

    def lose_connection(db, ids):
        entries = original_load(db, ids)
        lock_holder["conn"].invalidate()
        return entries

    monkeypatch.setattr(translate, "owned_job_connection", capturing)
    monkeypatch.setattr(translate, "_load_entries_by_ids", lose_connection)
    monkeypatch.setattr(translate, "translate_batch", fake_batch)
    with pytest.raises((RuntimeError, PendingRollbackError)):
        run_worker(kind, project, job_id)
    with session_factory() as db:
        job = db.get(Job, job_id)
        assert job.status == JobStatus.running
        assert job.error is None
        assert not db.query(Translation).filter(Translation.value == "Hello").count()
    assert jobs.recover_abandoned_jobs() == 1
    assert client.get(f"/api/jobs/{job_id}").json()["error"] == jobs.INTERRUPTED_MESSAGE


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
def test_killed_ai_worker_recovers_and_can_be_retried(
    client,
    session_factory,
    project,
    monkeypatch,
    kind,
):
    job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)
    with session_factory() as db:
        activities_before = db.query(Activity).count()
    script = """
import signal, sys, uuid
from app.database import register_activity_listener
from app.models import Activity, Translation
from app.services import translate
register_activity_listener()
job_id, project_id, string_id = map(uuid.UUID, sys.argv[1:4])
kind = sys.argv[4]
batch_id = uuid.uuid4()
original_save = translate.save_translations
translate.translate_batch = lambda source, items, on_progress=None: {item.id: {'en': 'Hello'} for item in items}
def pause_save(db, *args, **kwargs):
    result = original_save(db, *args, **kwargs)
    db.flush()
    assert db.query(Translation).filter(Translation.value == 'Hello').count() == 1
    assert db.query(Activity).filter(Activity.batch_id == batch_id).count() > 0
    print('ready', flush=True)
    signal.pause()
    return result
def pause_propose(*args, **kwargs):
    print('ready', flush=True)
    signal.pause()
translate.save_translations = pause_save
translate.proposals_from_results = pause_propose
if kind == 'translate':
    translate.run_translate_job(project_id, [string_id], ['en'], False, batch_id, job_id)
else:
    translate.run_propose_job(project_id, [string_id], ['en'], False, job_id)
"""
    process = subprocess.Popen(
        [sys.executable, "-c", script, str(job_id), project["id"], project["string_id"], kind],
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(10), "AI worker did not reach its interrupted work"
        assert process.stdout.readline().strip() == "ready"
        assert jobs.recover_abandoned_jobs() == 0
        process.send_signal(signal.SIGKILL)
        process.communicate(timeout=10)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with session_factory() as db:
                if jobs.try_job_lock(db, job_id):
                    break
            time.sleep(0.02)
        with TestClient(app) as restarted:
            body = restarted.get(f"/api/jobs/{job_id}").json()
            assert body["status"] == "failed"
            assert body["error"] == jobs.INTERRUPTED_MESSAGE
        with session_factory() as db:
            assert db.query(Activity).count() == activities_before
            assert not db.query(Translation).filter(Translation.value == "Hello").count()
        monkeypatch.setattr(translate, "translate_batch", fake_batch)
        monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
        route = "translate" if kind == "translate" else "translate/proposals"
        response = client.post(
            f"/api/projects/{project['id']}/{route}",
            json={"scope": "strings", "string_ids": [project["string_id"]]},
        )
        assert response.status_code == 200, response.text
        retried = client.get(f"/api/jobs/{response.json()['job_id']}").json()
        assert retried["status"] == "completed"
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=10)


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
def test_ai_request_releases_request_pool_during_model_call(
    client, session_factory, project, monkeypatch, kind
):
    tiny = create_engine(jobs.engine.url, pool_size=1, max_overflow=0, pool_timeout=1)
    TinySession = sessionmaker(bind=tiny, autoflush=False, autocommit=False)
    monkeypatch.setattr(database, "SessionLocal", TinySession)
    monkeypatch.setattr(translate, "SessionLocal", TinySession)
    monkeypatch.setattr(job_progress, "SessionLocal", TinySession)
    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    blocked, release = threading.Event(), threading.Event()

    def slow_batch(source_locale, items, on_progress=None):
        blocked.set()
        assert release.wait(10), "test did not resume the model call"
        return fake_batch(source_locale, items, on_progress)

    monkeypatch.setattr(translate, "translate_batch", slow_batch)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            endpoint = "translate" if kind == "translate" else "translate/proposals"
            response = pool.submit(
                client.post,
                f"/api/projects/{project['id']}/{endpoint}",
                json={"locales": ["en"]},
            )
            try:
                assert blocked.wait(10), "job did not reach translate_batch"
                assert tiny.pool.checkedout() == 0
                readiness = client.get("/healthcheck/readiness")
                assert readiness.status_code == 200, readiness.text
                assert jobs.recover_abandoned_jobs() == 0
            finally:
                release.set()
            accepted = response.result(timeout=10)
        assert accepted.status_code == 200, accepted.text
        job_id = accepted.json()["job_id"]
        body = client.get(f"/api/jobs/{job_id}").json()
        assert body["status"] == "completed"
        if kind == "translate":
            with session_factory() as db:
                assert db.query(Translation).filter(Translation.value == "Hello").count() == 1
        else:
            assert body["result"]["items"][0]["translations"] == {"en": "Hello"}
    finally:
        release.set()
        tiny.dispose()


@pytest.mark.parametrize("kind", jobs.AI_JOB_KINDS)
def test_held_ai_lock_survives_recovery_after_sixty_seconds(session_factory, project, kind):
    job_id = running_job(session_factory, project, kind=kind, age=120)
    with jobs.owned_job_connection(job_id):
        assert jobs.recover_abandoned_jobs() == 0
    assert jobs.recover_abandoned_jobs() == 1
