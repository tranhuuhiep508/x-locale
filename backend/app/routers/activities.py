"""Activity feed and revert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import project_access
from app.database import get_db
from app.models import (
    Activity,
    ActivityAction,
    EntityType,
    Project,
    StringEntry,
    Translation,
    TranslationStatus,
)
from app.schemas import ActivityListOut, ActivityOut

router = APIRouter(tags=["activities"])


def _activity_out(a: Activity) -> ActivityOut:
    return ActivityOut(
        id=a.id,
        actor_type=a.actor_type.value if hasattr(a.actor_type, "value") else a.actor_type,
        actor_id=a.actor_id,
        actor_label=a.actor_label,
        action=a.action.value if hasattr(a.action, "value") else a.action,
        entity_type=a.entity_type.value if hasattr(a.entity_type, "value") else a.entity_type,
        entity_id=a.entity_id,
        string_id=a.string_id,
        locale=a.locale,
        before=a.before,
        after=a.after,
        summary=a.summary,
        batch_id=a.batch_id,
        batch_kind=a.batch_kind.value if a.batch_kind and hasattr(a.batch_kind, "value") else (
            a.batch_kind
        ),
        revert_of_id=a.revert_of_id,
        reverted_by_id=a.reverted_by_id,
        is_revertible=a.is_revertible,
        created_at=a.created_at,
    )


@router.get("/projects/{project_id}/activities", response_model=ActivityListOut)
def list_activities(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    entity_type: str | None = None,
    string_id: uuid.UUID | None = None,
    actor: str | None = None,
    action: str | None = None,
    batch_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
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
        q.order_by(Activity.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ActivityListOut(
        items=[_activity_out(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/projects/{project_id}/strings/{string_id}/activities",
    response_model=ActivityListOut,
)
def string_activities(
    project_id: uuid.UUID,
    string_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> ActivityListOut:
    q = db.query(Activity).filter(
        Activity.project_id == project.id, Activity.string_id == string_id
    )
    total = q.count()
    items = (
        q.order_by(Activity.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ActivityListOut(
        items=[_activity_out(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
    )


def _current_matches_after(db: Session, activity: Activity) -> bool:
    """Conflict guard: current row must still match activity.after."""
    after = activity.after or {}
    if activity.entity_type == EntityType.string or activity.entity_type == "string":
        if activity.action == ActivityAction.delete or activity.action == "delete":
            # After delete, entity should be gone
            entry = db.query(StringEntry).filter(StringEntry.id == uuid.UUID(activity.entity_id)).first()
            return entry is None
        entry = db.query(StringEntry).filter(StringEntry.id == uuid.UUID(activity.entity_id)).first()
        if entry is None:
            return False
        if activity.action == ActivityAction.create or activity.action == "create":
            return True
        # update: compare key fields
        for field in ("key", "source_text", "description"):
            if field in after and getattr(entry, field) != after[field]:
                return False
        if "module_id" in after:
            current = str(entry.module_id) if entry.module_id else None
            if current != after["module_id"]:
                return False
        return True

    if activity.entity_type == EntityType.translation or activity.entity_type == "translation":
        if activity.action == ActivityAction.delete or activity.action == "delete":
            t = db.query(Translation).filter(Translation.id == uuid.UUID(activity.entity_id)).first()
            return t is None
        t = db.query(Translation).filter(Translation.id == uuid.UUID(activity.entity_id)).first()
        if t is None:
            return False
        if activity.action == ActivityAction.create or activity.action == "create":
            return True
        for field in ("value", "locale"):
            if field in after and getattr(t, field) != after[field]:
                return False
        if "status" in after:
            status = t.status.value if hasattr(t.status, "value") else t.status
            if status != after["status"]:
                return False
        return True
    return False


def _apply_revert(db: Session, activity: Activity) -> None:
    before = activity.before or {}
    after = activity.after or {}
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    etype = activity.entity_type.value if hasattr(activity.entity_type, "value") else activity.entity_type

    if etype == "string":
        if action == "update":
            entry = db.query(StringEntry).filter(StringEntry.id == uuid.UUID(activity.entity_id)).first()
            if not entry:
                raise HTTPException(status_code=404, detail="String no longer exists")
            entry.key = before.get("key", entry.key)
            entry.source_text = before.get("source_text", entry.source_text)
            entry.description = before.get("description")
            mid = before.get("module_id")
            if mid:
                # If module was deleted, SET NULL
                from app.models import Module

                module = db.query(Module).filter(Module.id == uuid.UUID(mid)).first()
                entry.module_id = module.id if module else None
            else:
                entry.module_id = None
        elif action == "create":
            entry = db.query(StringEntry).filter(StringEntry.id == uuid.UUID(activity.entity_id)).first()
            if entry:
                db.delete(entry)
        elif action == "delete":
            # Re-insert from before
            mid = before.get("module_id")
            module_id = None
            if mid:
                from app.models import Module

                module = db.query(Module).filter(Module.id == uuid.UUID(mid)).first()
                module_id = module.id if module else None
            entry = StringEntry(
                id=uuid.UUID(before["id"]),
                project_id=uuid.UUID(before["project_id"]),
                module_id=module_id,
                key=before["key"],
                source_text=before["source_text"],
                description=before.get("description"),
            )
            db.add(entry)
            db.flush()
            for tdata in before.get("translations") or []:
                status = tdata.get("status", "draft")
                db.add(
                    Translation(
                        id=uuid.UUID(tdata["id"]) if tdata.get("id") else uuid.uuid4(),
                        string_id=entry.id,
                        locale=tdata["locale"],
                        value=tdata.get("value", ""),
                        status=TranslationStatus(status),
                    )
                )

    elif etype == "translation":
        if action == "update":
            t = db.query(Translation).filter(Translation.id == uuid.UUID(activity.entity_id)).first()
            if not t:
                raise HTTPException(status_code=404, detail="Translation no longer exists")
            t.value = before.get("value", t.value)
            if "status" in before:
                t.status = TranslationStatus(before["status"])
        elif action == "create":
            t = db.query(Translation).filter(Translation.id == uuid.UUID(activity.entity_id)).first()
            if t:
                db.delete(t)
        elif action == "delete":
            t = Translation(
                id=uuid.UUID(before["id"]),
                string_id=uuid.UUID(before["string_id"]),
                locale=before["locale"],
                value=before.get("value", ""),
                status=TranslationStatus(before.get("status", "draft")),
            )
            db.add(t)


@router.post("/projects/{project_id}/activities/{activity_id}/revert", response_model=ActivityOut)
def revert_activity(
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    force: bool = Query(default=False),
) -> ActivityOut:
    activity = (
        db.query(Activity)
        .filter(Activity.id == activity_id, Activity.project_id == project.id)
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not activity.is_revertible:
        raise HTTPException(status_code=400, detail="Activity is not revertible")
    if activity.reverted_by_id and not force:
        raise HTTPException(status_code=400, detail="Activity already reverted")

    if not force and not _current_matches_after(db, activity):
        raise HTTPException(
            status_code=409,
            detail="Conflict: current state does not match activity after-state. Pass force=true to override.",
        )

    batch_id = uuid.uuid4()
    existing = db.info.get("activity") or {}
    db.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": "revert",
    }

    _apply_revert(db, activity)
    db.flush()

    # Stamp original
    revert_marker = Activity(
        project_id=project.id,
        actor_type=existing.get("actor_type", "user"),
        actor_id=existing.get("actor_id"),
        actor_label=existing.get("actor_label", "user"),
        action=ActivityAction.update,
        entity_type=activity.entity_type,
        entity_id=activity.entity_id,
        string_id=activity.string_id,
        locale=activity.locale,
        before=activity.after,
        after=activity.before,
        summary=f"Reverted: {activity.summary}",
        batch_id=batch_id,
        batch_kind="revert",
        revert_of_id=activity.id,
        is_revertible=True,
    )
    db.add(revert_marker)
    db.flush()
    activity.reverted_by_id = revert_marker.id
    db.commit()
    db.refresh(activity)
    return _activity_out(activity)


@router.post(
    "/projects/{project_id}/activities/batch/{batch_id}/revert",
    response_model=dict,
)
def revert_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    force: bool = Query(default=False),
) -> dict:
    activities = (
        db.query(Activity)
        .filter(
            Activity.project_id == project.id,
            Activity.batch_id == batch_id,
            Activity.is_revertible.is_(True),
            Activity.reverted_by_id.is_(None),
        )
        .order_by(Activity.created_at.desc())
        .all()
    )
    if not activities:
        raise HTTPException(status_code=404, detail="No revertible activities in batch")

    new_batch = uuid.uuid4()
    existing = db.info.get("activity") or {}
    db.info["activity"] = {
        **existing,
        "batch_id": str(new_batch),
        "batch_kind": "revert",
    }

    reverted = 0
    for activity in activities:
        if not force and not _current_matches_after(db, activity):
            raise HTTPException(
                status_code=409,
                detail=f"Conflict on activity {activity.id}. Pass force=true to override.",
            )
        _apply_revert(db, activity)
        db.flush()
        marker = Activity(
            project_id=project.id,
            actor_type=existing.get("actor_type", "user"),
            actor_id=existing.get("actor_id"),
            actor_label=existing.get("actor_label", "user"),
            action=ActivityAction.update,
            entity_type=activity.entity_type,
            entity_id=activity.entity_id,
            string_id=activity.string_id,
            locale=activity.locale,
            before=activity.after,
            after=activity.before,
            summary=f"Reverted: {activity.summary}",
            batch_id=new_batch,
            batch_kind="revert",
            revert_of_id=activity.id,
            is_revertible=True,
        )
        db.add(marker)
        db.flush()
        activity.reverted_by_id = marker.id
        reverted += 1

    db.commit()
    return {"reverted": reverted, "batch_id": str(new_batch)}
