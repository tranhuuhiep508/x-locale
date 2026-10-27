"""Real Postgres ownership, interruption, and recovery regressions."""

import os
import selectors
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.models import Job, JobStatus, Module
from app.services import import_lock, jobs
from tests.test_import_concurrency import import_request, seed_import_project


@pytest.fixture
def project(client, session_factory):
    return seed_import_project(client, session_factory)


def running_job(session_factory, project, *, kind="import", age=120, status=JobStatus.running):
    with session_factory() as db:
        job = Job(
            project_id=uuid.UUID(project["id"]),
            kind=kind,
            status=status,
            created_at=datetime.now(UTC) - timedelta(seconds=age),
            payload={"dry_run": True, "progress": {"phase": "queued"}},
        )
        db.add(job)
        db.commit()
        return job.id


@pytest.mark.parametrize("kind", jobs.RECOVERABLE_KINDS)
def test_abandoned_job_fails_with_retry_message(client, session_factory, project, kind):
    job_id = running_job(session_factory, project, kind=kind)
    assert jobs.recover_abandoned_jobs() == 1
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


@pytest.mark.parametrize(
    "options",
    [
        {"age": 20},
        {"kind": "unknown"},
        {"status": JobStatus.pending},
        {"status": JobStatus.completed},
        {"status": JobStatus.failed},
    ],
)
def test_recovery_leaves_ineligible_jobs_untouched(session_factory, project, options):
    job_id = running_job(session_factory, project, **options)
    assert jobs.recover_abandoned_jobs() == 0
    with session_factory() as db:
        assert db.get(Job, job_id).status == options.get("status", JobStatus.running)


def test_owner_survives_work_rollback_and_other_worker_startup(session_factory, project):
    from app.main import app

    job_id = running_job(session_factory, project)
    with jobs.owned_job_connection(job_id) as conn:
        with session_factory(bind=conn) as db:
            db.execute(text("SELECT 1"))
            db.rollback()  # The dry-run/completion gap has no project transaction lock.
            assert jobs.recover_abandoned_jobs() == 0
            with TestClient(app) as second_worker:
                assert second_worker.get(f"/api/jobs/{job_id}").json()["status"] == "running"
            db.execute(text("SELECT 1"))
            db.commit()
            assert jobs.recover_abandoned_jobs() == 0
    assert jobs.recover_abandoned_jobs() == 1


def test_busy_project_prevents_recovery(session_factory, project):
    running_job(session_factory, project)
    with session_factory() as db:
        import_lock.acquire_import_lock(db, uuid.UUID(project["id"]))
        assert jobs.recover_abandoned_jobs() == 0
    assert jobs.recover_abandoned_jobs() == 1


def test_recovery_skips_a_locked_job_row(session_factory, project):
    job_id = running_job(session_factory, project)
    with session_factory() as db:
        db.query(Job).filter(Job.id == job_id).with_for_update().one()
        assert jobs.recover_abandoned_jobs() == 0
    assert jobs.recover_abandoned_jobs() == 1


def test_concurrent_sweeps_and_late_failure_preserve_terminal_result(session_factory, project):
    job_id = running_job(session_factory, project)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(lambda _: jobs.recover_abandoned_jobs(), range(2))) == 1
    jobs._record_failure(job_id, HTTPException(500, "Late failure"))
    with session_factory() as db:
        assert db.get(Job, job_id).error == jobs.INTERRUPTED_MESSAGE


def test_worker_owns_job_before_publication(client, session_factory, project, monkeypatch):
    original = jobs.start_job
    seen = []

    def checked_start(*args, **kwargs):
        with session_factory() as observer:
            assert not jobs.try_job_lock(observer, kwargs["job_id"])
        seen.append(kwargs["job_id"])
        return original(*args, **kwargs)

    monkeypatch.setattr(jobs, "start_job", checked_start)
    monkeypatch.setattr(jobs.settings, "import_async_threshold", 1)
    path, kwargs = import_request(project, "cli")
    kwargs["headers"]["Prefer"] = "respond-async"
    response = client.post(path, **kwargs)
    assert response.status_code == 202
    from tests.test_import_jobs import poll

    assert poll(client, project, "cli", response.json()["job_id"])["status"] == "completed"
    with session_factory() as db:
        assert jobs.try_job_lock(db, seen[0])


