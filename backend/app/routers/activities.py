"""Activity feed and revert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.auth import project_access
from app.database import get_db
from app.models import (
    Activity,
    ActivityAction,
    EntityType,
    Module,
    Project,
    StringEntry,
    Tag,
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
        q.order_by(Activity.created_at.desc(), Activity.id.desc())
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
        q.order_by(Activity.created_at.desc(), Activity.id.desc())
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


def _translations_from_snapshot(raw: Any) -> dict[str, str]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        out: dict[str, str] = {}
        for locale, value in raw.items():
            if isinstance(value, dict):
                out[str(locale)] = value.get("value", "") or ""
            else:
                out[str(locale)] = value or ""
        return out
    if isinstance(raw, list):
        return {
            item.get("locale"): item.get("value", "") or ""
            for item in raw
            if isinstance(item, dict) and item.get("locale")
        }
    return {}


def _set_entry_tags(db: Session, entry: StringEntry, tag_ids: list[str] | None) -> None:
    if tag_ids is None:
        return
    ids = [uuid.UUID(tid) for tid in tag_ids]
    tags = db.query(Tag).filter(Tag.id.in_(ids)).all() if ids else []
    entry.tags = tags


def _set_entry_translations(db: Session, entry: StringEntry, translations: dict[str, str]) -> None:
    by_locale = {t.locale: t for t in list(entry.translations or [])}
    for locale, value in translations.items():
        existing = by_locale.get(locale)
        if existing is None:
            db.add(Translation(string_id=entry.id, locale=locale, value=value))
        else:
            existing.value = value


def _current_matches_after(db: Session, activity: Activity) -> bool:
    """Conflict guard: current row must still match activity.after."""
    after = activity.after or {}
    if activity.entity_type == EntityType.string or activity.entity_type == "string":
        if activity.action == ActivityAction.delete or activity.action == "delete":
            # After delete, entity should be gone
            entry = db.query(StringEntry).filter(StringEntry.id == uuid.UUID(activity.entity_id)).first()
            return entry is None
        entry = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations), joinedload(StringEntry.tags))
            .filter(StringEntry.id == uuid.UUID(activity.entity_id))
            .first()
        )
        if entry is None:
            return False
        if activity.action == ActivityAction.create or activity.action == "create":
            return True
        # update: compare key fields
        for field in ("key", "source_text", "description"):
            if field in after and getattr(entry, field) != after[field]:
                return False
        if "status" in after:
            current = entry.status.value if hasattr(entry.status, "value") else entry.status
            if current != after["status"]:
                return False
        if "module_id" in after:
            current = str(entry.module_id) if entry.module_id else None
            if current != after["module_id"]:
                return False
        if "tag_ids" in after:
            current_tags = sorted(str(t.id) for t in (entry.tags or []))
            expected_tags = sorted(after.get("tag_ids") or [])
            if current_tags != expected_tags:
                return False
        if "translations" in after:
            expected = _translations_from_snapshot(after.get("translations"))
            current_map = {t.locale: t.value or "" for t in (entry.translations or [])}
            for locale, value in expected.items():
                if current_map.get(locale, "") != value:
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
        return True
    return False


def _enum_val(val: Any) -> str:
    return val.value if hasattr(val, "value") else str(val or "")


def _original_activity(db: Session, activity: Activity) -> Activity:
    current = activity
    seen: set[uuid.UUID] = set()
    while current.revert_of_id:
        if current.id in seen:
            break
        seen.add(current.id)
        parent = db.get(Activity, current.revert_of_id)
        if parent is None:
            break
        current = parent
    return current


def _revert_depth(db: Session, activity: Activity) -> int:
    depth = 0
    current = activity
    seen: set[uuid.UUID] = set()
    while current.revert_of_id:
        if current.id in seen:
            break
        seen.add(current.id)
        parent = db.get(Activity, current.revert_of_id)
        if parent is None:
            break
        current = parent
        depth += 1
    return depth


def _entity_label(activity: Activity) -> str:
    snap = activity.after or activity.before or {}
    key = snap.get("key") if isinstance(snap, dict) else None
    if key:
        return f"'{key}'"
    if activity.locale:
        return str(activity.locale)
    return "item"


def _revert_summary(db: Session, activity: Activity) -> str:
    original = _original_activity(db, activity)
    action = _enum_val(original.action)
    label = _entity_label(original)
    # Reverting a revert (odd depth) redoes the original change.
    verb = "Redid" if _revert_depth(db, activity) % 2 == 1 else "Reverted"
    return f"{verb} {action} of {label}"


def _make_revert_marker(
    db: Session,
    *,
    project_id: uuid.UUID,
    activity: Activity,
    existing: dict[str, Any],
    batch_id: uuid.UUID,
) -> Activity:
    return Activity(
        project_id=project_id,
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
        summary=_revert_summary(db, activity),
        batch_id=batch_id,
        batch_kind="revert",
        revert_of_id=activity.id,
        is_revertible=True,
    )


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
            if "status" in before:
                entry.status = TranslationStatus(before["status"])
            mid = before.get("module_id")
            if mid:
                module = db.query(Module).filter(Module.id == uuid.UUID(mid)).first()
                entry.module_id = module.id if module else None
            else:
                entry.module_id = None
            if "tag_ids" in before:
                _set_entry_tags(db, entry, before.get("tag_ids") or [])
            if "translations" in before or "translations" in after:
                _set_entry_translations(
                    db, entry, _translations_from_snapshot(before.get("translations"))
                )
        elif action == "create":
            entry = db.query(StringEntry).filter(StringEntry.id == uuid.UUID(activity.entity_id)).first()
            if entry:
                db.delete(entry)
        elif action == "delete":
            # Re-insert from before
            mid = before.get("module_id")
            module_id = None
            if mid:
                module = db.query(Module).filter(Module.id == uuid.UUID(mid)).first()
                module_id = module.id if module else None
            entry = StringEntry(
                id=uuid.UUID(before["id"]),
                project_id=uuid.UUID(before["project_id"]),
                module_id=module_id,
                key=before["key"],
                source_text=before["source_text"],
                description=before.get("description"),
                status=TranslationStatus(before.get("status", "draft")),
            )
            db.add(entry)
            db.flush()
            _set_entry_tags(db, entry, before.get("tag_ids") or [])
            trans_raw = before.get("translations")
            if isinstance(trans_raw, list):
                for tdata in trans_raw:
                    db.add(
                        Translation(
                            id=uuid.UUID(tdata["id"]) if tdata.get("id") else uuid.uuid4(),
                            string_id=entry.id,
                            locale=tdata["locale"],
                            value=tdata.get("value", ""),
                        )
                    )
            else:
                _set_entry_translations(db, entry, _translations_from_snapshot(trans_raw))

    elif etype == "translation":
        if action == "update":
            t = db.query(Translation).filter(Translation.id == uuid.UUID(activity.entity_id)).first()
            if not t:
                raise HTTPException(status_code=404, detail="Translation no longer exists")
            t.value = before.get("value", t.value)
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

    revert_marker = _make_revert_marker(
        db,
        project_id=project.id,
        activity=activity,
        existing=existing,
        batch_id=batch_id,
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
        marker = _make_revert_marker(
            db,
            project_id=project.id,
            activity=activity,
            existing=existing,
            batch_id=new_batch,
        )
        db.add(marker)
        db.flush()
        activity.reverted_by_id = marker.id
        reverted += 1

    db.commit()
    return {"reverted": reverted, "batch_id": str(new_batch)}
