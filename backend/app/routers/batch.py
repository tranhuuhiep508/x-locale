"""Batch operations on strings."""

from __future__ import annotations

from fastapi import APIRouter

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import BatchRequest, BatchResult, PublishPreviewEntriesOut, PublishPreviewRequest
from app.services.publish_preview import list_publish_preview_entries
from app.services.strings import apply_batch

router = APIRouter(prefix="/projects/{project_id}", tags=["batch"])


@router.post("/strings/publish-preview", response_model=PublishPreviewEntriesOut)
def publish_preview(
    payload: PublishPreviewRequest,
    project: ProjectAccess,
    db: DbSession,
) -> PublishPreviewEntriesOut:
    return list_publish_preview_entries(db, project, payload)


@router.post("/strings/batch", response_model=BatchResult)
def batch_strings(
    payload: BatchRequest,
    project: ProjectAccess,
    db: DbSession,
) -> BatchResult:
    return apply_batch(db, project, payload)
