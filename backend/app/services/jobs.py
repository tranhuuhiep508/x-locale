"""Background jobs: lookup, start, and run."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse
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


def start_job(db: Session, project_id: uuid.UUID, kind: str, meta: dict[str, Any]) -> Job:
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
    held, release_holder = threading.Event(), threading.Event()
    holder = threading.Thread(
        target=_hold_session_lock,
        args=(project_id, held, release_holder),
        name="import-lock-handoff",
        daemon=True,
    )
    holder.start()
    try:
        deadline = time.monotonic() + _HANDOFF_TIMEOUT_S
        while time.monotonic() < deadline and not import_lock.import_lock_waiting(db, project_id):
            time.sleep(0.01)
        job = start_job(db, project_id, kind, meta)
        if not held.wait(_HANDOFF_TIMEOUT_S):
            logger.warning("Job %s session lock was not granted", job.id)
        threading.Thread(
            target=run_job,
            args=(job.id, project_id, work),
            name=f"job-{job.id}",
            daemon=True,
        ).start()
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
    except Exception:
        db.rollback()
        raise
    finally:
        release_holder.set()
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


def _record_failure(job_id: uuid.UUID, exc: Exception) -> None:
    message, error = _error_details(exc)
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        _finish(job, JobStatus.failed, phase="failed")
        job.error = message
        job.result = {"error": error}
        db.commit()
    finally:
        db.close()


def run_job(job_id: uuid.UUID, project_id: uuid.UUID, work: JobWork) -> None:
    """Run ``work`` in its own session while holding the project's import lock.

    ``work`` must leave its writes uncommitted. Completed status is written in
    that same transaction, so a saved import or undo never reads as running
    and a failure rolls the write back.
    """
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        db.info["activity"] = dict((job.payload or {}).get("actor") or {})
        db.info[JOB_ID_KEY] = job_id
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        wait_for_import_lock(db, project_id)
        result = work(db, project)
        job = db.get(Job, job_id)
        if job is None:
            db.rollback()
            return
        db.refresh(job)
        _finish(job, JobStatus.completed, phase="done")
        job.result = result
        db.commit()
    except Exception as exc:
        db.rollback()
        if not isinstance(exc, HTTPException):
            logger.exception("Job %s failed", job_id)
        _record_failure(job_id, exc)
    finally:
        db.close()
