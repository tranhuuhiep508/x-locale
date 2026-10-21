"""Executor ownership, process death, and concurrent recovery use real Postgres locks."""

import select as io_select
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import engine
from app.models import Job, JobStatus, StringEntry
from app.services import import_lock, jobs
from tests.test_import_concurrency import seed_import_project
from tests.test_import_jobs import async_request, import_request


@pytest.fixture()
def project(client, session_factory):
    return seed_import_project(client, session_factory)


def old_job(session_factory, project, **kwargs):
    with session_factory() as db:
        job = Job(
            id=uuid.uuid4(),
            project_id=uuid.UUID(project["id"]),
            kind=kwargs.pop("kind", "import"),
            status=kwargs.pop("status", JobStatus.running),
            created_at=datetime.now(UTC) - timedelta(hours=2),
            **kwargs,
        )
        db.add(job)
        db.commit()
        return job.id


# The child uses the production runner, makes a flushed content write, and then
# waits to be killed. SIGKILL cannot run Python failure handlers or cleanup.
INTERRUPTED_WORKER = """
import signal
import sys
import uuid
from sqlalchemy import select, text
from app.database import engine
from app.models import StringEntry
from app.services.jobs import _job_lock_params, run_job

job_id, project_id = map(uuid.UUID, sys.argv[1:])
conn = engine.connect()
conn.execute(text('SELECT pg_advisory_lock(:namespace, hashtext(:job_id))'),
             _job_lock_params(job_id))
conn.commit()
def work(db, project):
    entry = db.scalar(select(StringEntry).where(
        StringEntry.project_id == project.id, StringEntry.key == 'changed'))
    entry.source_text = 'Uncommitted change'
    db.flush()
    print('ready', flush=True)
    signal.pause()
run_job(job_id, project_id, work, conn)
"""


@pytest.mark.parametrize("kind", ["import", "revert"])
def test_live_worker_survives_other_worker_recovery_then_recovers_after_kill(
    project, session_factory, kind
):
    job_id = old_job(session_factory, project, kind=kind, payload={"ownership_version": 1})
    child = subprocess.Popen(
        [sys.executable, "-u", "-c", INTERRUPTED_WORKER, str(job_id), project["id"]],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert io_select.select([child.stdout], [], [], 10)[0], "Worker never reached its write"
        assert child.stdout.readline().strip() == "ready"
        # A different process checks a job much older than the age threshold.
        assert jobs.recover_abandoned_jobs() == 0
        with session_factory() as db:
            assert db.get(Job, job_id).status == JobStatus.running
        child.kill()
        child.wait(timeout=10)
        assert jobs.recover_abandoned_jobs() == 1
        with session_factory() as db:
            job = db.get(Job, job_id)
            assert job.status == JobStatus.failed
            assert job.completed_at is not None
            assert job.progress["phase"] == "failed"
            assert job.error == jobs.INTERRUPTED
            assert job.result == {"error": {"status_code": 503, "detail": jobs.INTERRUPTED}}
            source = db.scalar(
                select(StringEntry.source_text).where(
                    StringEntry.project_id == uuid.UUID(project["id"]),
                    StringEntry.key == "changed",
                )
            )
            assert source == "Before"
            import_lock.acquire_import_lock(db, uuid.UUID(project["id"]))
        assert jobs.recover_abandoned_jobs() == 0
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=10)


def test_queued_executor_is_protected_before_project_lock(project, session_factory):
    job_id = old_job(session_factory, project, payload={"ownership_version": 1})
    conn = engine.connect()
    try:
        conn.execute(
            text("SELECT pg_advisory_lock(:namespace, hashtext(:job_id))"),
            jobs._job_lock_params(job_id),
        )
        conn.commit()
        assert jobs.recover_abandoned_jobs() == 0
    finally:
        jobs._release_job_connection(conn, job_id)
    assert jobs.recover_abandoned_jobs() == 1


