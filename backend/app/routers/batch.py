"""Batch operations on strings."""

from __future__ import annotations

from fastapi import APIRouter

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import BatchRequest, BatchResult
from app.services.strings import apply_batch

router = APIRouter(prefix="/projects/{project_id}", tags=["batch"])


@router.post("/strings/batch", response_model=BatchResult)
def batch_strings(
    payload: BatchRequest,
    project: ProjectAccess,
    db: DbSession,
) -> BatchResult:
    return apply_batch(db, project, payload)