def test_owned_connection_releases_lock_before_pool_reuse():
    from sqlalchemy.pool import NullPool

    assert jobs.job_lock_engine is not jobs.engine
    assert isinstance(jobs.job_lock_engine.pool, NullPool)
    job_id = uuid.uuid4()
    with jobs.owned_job_connection(job_id):
        pass
    with jobs.SessionLocal() as observer:
        assert jobs.try_job_lock(observer, job_id)


def test_readiness_failure_does_not_publish_job(client, project, monkeypatch):
    def fail(_job_id):
        raise RuntimeError("No work connection")

    monkeypatch.setattr(jobs, "owned_job_connection", fail)
    monkeypatch.setattr(jobs.settings, "import_async_threshold", 1)
    path, kwargs = import_request(project, "cli")
    kwargs["headers"]["Prefer"] = "respond-async"
    with pytest.raises(RuntimeError, match="No work connection"):
        client.post(path, **kwargs)
    with jobs.SessionLocal() as db:
        assert db.query(Job).count() == 0


def test_unlock_failure_discards_connection_and_releases_ownership(project, monkeypatch):
    job_id = uuid.uuid4()
    with jobs.owned_job_connection(job_id) as conn:

        def broken_unlock(*_args, **_kwargs):
            raise RuntimeError("Unlock failed")

        monkeypatch.setattr(conn, "execute", broken_unlock)
    with jobs.SessionLocal() as observer:
        assert jobs.try_job_lock(observer, job_id)


def test_recovery_loop_retries_failure_and_stops(monkeypatch):
    stop = threading.Event()
    calls = []

    def sweep():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("Temporary database failure")
        stop.set()

    monkeypatch.setattr(jobs, "recover_abandoned_jobs", sweep)
    monkeypatch.setattr(jobs, "RECOVERY_INTERVAL_S", 0.01)
    thread = threading.Thread(target=jobs.recovery_loop, args=(stop,))
    thread.start()
    thread.join(2)
    assert not thread.is_alive()
    assert len(calls) == 2


def test_killed_executor_rolls_back_and_recovers_on_startup(client, session_factory, project):
    from app.main import app

    job_id = running_job(session_factory, project)
    script = """
import sys, uuid, signal
from app.models import Module
from app.services import jobs, import_lock
job_id, project_id = map(uuid.UUID, sys.argv[1:])
with jobs.owned_job_connection(job_id) as conn:
    with jobs.SessionLocal(bind=conn) as db:
        import_lock.wait_for_import_lock(db, project_id)
        db.add(Module(project_id=project_id, slug='interrupted', name='Uncommitted'))
        db.flush()
        print('ready', flush=True)
        signal.pause()
"""
    process = subprocess.Popen(
        [sys.executable, "-c", script, str(job_id), project["id"]],
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(10), "Executor did not reach its uncommitted write"
        assert process.stdout.readline().strip() == "ready"
        assert jobs.recover_abandoned_jobs() == 0
        process.kill()
        process.communicate(timeout=10)
        # Wait for Postgres to observe the closed socket and roll back the transaction.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with session_factory() as db:
                if jobs.try_job_lock(db, job_id):
                    break
            time.sleep(0.02)
        with TestClient(app) as restarted:
            assert restarted.get(f"/api/jobs/{job_id}").json()["status"] == "failed"
        with session_factory() as db:
            assert db.scalar(select(Module).where(Module.slug == "interrupted")) is None
        path, kwargs = import_request(project, "cli")
        assert client.post(path, **kwargs).status_code == 200
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=10)
