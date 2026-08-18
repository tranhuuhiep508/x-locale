"""Job polling (no project_id in path)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.auth import CurrentUser
from app.database import DbSession
from app.models import Job
from app.schemas import JobOut
from app.services.jobs import get_job

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobOut)
def get_job_endpoint(
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> Job:
    return get_job(db, job_id)
