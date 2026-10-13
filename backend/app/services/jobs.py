"""Background jobs: lookup, start, and run."""

from __future__ import annotations

import logging
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
from app.database import SessionLocal
from app.models import Job, JobStatus, Project, User
from app.schemas import JobAcceptedOut
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


def start_job(db: Session, project_id: uuid.UUID, kind: str, meta: dict[str, Any]) -> Job:
    """Create the job as ``running`` and commit, so the first poll already sees it.

    Committing also ends the request transaction and its import lock; the
    worker takes the lock again before it writes.
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

    ``work`` must not commit content itself unless it owns a complete write
    (batch revert's ``run_write``). The completed status is written in the
    same transaction as the import, so a committed import never reads as running.
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
