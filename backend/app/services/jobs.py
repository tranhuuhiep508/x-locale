"""Background jobs: lookup, start, and run."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.auth import membership_for
from app.config import settings
from app.database import SessionLocal, engine
from app.models import Job, JobStatus, Project, User
from app.schemas import JobAcceptedOut
from app.services import import_lock
from app.services.import_lock import wait_for_import_lock
from app.services.job_progress import JOB_ID_KEY
from app.services.key_policy import is_key_policy_error, key_policy_conflict

NOT_FOUND = "Job not found"
RESPOND_ASYNC = "respond-async"
logger = logging.getLogger(__name__)

JobWork = Callable[[Session, Project], dict[str, Any]]


def get_job(db: Session, job_id: uuid.UUID, user: User) -> Job:
    """Return a job only when the caller belongs to its project.

    A missing id and a job in a project the caller does not belong to both
    return 404 so the response does not reveal that the job exists.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None or membership_for(db, job.project_id, user.id) is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return job


def wants_async(prefer: str | None) -> bool:
    """True when the ``Prefer`` header asks for ``respond-async`` (RFC 7240)."""
    if not prefer:
        return False
    return any(
        token.split(";", 1)[0].strip().lower() == RESPOND_ASYNC for token in prefer.split(",")
    )


def runs_async(prefer: str | None, size: int) -> bool:
    return wants_async(prefer) and size > settings.import_async_threshold


_HANDOFF_TIMEOUT_S = 5
RECOVERY_INTERVAL_S = 60
JOB_LOCK_NAMESPACE = 0x584C4A42
RECOVERABLE_KINDS = ("import", "excel_import", "revert")
INTERRUPTED_MESSAGE = (
    "This operation was interrupted by a server restart or lost worker. Please run it again."
)


def try_job_lock(db: Connection | Session, job_id: uuid.UUID, *, session: bool = False) -> bool:
    function = "pg_try_advisory_lock" if session else "pg_try_advisory_xact_lock"
    return bool(
        db.scalar(
            text(f"SELECT {function}(:namespace, hashtext(:job_id))"),
            {"namespace": JOB_LOCK_NAMESPACE, "job_id": str(job_id)},
        )
    )


@contextmanager
def owned_job_connection(job_id: uuid.UUID):
    """Keep ownership across work commits/rollbacks without another lasting connection."""
    conn = engine.connect()
    acquired = False
    try:
        acquired = try_job_lock(conn, job_id, session=True)
        if not acquired:
            raise HTTPException(503, "Unable to start job. Please try again.")
        conn.commit()  # The ORM must start its own transaction on this pinned connection.
        yield conn
    finally:
        try:
            conn.rollback()
            if acquired and not conn.invalidated:
                conn.execute(
                    text("SELECT pg_advisory_unlock(:namespace, hashtext(:job_id))"),
                    {"namespace": JOB_LOCK_NAMESPACE, "job_id": str(job_id)},
                )
                conn.commit()
        except Exception:
            logger.exception("Could not release ownership of job %s", job_id)
            conn.invalidate()
        finally:
            conn.close()