def test_legacy_job_waits_for_project_writer(project, session_factory):
    job_id = old_job(session_factory, project)
    with session_factory() as writer:
        import_lock.acquire_import_lock(writer, uuid.UUID(project["id"]))
        assert jobs.recover_abandoned_jobs() == 0
        assert writer.get(Job, job_id).status == JobStatus.running
    assert jobs.recover_abandoned_jobs() == 1


def test_concurrent_recovery_preserves_terminal_recent_and_unrelated_jobs(project, session_factory):
    abandoned = [old_job(session_factory, project, kind=k) for k in jobs.RECOVERABLE_KINDS]
    untouched = [
        old_job(session_factory, project, status=JobStatus.completed, result={"created": 2}),
        old_job(session_factory, project, status=JobStatus.failed, error="Original failure"),
        old_job(session_factory, project, kind="translate"),
        old_job(session_factory, project, kind="translate_proposals"),
    ]
    recent = old_job(session_factory, project)
    with session_factory() as db:
        db.get(Job, recent).created_at = datetime.now(UTC)
        db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        counts = list(pool.map(lambda _: jobs.recover_abandoned_jobs(), range(2)))
    # Competing sweepers can skip a contended project; the next sweep finishes it.
    assert sum(counts) + jobs.recover_abandoned_jobs() == len(abandoned)
    with session_factory() as db:
        assert all(db.get(Job, key).status == JobStatus.failed for key in abandoned)
        assert db.get(Job, untouched[0]).result == {"created": 2}
        assert db.get(Job, untouched[1]).error == "Original failure"
        assert all(db.get(Job, key).status == JobStatus.running for key in untouched[2:] + [recent])
    jobs._record_failure(untouched[0], HTTPException(500, "Late error"))
    with session_factory() as db:
        assert db.get(Job, untouched[0]).status == JobStatus.completed


def test_worker_never_executes_an_already_failed_job(project, session_factory):
    job_id = old_job(session_factory, project)
    assert jobs.recover_abandoned_jobs() == 1
    called = []
    jobs.run_job(job_id, uuid.UUID(project["id"]), lambda *_: called.append(True), engine.connect())
    assert called == []
    with session_factory() as db:
        assert db.get(Job, job_id).error == jobs.INTERRUPTED


def test_completion_racing_recovery_keeps_its_result_and_releases_ownership(
    project, session_factory
):
    job_id = old_job(session_factory, project, payload={"ownership_version": 1})
    conn = engine.connect()
    conn.execute(
        text("SELECT pg_advisory_lock(:namespace, hashtext(:job_id))"),
        jobs._job_lock_params(job_id),
    )
    conn.commit()
    entered, finish = threading.Event(), threading.Event()

    def work(db, project):
        entry = db.scalar(
            select(StringEntry).where(
                StringEntry.project_id == project.id,
                StringEntry.key == "changed",
            )
        )
        entry.source_text = "Completed change"
        db.flush()
        entered.set()
        assert finish.wait(10)
        return {"updated": 1}

    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(jobs.run_job, job_id, uuid.UUID(project["id"]), work, conn)
        try:
            assert entered.wait(5)
            assert jobs.recover_abandoned_jobs() == 0
        finally:
            finish.set()
        running.result(timeout=10)
    assert jobs.recover_abandoned_jobs() == 0
    jobs._record_failure(job_id, HTTPException(503, "Late failure"))
    with session_factory() as db:
        job = db.get(Job, job_id)
        assert job.status == JobStatus.completed
        assert job.result == {"updated": 1}
        assert (
            db.scalar(
                select(StringEntry.source_text).where(
                    StringEntry.project_id == uuid.UUID(project["id"]),
                    StringEntry.key == "changed",
                )
            )
            == "Completed change"
        )
        assert not db.scalar(
            text("""
            SELECT EXISTS (
                SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
                AND classid = CAST(:namespace AS oid)
                AND objid = hashtext(:job_id)::oid AND granted
            )
        """),
            jobs._job_lock_params(job_id),
        )


