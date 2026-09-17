"""Activity feed and revert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import (
    ActivityDetailOut,
    ActivityFeedOut,
    ActivityListOut,
    ActivityOut,
    RestorePreviewOut,
    RestoreVersionOut,
    RevertPreviewOut,
)
from app.services.activities import (
    get_activity_detail,
    list_activities,
    list_activity_feed,
    list_string_activities,
    module_name_map,
    preview_restore_activity_version,
    preview_revert_activity,
    preview_revert_batch,
    restore_activity_version,
    revert_activity,
    revert_batch,
    serialize_activity,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["activities"])


@router.get("/activities", response_model=ActivityListOut)
def list_activities_endpoint(
    project: ProjectAccess,
    db: DbSession,
    entity_type: str | None = None,
    string_id: uuid.UUID | None = None,
    actor: str | None = None,
    action: str | None = None,
    event_type: str | None = None,
    batch_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ActivityListOut:
    return list_activities(
        db,
        project,
        entity_type=entity_type,
        string_id=string_id,
        actor=actor,
        action=action,
        event_type=event_type,
        batch_id=batch_id,
        since=since,
        until=until,
        page=page,
        page_size=page_size,
    )


@router.get("/activities/feed", response_model=ActivityFeedOut)
def activity_feed(
    project: ProjectAccess,
    db: DbSession,
    event_type: str | None = None,
    actor: str | None = None,
    locale: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ActivityFeedOut:
    return list_activity_feed(
        db,
        project,
        actor=actor,
        event_type=event_type,
        locale=locale,
        since=since,
        until=until,
        page=page,
        page_size=page_size,
    )


@router.get("/activities/{activity_id}", response_model=ActivityDetailOut)
def activity_detail_endpoint(
    activity_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> ActivityDetailOut:
    return get_activity_detail(db, project, activity_id)


@router.get("/strings/{string_id}/activities", response_model=ActivityListOut)
def string_activities(
    string_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ActivityListOut:
    return list_string_activities(
        db, project, string_id, page=page, page_size=page_size
    )


@router.post("/strings/{string_id}/activities/{activity_id}/restore", response_model=RestoreVersionOut)
def restore_string_version(
    string_id: uuid.UUID,
    activity_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> RestoreVersionOut:
    return restore_activity_version(db, project, string_id, activity_id)


@router.get(
    "/strings/{string_id}/activities/{activity_id}/restore/preview",
    response_model=RestorePreviewOut,
)
def restore_string_version_preview(
    string_id: uuid.UUID,
    activity_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> RestorePreviewOut:
    return preview_restore_activity_version(db, project, string_id, activity_id)


@router.post("/activities/{activity_id}/revert", response_model=ActivityOut)
def revert_activity_endpoint(
    activity_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
    force: Annotated[bool, Query()] = False,
) -> ActivityOut:
    activity = revert_activity(db, project, activity_id, force=force)
    return serialize_activity(activity, module_name_map(db, project.id))


@router.get("/activities/{activity_id}/revert/preview", response_model=RevertPreviewOut)
def revert_activity_preview_endpoint(
    activity_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> RevertPreviewOut:
    return preview_revert_activity(db, project, activity_id)


@router.post("/activities/batch/{batch_id}/revert", response_model=dict)
def revert_batch_endpoint(
    batch_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
    force: Annotated[bool, Query()] = False,
) -> dict:
    return revert_batch(db, project, batch_id, force=force)


@router.get("/activities/batch/{batch_id}/revert/preview", response_model=RevertPreviewOut)
def revert_batch_preview_endpoint(
    batch_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> RevertPreviewOut:
    return preview_revert_batch(db, project, batch_id)
