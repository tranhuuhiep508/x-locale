"""Batch operations on strings."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import (
    BatchRequest,
    BatchResult,
    CliPushBatchOut,
    CliPushPublishRequest,
    PublishPreviewEntriesOut,
    PublishPreviewRequest,
)
from app.services.publish_preview import (
    cli_push_batch,
    list_publish_preview_entries,
    publish_cli_push_batch,
)
from app.services.strings import apply_batch

router = APIRouter(prefix="/projects/{project_id}", tags=["batch"])


@router.get("/cli-push-batches/{batch_id}")
def get_cli_push_batch(batch_id: UUID, project: ProjectAccess, db: DbSession) -> CliPushBatchOut:
    return cli_push_batch(db, project, batch_id)


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


@router.post("/cli-push-batches/{batch_id}/publish")
def complete_cli_push_batch(
    batch_id: UUID, payload: CliPushPublishRequest, project: ProjectAccess, db: DbSession
) -> BatchResult:
    return publish_cli_push_batch(db, project, batch_id, payload)