def test_thread_start_failure_leaves_no_job_or_ownership_lock(
    client, project, session_factory, monkeypatch
):
    original = threading.Thread.start

    def fail_worker(thread):
        if thread.name.startswith("job-") and thread.name != "job-recovery":
            raise RuntimeError("Cannot start worker")
        original(thread)

    monkeypatch.setattr(settings, "import_async_threshold", 1)
    monkeypatch.setattr(threading.Thread, "start", fail_worker)
    with pytest.raises(RuntimeError, match="Cannot start worker"):
        path, kwargs = async_request(project, "cli")
        client.post(path, **kwargs)
    with session_factory() as db:
        job = db.scalar(select(Job).where(Job.project_id == uuid.UUID(project["id"])))
        assert job is None
        assert not db.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' "
                "AND classid = CAST(:namespace AS oid))"
            ),
            {"namespace": jobs.JOB_LOCK_NAMESPACE},
        )
    path, kwargs = import_request(project, "cli")
    assert client.post(path, **kwargs).status_code == 200


@pytest.mark.parametrize("kind", ["import", "revert"])
@pytest.mark.parametrize("fail", [False, True])
def test_launch_and_finish_with_only_two_pool_connections(
    project, session_factory, monkeypatch, kind, fail
):
    """The handoff must not take the slot start_job needs to refresh its row."""
    small = create_engine(settings.database_url, pool_size=2, max_overflow=0, pool_timeout=0.5)
    factory = sessionmaker(bind=small, autoflush=False)
    locked, entered, finish, released = (threading.Event() for _ in range(4))
    original_acquire = import_lock.acquire_import_session_lock
    original_release = jobs._release_job_connection

    def acquire(conn, project_id):
        original_acquire(conn, project_id)
        locked.set()

    def release(conn, job_id):
        try:
            original_release(conn, job_id)
        finally:
            released.set()

    def work(db, project):
        entry = db.scalar(
            select(StringEntry).where(
                StringEntry.project_id == project.id,
                StringEntry.key == "changed",
            )
        )
        entry.source_text = "After"
        db.flush()
        entered.set()
        assert finish.wait(5)
        if fail:
            raise HTTPException(503, "Test work failed")
        return {"updated": 1}

    monkeypatch.setattr(jobs, "engine", small)
    monkeypatch.setattr(jobs, "SessionLocal", factory)
    monkeypatch.setattr(import_lock, "acquire_import_session_lock", acquire)
    monkeypatch.setattr(jobs, "_release_job_connection", release)
    try:
        with factory() as request:
            import_lock.acquire_import_lock(request, uuid.UUID(project["id"]))
            original_commit = request.commit

            def commit():
                original_commit()
                # Give the handoff first use of any slot freed by this commit.
                assert locked.wait(5)

            monkeypatch.setattr(request, "commit", commit)
            job = jobs.launch_job(request, uuid.UUID(project["id"]), kind, {}, work)
            job_id = job.id
            assert job.status == JobStatus.running
            assert job.payload["ownership_version"] == 1
            assert entered.wait(5)
        finish.set()
        assert released.wait(5)
        with session_factory() as db:
            job = db.get(Job, job_id)
            assert job.status == (JobStatus.failed if fail else JobStatus.completed)
            if fail:
                assert job.error == "Test work failed"
            else:
                assert job.result == {"updated": 1}
            source = db.scalar(
                select(StringEntry.source_text).where(
                    StringEntry.project_id == uuid.UUID(project["id"]),
                    StringEntry.key == "changed",
                )
            )
            assert source == ("Before" if fail else "After")
            import_lock.acquire_import_lock(db, uuid.UUID(project["id"]))
        assert small.pool.checkedout() == 0
    finally:
        finish.set()
        if locked.is_set():
            assert released.wait(5)
        small.dispose()


def test_recovery_loop_runs_at_startup_retries_and_stops(monkeypatch):
    calls = []

    def recover():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError("Transient database failure")

    class Stop:
        def is_set(self):
            return False

        def wait(self, seconds):
            assert seconds == 60
            return len(calls) == 2

    monkeypatch.setattr(jobs, "recover_abandoned_jobs", recover)
    jobs.recovery_loop(Stop())
    assert len(calls) == 2
