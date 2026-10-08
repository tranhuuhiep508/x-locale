"""Background job lookup."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auth import membership_for
from app.models import Job, User

NOT_FOUND = "Job not found"


def get_job(db: Session, job_id: uuid.UUID, user: User) -> Job:
    """Return a job only when the caller belongs to its project.

    ``project_id`` is required on every job and is set when translate creates it.
    A missing id and a job in a project the caller does not belong to both
    return 404 so the response does not reveal that the job exists.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None or membership_for(db, job.project_id, user.id) is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return job