def start_job(
    db: Session, project_id: uuid.UUID, kind: str, meta: dict[str, Any], *, job_id: uuid.UUID
) -> Job:
    """Create the job as ``running`` and commit, so the first poll already sees it.

    Committing ends the request's transaction lock. ``launch_job`` holds a
    session lock across that commit until the worker is waiting.
    """
    actor = {
        key: value
        for key, value in (db.info.get("activity") or {}).items()
        if key in {"actor_type", "actor_id", "actor_label"}
    }
    created_by = None
    if actor.get("actor_type") == "user" and actor.get("actor_id"):
        created_by = uuid.UUID(str(actor["actor_id"]))
    job = Job(
        id=job_id,
        project_id=project_id,
        kind=kind,
        status=JobStatus.running,
        created_by=created_by,
        payload={
            **meta,
            "actor": actor,
            "progress": {"phase": "queued", "chunks_done": 0, "chunks_total": 0},
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _hold_session_lock(
    project_id: uuid.UUID, held: threading.Event, release: threading.Event
) -> None:
    """Hold the session lock on a connection this function keeps open.

    ``Session.commit`` returns the request connection to the pool, so the lock
    cannot live there: a later unlock may check out a different connection.
    """
    conn = engine.connect()
    try:
        import_lock.acquire_import_session_lock(conn, project_id)
        held.set()
        release.wait()
        import_lock.release_import_session_lock(conn, project_id)
    finally:
        held.set()
        conn.close()


def launch_job(
    db: Session,
    project_id: uuid.UUID,
    kind: str,
    meta: dict[str, Any],
    work: JobWork,
) -> Job:
    """Commit the job, then keep the project locked until the worker is queued.

    The request already holds the transaction lock. A second connection waits
    for the session lock, the commit hands that lock to it, and it unlocks
    only once the worker is blocked on the same key.
    """
    job_id = uuid.uuid4()
    ready: Future[None] = Future()
    execute, abort = threading.Event(), threading.Event()
    worker = threading.Thread(
        target=run_job,
        args=(job_id, project_id, work, ready, execute, abort),
        name=f"job-{job_id}",
        daemon=True,
    )
    held, release_holder = threading.Event(), threading.Event()
    holder = threading.Thread(
        target=_hold_session_lock,
        args=(project_id, held, release_holder),
        name="import-lock-handoff",
        daemon=True,
    )
    dispatched = False
    try:
        worker.start()
        ready.result(timeout=_HANDOFF_TIMEOUT_S)
        holder.start()
        deadline = time.monotonic() + _HANDOFF_TIMEOUT_S
        while time.monotonic() < deadline and not import_lock.import_lock_waiting(db, project_id):
            time.sleep(0.01)
        job = start_job(db, project_id, kind, meta, job_id=job_id)
        if not held.wait(_HANDOFF_TIMEOUT_S):
            logger.warning("Job %s session lock was not granted", job.id)
        dispatched = True
        execute.set()
        deadline = time.monotonic() + _HANDOFF_TIMEOUT_S
        worker_waiting = False
        while time.monotonic() < deadline:
            if import_lock.import_lock_waiting(db, project_id):
                worker_waiting = True
                break
            time.sleep(0.01)
        if not worker_waiting:
            # shortcut: the overwrite gap returns if the worker never queues. A job
            # queue should own this lock instead of a handoff thread.
            logger.warning("Job %s did not reach the import lock; releasing the handoff", job.id)
        return job
    except Exception as exc:
        db.rollback()
        if not dispatched:
            abort.set()
            try:
                _record_failure(job_id, exc)
            except Exception:
                logger.exception("Could not record job %s launch failure", job_id)
        raise
    finally:
        execute.set()
        release_holder.set()
        if holder.ident is not None:
            holder.join(_HANDOFF_TIMEOUT_S)


def accepted_response(job: Job) -> JSONResponse:
    body = JobAcceptedOut(job_id=job.id, status=job.status.value, kind=job.kind)
    return JSONResponse(
        status_code=202,
        content=body.model_dump(mode="json"),
        headers={"Location": f"/api/jobs/{job.id}"},
    )


def _error_details(exc: Exception) -> tuple[str, dict[str, Any]]:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        message = detail.get("message") if isinstance(detail, dict) else None
        return str(message or detail), {"status_code": exc.status_code, "detail": detail}
    return "Job failed unexpectedly", {"status_code": 500, "detail": "Job failed unexpectedly"}


def _finish(job: Job, status: JobStatus, *, phase: str) -> None:
    job.status = status
    job.completed_at = datetime.now(UTC)
    payload = dict(job.payload or {})
    progress = dict(payload.get("progress") or {})
    progress["phase"] = phase
    payload["progress"] = progress
    job.payload = payload
    flag_modified(job, "payload")


def _record_failure(job_id: uuid.UUID, exc: Exception, *, conn: Connection | None = None) -> None:
    message, error = _error_details(exc)
    db = SessionLocal(bind=conn) if conn is not None else SessionLocal()
    try:
        job = (
            db.query(Job)
            .filter(
                Job.id == job_id,
                Job.status == JobStatus.running,
            )
            .with_for_update()
            .first()
        )
        if job is None:
            return
        _finish(job, JobStatus.failed, phase="failed")
        job.error = message
        job.result = {"error": error}
        db.commit()
    finally:
        db.close()


def run_job(
    job_id: uuid.UUID,
    project_id: uuid.UUID,
    work: JobWork,
    ready: Future[None],
    execute: threading.Event,
    abort: threading.Event,
) -> None:
    """Run ``work`` in its own session while holding the project's import lock.

    ``work`` must leave its writes uncommitted. Completed status is written in
    that same transaction, so a saved import or undo never reads as running
    and a failure rolls the write back.
    """
    try:
        with owned_job_connection(job_id) as conn:
            ready.set_result(None)
            execute.wait()
            if abort.is_set():
                return
            with SessionLocal(bind=conn) as db:
                try:
                    wait_for_import_lock(db, project_id)
                    job = db.get(Job, job_id)
                    if job is None or job.status != JobStatus.running:
                        return
                    db.info["activity"] = dict((job.payload or {}).get("actor") or {})
                    db.info[JOB_ID_KEY] = job_id
                    project = db.get(Project, project_id)
                    if project is None:
                        raise HTTPException(status_code=404, detail="Project not found")
                    result = work(db, project)
                    db.refresh(job)
                    if job.status != JobStatus.running:
                        db.rollback()
                        return
                    _finish(job, JobStatus.completed, phase="done")
                    job.result = result
                    db.commit()
                except Exception as exc:
                    db.rollback()
                    if is_key_policy_error(exc):
                        exc = key_policy_conflict()
                    if not isinstance(exc, HTTPException):
                        logger.exception("Job %s failed", job_id)
                    _record_failure(job_id, exc, conn=None if conn.invalidated else conn)
    except Exception as exc:
        if not ready.done():
            ready.set_exception(exc)
        else:
            logger.exception("Job %s executor failed; recovery will finish it", job_id)


def recover_abandoned_jobs() -> int:
    """Age selects candidates; both database locks prove that work cannot still commit."""
    eligible = (
        Job.status == JobStatus.running,
        Job.kind.in_(RECOVERABLE_KINDS),
        Job.created_at < func.now() - timedelta(seconds=RECOVERY_INTERVAL_S),
    )
    with SessionLocal() as db:
        candidates = db.query(Job.id, Job.project_id).filter(*eligible).all()
    recovered = 0
    for job_id, project_id in candidates:
        with SessionLocal() as db:
            if not try_job_lock(db, job_id):
                continue
            try:
                import_lock.acquire_import_lock(db, project_id)
            except HTTPException as exc:
                if exc.status_code == 409:
                    continue
                raise
            job = (
                db.query(Job)
                .filter(Job.id == job_id, *eligible)
                .with_for_update(
                    skip_locked=True,
                )
                .first()
            )
            if job is None:
                continue
            _finish(job, JobStatus.failed, phase="failed")
            job.error = INTERRUPTED_MESSAGE
            job.result = {
                "error": {
                    "status_code": 503,
                    "detail": {
                        "code": "job_interrupted",
                        "message": INTERRUPTED_MESSAGE,
                    },
                }
            }
            db.commit()
            recovered += 1
            logger.warning(
                "Recovered interrupted job %s kind=%s project=%s age_seconds=%.0f",
                job_id,
                job.kind,
                project_id,
                (datetime.now(UTC) - job.created_at).total_seconds(),
            )
    return recovered


def recover_jobs_safely() -> None:
    try:
        recover_abandoned_jobs()
    except Exception:
        logger.exception("Job recovery failed; retrying on the next interval")


def recovery_loop(stop: threading.Event) -> None:
    while not stop.wait(RECOVERY_INTERVAL_S):
        recover_jobs_safely()
