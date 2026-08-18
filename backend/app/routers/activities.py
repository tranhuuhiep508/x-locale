"""Activity feed and revert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import ActivityListOut, ActivityOut
from app.services.activities import (
    list_activities,
    list_string_activities,
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
        batch_id=batch_id,
        since=since,
        until=until,
        page=page,
        page_size=page_size,
    )


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


@router.post("/activities/{activity_id}/revert", response_model=ActivityOut)
def revert_activity_endpoint(
    activity_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
    force: Annotated[bool, Query()] = False,
) -> ActivityOut:
    activity = revert_activity(db, project, activity_id, force=force)
    return serialize_activity(activity)


@router.post("/activities/batch/{batch_id}/revert", response_model=dict)
def revert_batch_endpoint(
    batch_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
    force: Annotated[bool, Query()] = False,
) -> dict:
    return revert_batch(db, project, batch_id, force=force)
