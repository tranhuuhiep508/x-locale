"""Background jobs: lookup, start, and run."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable, Generator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import Header, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.auth import membership_for
from app.config import settings
from app.database import DbSession, SessionLocal, engine
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
INTERRUPTED = "This operation was interrupted. Please run it again."
RECOVERABLE_KINDS = ("import", "excel_import", "revert")
# Each API worker has a 15-connection pool; leave room for auth, polling and progress.
_job_slots = threading.BoundedSemaphore(4)
_JOB_SLOT_KEY = "background_job_slot"


def reserve_job_slot(
    db: DbSession, prefer: Annotated[str | None, Header()] = None
) -> Generator[None]:
    """Run before project/auth dependencies, without checking out a DB connection.

    A launched worker takes the reservation out of the request's session info.
    Synchronous requests and validation/launch failures release it on teardown.
    """
    if not wants_async(prefer):
        yield
        return
    slots = _job_slots
    if not slots.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "job_capacity",
                "message": "Background job capacity is full. Please try again shortly.",
            },
            headers={"Retry-After": "5"},
        )
    db.info[_JOB_SLOT_KEY] = slots.release
    try:
        yield
    finally:
        release = db.info.pop(_JOB_SLOT_KEY, None)
        if release is not None:
            release()


def _job_lock_params(job_id: uuid.UUID) -> dict[str, object]:
    return {"namespace": JOB_LOCK_NAMESPACE, "job_id": str(job_id)}


def _release_job_connection(conn: Connection, job_id: uuid.UUID) -> None:
    try:
        if not conn.invalidated:
            conn.rollback()
            # The dedicated worker connection owns both job and handoff locks.
            conn.execute(text("SELECT pg_advisory_unlock_all()"))
            conn.commit()
    except Exception:
        # A pooled connection must never retain a session advisory lock.
        conn.invalidate()
        logger.exception("Could not release ownership of job %s", job_id)
    finally:
        conn.close()


def start_job(
    db: Session, project_id: uuid.UUID, kind: str, meta: dict[str, Any], *, job_id: uuid.UUID
) -> Job:
    """Create the job as ``running`` and commit, so the first poll already sees it.

    Committing ends the request's transaction lock. ``launch_job`` queues the
    worker's session lock before this commit so the project stays protected.
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
            "ownership_version": 1,
            "actor": actor,
            "progress": {"phase": "queued", "chunks_done": 0, "chunks_total": 0},
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def launch_job(
    db: Session,
    project_id: uuid.UUID,
    kind: str,
    meta: dict[str, Any],
    work: JobWork,
) -> Job:
    """Hand the request's project lock directly to the owned worker connection.

    The worker queues a session lock before the request commits. It keeps that
    lock through its content transaction, so launch needs only two connections
    and never leaves a gap for another import during the handoff.
    """
    held, release_worker = threading.Event(), threading.Event()
    job_id = uuid.uuid4()
    conn = engine.connect()
    release_slot = db.info.pop(_JOB_SLOT_KEY, None)
    started = False
    run_work = False
    startup_errors: list[Exception] = []

    def worker() -> None:
        try:
            try:
                import_lock.acquire_import_session_lock(conn, project_id)
                conn.commit()
            except Exception as exc:
                startup_errors.append(exc)
            finally:
                held.set()
            release_worker.wait()
            if run_work and not startup_errors:
                run_job(job_id, project_id, work, conn)
        finally:
            try:
                if not conn.closed:
                    _release_job_connection(conn, job_id)
            finally:
                if release_slot is not None:
                    release_slot()

    try:
        conn.execute(
            text("SELECT pg_advisory_lock(:namespace, hashtext(:job_id))"),
            _job_lock_params(job_id),
        )
        conn.commit()
        threading.Thread(target=worker, name=f"job-{job_id}", daemon=True).start()
        started = True
        deadline = time.monotonic() + _HANDOFF_TIMEOUT_S
        while time.monotonic() < deadline and not import_lock.import_lock_waiting(db, project_id):
            time.sleep(0.01)
        job = start_job(db, project_id, kind, meta, job_id=job_id)
        if not held.wait(_HANDOFF_TIMEOUT_S):
            raise HTTPException(
                status_code=503, detail="Job worker could not acquire the import lock"
            )
        if startup_errors:
            raise startup_errors[0]
        run_work = True
        return job
    except Exception as exc:
        db.rollback()
        _record_failure(job_id, exc)
        raise
    finally:
        release_worker.set()
        if not started:
            try:
                _release_job_connection(conn, job_id)
            finally:
                if release_slot is not None:
                    release_slot()


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


def _record_failure(job_id: uuid.UUID, exc: Exception) -> None:
    message, error = _error_details(exc)
    db = SessionLocal()
    try:
        job = db.get(Job, job_id, with_for_update=True)
        if job is None or job.status != JobStatus.running:
            return
        _finish(job, JobStatus.failed, phase="failed")
        job.error = message
        job.result = {"error": error}
        db.commit()
    finally:
        db.close()


def run_job(job_id: uuid.UUID, project_id: uuid.UUID, work: JobWork, conn: Connection) -> None:
    """Run ``work`` in its own session while holding the project's import lock.

    ``work`` must leave its writes uncommitted. Completed status is written in
    that same transaction, so a saved import or undo never reads as running
    and a failure rolls the write back.
    """
    db = SessionLocal(bind=conn)
    try:
        job = db.get(Job, job_id)
        if job is None or job.status != JobStatus.running:
            return
        db.info["activity"] = dict((job.payload or {}).get("actor") or {})
        db.info[JOB_ID_KEY] = job_id
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        wait_for_import_lock(db, project_id)
        db.refresh(job)
        if job.status != JobStatus.running:
            return
        db.refresh(project)
        result = work(db, project)
        job = db.get(Job, job_id)
        if job is None:
            db.rollback()
            return
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
        _record_failure(job_id, exc)
    finally:
        try:
            db.close()
        finally:
            _release_job_connection(conn, job_id)


def recover_abandoned_jobs() -> int:
    """Fail old jobs only when neither an executor nor a project writer owns them.

    Legacy jobs have no ownership lock: deploy this with all old workers stopped.
    Each candidate gets a short transaction so live jobs never block recovery.
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=RECOVERY_INTERVAL_S)
    with SessionLocal() as db:
        candidates = db.execute(
            select(Job.id, Job.project_id).where(
                Job.status == JobStatus.running,
                Job.kind.in_(RECOVERABLE_KINDS),
                Job.created_at < cutoff,
            )
        ).all()
    recovered = 0
    for job_id, project_id in candidates:
        with SessionLocal() as db:
            if not db.scalar(
                text("SELECT pg_try_advisory_xact_lock(:namespace, hashtext(:job_id))"),
                _job_lock_params(job_id),
            ):
                continue
            try:
                import_lock.acquire_import_lock(db, project_id)
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
                continue
            job = db.get(Job, job_id, with_for_update=True)
            if job is None or job.status != JobStatus.running:
                continue
            _finish(job, JobStatus.failed, phase="failed")
            job.error = INTERRUPTED
            job.result = {"error": {"status_code": 503, "detail": INTERRUPTED}}
            db.commit()
            recovered += 1
            logger.warning("Recovered interrupted job %s (%s)", job.id, job.kind)
    return recovered


def recovery_loop(stop: threading.Event) -> None:
    """Run immediately, then periodically, with a shutdown-interruptible wait."""
    while not stop.is_set():
        try:
            recover_abandoned_jobs()
        except Exception:
            logger.exception("Interrupted-job recovery failed; will retry")
        if stop.wait(RECOVERY_INTERVAL_S):
            return
