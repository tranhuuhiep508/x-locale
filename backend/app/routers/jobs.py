"""Job polling (no project_id in path)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.auth import CurrentUser
from app.database import DbSession
from app.models import Job
from app.schemas import JobOut

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobOut)
def get_job(
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> Job:
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
