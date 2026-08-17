"""Activity feed and revert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.auth import ProjectAccess
from app.database import DbSession
from app.models import Activity
from app.schemas import ActivityListOut, ActivityOut
from app.services.activities import revert_activity, revert_batch, serialize_activity

router = APIRouter(prefix="/projects/{project_id}", tags=["activities"])


@router.get("/activities", response_model=ActivityListOut)
def list_activities(
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
    q = db.query(Activity).filter(Activity.project_id == project.id)
    if entity_type:
        q = q.filter(Activity.entity_type == entity_type)
    if string_id:
        q = q.filter(Activity.string_id == string_id)
    if actor:
        q = q.filter(Activity.actor_label.ilike(f"%{actor}%"))
    if action:
        q = q.filter(Activity.action == action)
    if batch_id:
        q = q.filter(Activity.batch_id == batch_id)
    if since:
        q = q.filter(Activity.created_at >= since)
    if until:
        q = q.filter(Activity.created_at <= until)
    total = q.count()
    items = (
        q.order_by(Activity.created_at.desc(), Activity.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ActivityListOut(
        items=[serialize_activity(a) for a in items],
        total=total,
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
    q = db.query(Activity).filter(
        Activity.project_id == project.id, Activity.string_id == string_id
    )
    total = q.count()
    items = (
        q.order_by(Activity.created_at.desc(), Activity.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ActivityListOut(
        items=[serialize_activity(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
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
