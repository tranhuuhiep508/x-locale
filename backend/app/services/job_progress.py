"""Job progress writes that polling can see while the job's own transaction is open."""

from __future__ import annotations

import threading
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import SessionLocal
from app.models import Job

JOB_ID_KEY = "job_id"
_progress_lock = threading.Lock()


def write_job_progress(
    job_id: uuid.UUID,
    phase: str,
    chunks_done: int,
    chunks_total: int,
) -> None:
    # A separate session commits at once. The job's work session must not have
    # updated this row yet, or this write would wait on that open transaction.
    with _progress_lock:
        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job is None:
                return
            payload = dict(job.payload or {})
            payload["progress"] = {
                "phase": phase,
                "chunks_done": chunks_done,
                "chunks_total": chunks_total,
            }
            job.payload = payload
            flag_modified(job, "payload")
            db.commit()
        finally:
            db.close()


def report_progress(db: Session, phase: str, chunks_done: int = 0, chunks_total: int = 0) -> None:
    """Record progress when ``db`` belongs to a background job; a no-op for requests."""
    job_id = db.info.get(JOB_ID_KEY)
    if job_id is not None:
        write_job_progress(job_id, phase, chunks_done, chunks_total)
