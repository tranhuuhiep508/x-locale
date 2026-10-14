"""Job polling. The path has no project id; access is checked on the job's project."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from app.auth import _resolve_api_key, optional_user
from app.database import DbSession
from app.models import Job, User
from app.schemas import JobOut
from app.services.jobs import NOT_FOUND, get_job

router = APIRouter(prefix="/jobs", tags=["jobs"])


def job_access(
    job_id: uuid.UUID,
    db: DbSession,
    user: Annotated[User | None, Depends(optional_user)],
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> Job:
    """Same rule as ``project_access``: an API key reads its own project's jobs,
    a session reads jobs of projects it belongs to, everything else is 404."""
    if x_api_key:
        _, project = _resolve_api_key(db, x_api_key)
        job = db.get(Job, job_id)
        if job is None or job.project_id != project.id:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return job
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return get_job(db, job_id, user)


@router.get("/{job_id}", response_model=JobOut)
def get_job_endpoint(job: Annotated[Job, Depends(job_access)]) -> Job:
    return job
