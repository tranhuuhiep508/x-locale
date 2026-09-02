"""Activity serialization and revert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Activity,
    ActivityAction,
    BatchKind,
    EntityType,
    Module,
    Project,
    StringEntry,
    Tag,
    Translation,
    TranslationStatus,
)
from app.schemas import (
    ActivityChangeOut,
    ActivityFeedCardOut,
    ActivityFeedChildOut,
    ActivityFeedOut,
    ActivityListOut,
    ActivityOut,
)
from app.services.activity_events import (
    EVENT_CREATED,
    EVENT_DELETED,
    EVENT_PENDING_DELETE,
    EVENT_PUBLISHED,
    EVENT_UNPUBLISHED,
    UNDOABLE_BATCH_KINDS,
    batch_card_event_type,
    batch_card_summary,
    classify_event,
    human_changed,
    is_history_restorable,
    snapshot_key,
)


def _changed_out(activity: Activity) -> list[ActivityChangeOut]:
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    return [
        ActivityChangeOut(
            field=row.field,
            before=row.before,
            after=row.after,
            locale=row.locale,
        )
        for row in human_changed(activity.before, activity.after, action=str(action or "update"))
    ]


def serialize_activity(activity: Activity) -> ActivityOut:
    return ActivityOut(
        id=activity.id,
        actor_type=activity.actor_type.value
        if hasattr(activity.actor_type, "value")
        else activity.actor_type,
        actor_id=activity.actor_id,
        actor_label=activity.actor_label,
        action=activity.action.value if hasattr(activity.action, "value") else activity.action,
        entity_type=activity.entity_type.value
        if hasattr(activity.entity_type, "value")
        else activity.entity_type,
        entity_id=activity.entity_id,
        string_id=activity.string_id,
        locale=activity.locale,
        before=activity.before,
        after=activity.after,
        event_type=activity.event_type or "string.updated",
        summary=activity.summary,
        batch_id=activity.batch_id,
        batch_kind=activity.batch_kind.value
        if activity.batch_kind and hasattr(activity.batch_kind, "value")
        else (activity.batch_kind),
        revert_of_id=activity.revert_of_id,
        reverted_by_id=activity.reverted_by_id,
        is_revertible=activity.is_revertible,
        created_at=activity.created_at,
        changed=_changed_out(activity),
    )


def list_activities(
    db: Session,
    project: Project,
    *,
    entity_type: str | None = None,
    string_id: uuid.UUID | None = None,
    actor: str | None = None,
    action: str | None = None,
    event_type: str | None = None,
    batch_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = 1,
    page_size: int = 50,
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
    if event_type:
        q = q.filter(Activity.event_type == event_type)
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


def list_string_activities(
    db: Session,
    project: Project,
    string_id: uuid.UUID,
    *,
    page: int = 1,
    page_size: int = 50,
) -> ActivityListOut:
    return list_activities(
        db,
        project,
        string_id=string_id,
        page=page,
        page_size=page_size,
    )


def _as_uuid(value: Any) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _card_expr():
    return func.coalesce(Activity.batch_id, Activity.id)


def _apply_feed_filters(
    q,
    *,
    actor: str | None,
    event_type: str | None,
    locale: str | None,
    since: datetime | None,
    until: datetime | None,
):
    if actor:
        q = q.filter(Activity.actor_label.ilike(f"%{actor}%"))
    if locale:
        q = q.filter(Activity.locale == locale)
    if since:
        q = q.filter(Activity.created_at >= since)
    if until:
        q = q.filter(Activity.created_at <= until)
    if event_type:
        if event_type == "import":
            q = q.filter(
                Activity.batch_kind.in_([BatchKind.import_, BatchKind.excel_import])
            )
        elif event_type in {"excel_import", "translate", "batch", "revert"}:
            q = q.filter(Activity.batch_kind == event_type)
        else:
            q = q.filter(Activity.event_type == event_type)
    return q


def _feed_child(activity: Activity) -> ActivityFeedChildOut:
    return ActivityFeedChildOut(
        id=activity.id,
        event_type=activity.event_type or "string.updated",
        summary=activity.summary,
        string_id=activity.string_id,
        string_key=snapshot_key(activity.before, activity.after),
        locale=activity.locale,
        changed=_changed_out(activity),
    )


def _feed_card(rows: list[Activity]) -> ActivityFeedCardOut:
    rows = sorted(
        rows,
        key=lambda item: (
            item.created_at.timestamp() if item.created_at else 0.0,
            str(item.id),
        ),
        reverse=True,
    )
    newest = rows[0]
    kind_val = (
        newest.batch_kind.value
        if newest.batch_kind and hasattr(newest.batch_kind, "value")
        else newest.batch_kind
    )
    is_batch = newest.batch_id is not None
    card_id = str(newest.batch_id or newest.id)
    classified = [
        classify_event(
            action=row.action.value if hasattr(row.action, "value") else str(row.action),
            before=row.before,
            after=row.after,
            batch_kind=kind_val,
        )
        for row in rows
    ]
    if is_batch:
        event_type = batch_card_event_type(kind_val)
        summary = batch_card_summary(kind_val, classified, len(rows))
    else:
        event_type = newest.event_type or classified[0].event_type
        summary = newest.summary
    counts = {
        "created": sum(1 for row in rows if (row.event_type or "") == EVENT_CREATED),
        "updated": sum(
            1
            for row in rows
            if (row.event_type or "")
            not in {EVENT_CREATED, EVENT_DELETED, EVENT_PENDING_DELETE, EVENT_PUBLISHED}
        ),
        "deleted": sum(
            1
            for row in rows
            if (row.event_type or "") in {EVENT_DELETED, EVENT_PENDING_DELETE}
        ),
        "published": sum(1 for row in rows if (row.event_type or "") == EVENT_PUBLISHED),
    }
    undoable = bool(
        is_batch
        and kind_val in UNDOABLE_BATCH_KINDS
        and any(row.is_revertible and not row.reverted_by_id for row in rows)
    )
    changed = _changed_out(newest) if not is_batch else []
    return ActivityFeedCardOut(
        id=card_id,
        kind="batch" if is_batch else "single",
        event_type=event_type,
        summary=summary,
        actor_type=newest.actor_type.value
        if hasattr(newest.actor_type, "value")
        else str(newest.actor_type),
        actor_label=newest.actor_label,
        created_at=newest.created_at,
        string_id=None if is_batch else newest.string_id,
        string_key=None if is_batch else snapshot_key(newest.before, newest.after),
        locale=None if is_batch else newest.locale,
        batch_id=newest.batch_id,
        batch_kind=kind_val,
        children_count=len(rows),
        is_undoable=undoable,
        counts=counts,
        changed=changed,
        children=[_feed_child(row) for row in rows] if is_batch else [],
    )


def list_activity_feed(
    db: Session,
    project: Project,
    *,
    actor: str | None = None,
    event_type: str | None = None,
    locale: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = 1,
    page_size: int = 20,
) -> ActivityFeedOut:
    card_expr = _card_expr()
    base = db.query(Activity).filter(Activity.project_id == project.id)
    base = _apply_feed_filters(
        base, actor=actor, event_type=event_type, locale=locale, since=since, until=until
    )
    grouped = base.with_entities(
        card_expr.label("card_id"),
        func.max(Activity.created_at).label("ts"),
        func.max(Activity.id).label("tie"),
    ).group_by(card_expr)
    sub = grouped.subquery()
    total = db.query(func.count()).select_from(sub).scalar() or 0
    page_rows = (
        db.query(sub.c.card_id)
        .order_by(sub.c.ts.desc(), sub.c.tie.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    card_ids = [_as_uuid(row[0]) for row in page_rows]
    if not card_ids:
        return ActivityFeedOut(items=[], total=total, page=page, page_size=page_size)

    children = (
        db.query(Activity)
        .filter(Activity.project_id == project.id)
        .filter(or_(Activity.batch_id.in_(card_ids), Activity.id.in_(card_ids)))
        .all()
    )
    by_card: dict[uuid.UUID, list[Activity]] = {}
    for row in children:
        by_card.setdefault(row.batch_id or row.id, []).append(row)

    items = []
    for card_id in card_ids:
        rows = by_card.get(card_id)
        if rows:
            items.append(_feed_card(rows))
    return ActivityFeedOut(items=items, total=total, page=page, page_size=page_size)


def restore_activity_version(
    db: Session,
    project: Project,
    string_id: uuid.UUID,
    activity_id: uuid.UUID,
) -> Activity:
    from app.activity import set_restore_intent
    from app.services.strings import get_string

    activity = (
        db.query(Activity)
        .filter(
            Activity.id == activity_id,
            Activity.project_id == project.id,
            Activity.string_id == string_id,
        )
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not activity.after:
        raise HTTPException(status_code=400, detail="This version cannot be restored")
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    if not is_history_restorable(activity.event_type, action):
        raise HTTPException(status_code=400, detail=_history_restore_reject_detail(activity.event_type))
    entry = get_string(db, project.id, string_id)
    if entry.deleted_at is not None:
        raise HTTPException(
            status_code=400,
            detail="Restore the string from Deleted before restoring a version",
        )
    if _working_copy_matches(entry, activity.after):
        raise HTTPException(
            status_code=400,
            detail="Working copy already matches this version",
        )
    set_restore_intent(db)
    _apply_working_copy_only(db, entry, activity.after, include_status=False)
    db.commit()
    db.expire_all()
    latest = (
        db.query(Activity)
        .filter(Activity.project_id == project.id, Activity.string_id == string_id)
        .order_by(Activity.created_at.desc(), Activity.id.desc())
        .first()
    )
    return latest or activity


def _history_restore_reject_detail(event_type: str | None) -> str:
    if event_type == EVENT_PUBLISHED or event_type == EVENT_UNPUBLISHED:
        return (
            "Publish and unpublish cannot be restored from History. "
            "Use Publish or Unpublish, or Undo a batch on the Activity feed."
        )
    if event_type == EVENT_PENDING_DELETE:
        return (
            "Pending deletes cannot be restored from History. "
            "Use Restore on the strings grid to cancel the removal."
        )
    if event_type == EVENT_DELETED:
        return "Deleted strings cannot be restored from History. Use Restore on the Deleted filter."
    return "This version cannot be restored"


def _working_copy_matches(entry: StringEntry, snap: dict[str, Any]) -> bool:
    if snap.get("key", entry.key) != entry.key:
        return False
    if snap.get("source_text", entry.source_text) != entry.source_text:
        return False
    if "description" in snap and snap.get("description") != entry.description:
        return False
    if "pending_delete" in snap and bool(snap.get("pending_delete")) != bool(entry.pending_delete):
        return False
    if "module_id" in snap:
        current = str(entry.module_id) if entry.module_id else None
        expected = snap.get("module_id")
        if current != expected:
            return False
    if "tag_ids" in snap:
        current_tags = sorted(str(t.id) for t in (entry.tags or []))
        expected_tags = sorted(str(tid) for tid in (snap.get("tag_ids") or []))
        if current_tags != expected_tags:
            return False
    if "translations" in snap:
        expected = _translations_from_snapshot(snap.get("translations"))
        current_map = {t.locale: t.value or "" for t in (entry.translations or [])}
        for locale, value in expected.items():
            if current_map.get(locale, "") != value:
                return False
    return True


def restore_last_history(db: Session, project: Project, entries: list[StringEntry]) -> int:
    from app.activity import set_restore_intent

    set_restore_intent(db)
    affected = 0
    for entry in entries:
        if entry.deleted_at is not None:
            continue
        latest = (
            db.query(Activity)
            .filter(
                Activity.project_id == project.id,
                Activity.string_id == entry.id,
                Activity.before.isnot(None),
            )
            .order_by(Activity.created_at.desc(), Activity.id.desc())
            .first()
        )
        if not latest or not latest.before:
            continue
        action = latest.action.value if hasattr(latest.action, "value") else latest.action
        if action == "delete":
            continue
        _apply_working_copy_only(db, entry, latest.before, include_status=False)
        affected += 1
    return affected


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


def _set_entry_published_translations(
    db: Session, entry: StringEntry, translations: dict[str, str | None]
) -> None:
    rows = db.query(Translation).filter(Translation.string_id == entry.id).all()
    by_locale = {t.locale: t for t in rows}
    for locale, value in translations.items():
        existing = by_locale.get(locale)
        if existing is None:
            db.add(
                Translation(
                    string_id=entry.id,
                    locale=locale,
                    value="",
                    published_value=value,
                )
            )
        else:
            existing.published_value = value


def _parse_datetime(raw: Any) -> datetime | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, str):
        return datetime.fromisoformat(raw)
    return None


def _apply_published_snapshot(db: Session, entry: StringEntry, snap: dict[str, Any]) -> None:
    if "published_key" in snap:
        entry.published_key = snap.get("published_key")
    if "published_source_text" in snap:
        entry.published_source_text = snap.get("published_source_text")
    if "pending_delete" in snap:
        entry.pending_delete = bool(snap.get("pending_delete"))
    if "deleted_at" in snap:
        entry.deleted_at = _parse_datetime(snap.get("deleted_at"))
    if "published_at" in snap:
        entry.published_at = _parse_datetime(snap.get("published_at"))
    if "published_module_id" in snap:
        pmid = snap.get("published_module_id")
        if pmid:
            module = db.query(Module).filter(Module.id == uuid.UUID(pmid)).first()
            entry.published_module_id = module.id if module else None
        else:
            entry.published_module_id = None
    if "published_translations" in snap:
        _set_entry_published_translations(
            db, entry, _translations_from_snapshot(snap.get("published_translations"))
        )


def current_matches_after(db: Session, activity: Activity) -> bool:
    """Conflict guard: current row must still match activity.after."""
    after = activity.after or {}
    if activity.entity_type == EntityType.string or activity.entity_type == "string":
        if activity.action == ActivityAction.delete or activity.action == "delete":
            entry = (
                db.query(StringEntry)
                .filter(StringEntry.id == uuid.UUID(activity.entity_id))
                .first()
            )
            if after.get("deleted_at"):
                return entry is not None and entry.deleted_at is not None
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
        for field in ("key", "source_text", "description"):
            if field in after and getattr(entry, field) != after[field]:
                return False
        if "status" in after:
            current = entry.status.value if hasattr(entry.status, "value") else entry.status
            if current != after["status"]:
                return False
        if "pending_delete" in after and bool(entry.pending_delete) != bool(
            after["pending_delete"]
        ):
            return False
        if "deleted_at" in after:
            current_deleted = entry.deleted_at.isoformat() if entry.deleted_at else None
            expected_deleted = after.get("deleted_at")
            if bool(current_deleted) != bool(expected_deleted):
                return False
        if "published_key" in after and entry.published_key != after["published_key"]:
            return False
        if (
            "published_source_text" in after
            and entry.published_source_text != after["published_source_text"]
        ):
            return False
        if "published_module_id" in after:
            current_pub = str(entry.published_module_id) if entry.published_module_id else None
            if current_pub != after["published_module_id"]:
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
            t = (
                db.query(Translation)
                .filter(Translation.id == uuid.UUID(activity.entity_id))
                .first()
            )
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


def _entity_label(activity: Activity) -> str:
    key = snapshot_key(activity.before, activity.after)
    if key:
        return f"'{key}'"
    if activity.locale:
        return str(activity.locale)
    return "item"


def _revert_summary(activity: Activity) -> str:
    return f"Restored previous value of {_entity_label(activity)}"


def _make_revert_marker(
    db: Session,
    *,
    project_id: uuid.UUID,
    activity: Activity,
    existing: dict[str, Any],
    batch_id: uuid.UUID,
) -> Activity:
    del db
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
        event_type="string.restored",
        summary=_revert_summary(activity),
        batch_id=batch_id,
        batch_kind="revert",
        revert_of_id=activity.id,
        is_revertible=True,
    )


def _apply_working_copy_only(
    db: Session, entry: StringEntry, snap: dict[str, Any], *, include_status: bool = False
) -> None:
    entry.key = snap.get("key", entry.key)
    entry.source_text = snap.get("source_text", entry.source_text)
    if "description" in snap:
        entry.description = snap.get("description")
    if include_status and "status" in snap:
        entry.status = TranslationStatus(snap["status"])
    if "pending_delete" in snap:
        entry.pending_delete = bool(snap.get("pending_delete"))
    if "module_id" in snap:
        mid = snap.get("module_id")
        if mid:
            module = db.query(Module).filter(Module.id == uuid.UUID(mid)).first()
            entry.module_id = module.id if module else None
        else:
            entry.module_id = None
    if "tag_ids" in snap:
        _set_entry_tags(db, entry, snap.get("tag_ids") or [])
    if "translations" in snap:
        trans_raw = snap.get("translations")
        if isinstance(trans_raw, list):
            by_locale = {t.locale: t for t in (entry.translations or [])}
            for tdata in trans_raw:
                locale = tdata["locale"]
                existing = by_locale.get(locale)
                value = tdata.get("value", "")
                if existing is None:
                    db.add(
                        Translation(
                            id=uuid.UUID(tdata["id"]) if tdata.get("id") else uuid.uuid4(),
                            string_id=entry.id,
                            locale=locale,
                            value=value,
                        )
                    )
                else:
                    existing.value = value
            db.flush()
        else:
            _set_entry_translations(db, entry, _translations_from_snapshot(trans_raw))


def _apply_working_snapshot(db: Session, entry: StringEntry, snap: dict[str, Any]) -> None:
    _apply_working_copy_only(db, entry, snap, include_status=True)
    _apply_published_snapshot(db, entry, snap)


def apply_revert(db: Session, activity: Activity) -> None:
    before = activity.before or {}
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    etype = (
        activity.entity_type.value
        if hasattr(activity.entity_type, "value")
        else activity.entity_type
    )

    if etype == "string":
        if action == "update":
            entry = (
                db.query(StringEntry)
                .filter(StringEntry.id == uuid.UUID(activity.entity_id))
                .first()
            )
            if not entry:
                raise HTTPException(status_code=404, detail="String no longer exists")
            _apply_working_snapshot(db, entry, before)
        elif action == "create":
            entry = (
                db.query(StringEntry)
                .filter(StringEntry.id == uuid.UUID(activity.entity_id))
                .first()
            )
            if entry:
                db.delete(entry)
        elif action == "delete":
            existing = (
                db.query(StringEntry).filter(StringEntry.id == uuid.UUID(before["id"])).first()
            )
            if existing:
                _apply_working_snapshot(db, existing, before)
            else:
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
                    pending_delete=bool(before.get("pending_delete", False)),
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
                    db.flush()
                else:
                    _set_entry_translations(db, entry, _translations_from_snapshot(trans_raw))
                db.flush()
                _apply_published_snapshot(db, entry, before)

    elif etype == "translation":
        if action == "update":
            t = (
                db.query(Translation)
                .filter(Translation.id == uuid.UUID(activity.entity_id))
                .first()
            )
            if not t:
                raise HTTPException(status_code=404, detail="Translation no longer exists")
            t.value = before.get("value", t.value)
        elif action == "create":
            t = (
                db.query(Translation)
                .filter(Translation.id == uuid.UUID(activity.entity_id))
                .first()
            )
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


def revert_activity(
    db: Session,
    project: Project,
    activity_id: uuid.UUID,
    *,
    force: bool = False,
) -> Activity:
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

    if not force and not current_matches_after(db, activity):
        raise HTTPException(
            status_code=409,
            detail=(
                "Conflict: current state does not match activity after-state. "
                "Pass force=true to override."
            ),
        )

    from app.activity import attach_batch

    batch_id = uuid.uuid4()
    existing = attach_batch(db, batch_id, "revert")

    apply_revert(db, activity)
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
    return activity


def revert_batch(
    db: Session,
    project: Project,
    batch_id: uuid.UUID,
    *,
    force: bool = False,
) -> dict[str, Any]:
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

    from app.activity import attach_batch

    new_batch = uuid.uuid4()
    existing = attach_batch(db, new_batch, "revert")

    reverted = 0
    for activity in activities:
        if not force and not current_matches_after(db, activity):
            raise HTTPException(
                status_code=409,
                detail=f"Conflict on activity {activity.id}. Pass force=true to override.",
            )
        apply_revert(db, activity)
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
