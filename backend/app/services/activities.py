"""Activity serialization and revert."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, defer, joinedload

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
    ActivityDetailOut,
    ActivityFeedCardOut,
    ActivityFeedChildOut,
    ActivityFeedOut,
    ActivityLinkOut,
    ActivityListOut,
    ActivityOut,
    RestorePreviewOut,
    RestoreVersionOut,
    RevertPreviewItemOut,
    RevertPreviewOut,
)
from app.services.activity_events import (
    EVENT_CREATED,
    EVENT_DELETED,
    EVENT_PENDING_DELETE,
    EVENT_PUBLISHED,
    EVENT_UNPUBLISHED,
    UNDOABLE_BATCH_KINDS,
    ChangedField,
    batch_card_event_type,
    batch_card_summary,
    human_changed,
    is_history_restorable,
    published_fields_changed,
    snapshot_key,
)

FEED_CHILD_LIMIT = 50
CHILD_CHANGE_LIMIT = 10
_LOCALE_RE = re.compile(r"^[\w-]+$")


def module_name_map(db: Session, project_id: uuid.UUID) -> dict[str, str]:
    """id-string -> module name, for resolving module_id change rows to friendly labels."""
    rows = db.query(Module.id, Module.name).filter(Module.project_id == project_id).all()
    return {str(mid): name for mid, name in rows}


def _to_changed_out(
    rows: list[ChangedField], module_names: dict[str, str] | None = None
) -> list[ActivityChangeOut]:
    names = module_names or {}
    out: list[ActivityChangeOut] = []
    for row in rows:
        before, after = row.before, row.after
        if row.field == "module_id":
            before = names.get(before, before) if before else before
            after = names.get(after, after) if after else after
        out.append(
            ActivityChangeOut(
                field=row.field,
                before=before,
                after=after,
                locale=row.locale,
                scope=row.scope,
                kind=row.kind,
            )
        )
    return out


def _changed_out(
    activity: Activity, module_names: dict[str, str] | None = None
) -> list[ActivityChangeOut]:
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    rows = human_changed(activity.before, activity.after, action=str(action or "update"))
    return _to_changed_out(rows, module_names)


def serialize_activity(
    activity: Activity, module_names: dict[str, str] | None = None
) -> ActivityOut:
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
        changed=_changed_out(activity, module_names),
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
    names = module_name_map(db, project.id)
    return ActivityListOut(
        items=[serialize_activity(a, names) for a in items],
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
        q = q.filter(_locale_filter(locale))
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


def _locale_filter(locale: str):
    if not _LOCALE_RE.fullmatch(locale):
        return Activity.locale == locale
    return or_(
        Activity.locale == locale,
        Activity.after["translations"][locale].isnot(None),
        Activity.before["translations"][locale].isnot(None),
    )


def _feed_counts(type_n: dict[str, int]) -> dict[str, int]:
    created = type_n.get(EVENT_CREATED, 0)
    deleted = type_n.get(EVENT_DELETED, 0) + type_n.get(EVENT_PENDING_DELETE, 0)
    published = type_n.get(EVENT_PUBLISHED, 0)
    total = sum(type_n.values())
    return {
        "created": created,
        "updated": total - created - deleted - published,
        "deleted": deleted,
        "published": published,
    }


def _feed_child(
    activity: Activity,
    *,
    before: dict | None,
    after: dict | None,
    module_names: dict[str, str] | None = None,
) -> ActivityFeedChildOut:
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    rows = human_changed(before, after, action=str(action or "update"))
    changed = _to_changed_out(rows, module_names)[:CHILD_CHANGE_LIMIT]
    return ActivityFeedChildOut(
        id=activity.id,
        event_type=activity.event_type or "string.updated",
        summary=activity.summary,
        string_id=activity.string_id,
        string_key=snapshot_key(before, after),
        locale=activity.locale,
        changed=changed,
    )


def _sort_feed_rows(rows: list[Activity]) -> list[Activity]:
    return sorted(
        rows,
        key=lambda item: (
            item.created_at.timestamp() if item.created_at else 0.0,
            str(item.id),
        ),
        reverse=True,
    )


def _feed_card(
    rows: list[Activity],
    snaps: dict[uuid.UUID, tuple[dict | None, dict | None]],
    *,
    type_counts: dict[str, int],
    children_count: int,
    any_undoable: bool,
    module_names: dict[str, str] | None = None,
) -> ActivityFeedCardOut:
    rows = _sort_feed_rows(rows)
    newest = rows[0]
    kind_val = (
        newest.batch_kind.value
        if newest.batch_kind and hasattr(newest.batch_kind, "value")
        else newest.batch_kind
    )
    is_batch = newest.batch_id is not None
    card_id = str(newest.batch_id or newest.id)
    stored_types = [event_type for event_type, n in type_counts.items() if n]
    if is_batch:
        event_type = batch_card_event_type(kind_val)
        summary = batch_card_summary(kind_val, stored_types, children_count)
    else:
        event_type = newest.event_type or "string.updated"
        summary = newest.summary
    counts = _feed_counts(type_counts)
    undoable = bool(is_batch and kind_val in UNDOABLE_BATCH_KINDS and any_undoable)
    newest_before, newest_after = snaps.get(newest.id, (None, None))
    action = newest.action.value if hasattr(newest.action, "value") else newest.action
    changed = (
        []
        if is_batch
        else _to_changed_out(
            human_changed(newest_before, newest_after, action=str(action or "update")),
            module_names,
        )
    )
    children = []
    if is_batch:
        children = [
            _feed_child(
                row,
                before=snaps.get(row.id, (None, None))[0],
                after=snaps.get(row.id, (None, None))[1],
                module_names=module_names,
            )
            for row in rows[:FEED_CHILD_LIMIT]
        ]
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
        string_key=None if is_batch else snapshot_key(newest_before, newest_after),
        locale=None if is_batch else newest.locale,
        batch_id=newest.batch_id,
        batch_kind=kind_val,
        children_count=children_count,
        is_undoable=undoable,
        counts=counts,
        changed=changed,
        children=children,
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

    page_scope = or_(Activity.batch_id.in_(card_ids), Activity.id.in_(card_ids))
    type_rows = (
        db.query(
            card_expr.label("card_id"),
            Activity.event_type,
            func.count().label("n"),
        )
        .filter(Activity.project_id == project.id)
        .filter(page_scope)
        .group_by(card_expr, Activity.event_type)
        .all()
    )
    types_by_card: dict[uuid.UUID, dict[str, int]] = {}
    children_by_card: dict[uuid.UUID, int] = {}
    for card_id, event_type, n in type_rows:
        cid = _as_uuid(card_id)
        key = event_type or "string.updated"
        types_by_card.setdefault(cid, {})[key] = int(n or 0)
        children_by_card[cid] = children_by_card.get(cid, 0) + int(n or 0)

    undo_rows = (
        db.query(
            card_expr.label("card_id"),
            func.max(
                case(
                    (
                        and_(
                            Activity.is_revertible.is_(True),
                            Activity.reverted_by_id.is_(None),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("undoable"),
        )
        .filter(Activity.project_id == project.id)
        .filter(page_scope)
        .group_by(card_expr)
        .all()
    )
    undoable_by_card = {_as_uuid(card_id): bool(flag) for card_id, flag in undo_rows}

    ranked = (
        db.query(
            Activity.id.label("id"),
            func.row_number()
            .over(
                partition_by=card_expr,
                order_by=(Activity.created_at.desc(), Activity.id.desc()),
            )
            .label("rn"),
        )
        .filter(Activity.project_id == project.id)
        .filter(page_scope)
        .subquery()
    )
    preview_ids = [
        _as_uuid(row[0])
        for row in db.query(ranked.c.id).filter(ranked.c.rn <= FEED_CHILD_LIMIT).all()
    ]
    by_card: dict[uuid.UUID, list[Activity]] = {}
    if preview_ids:
        preview_rows = (
            db.query(Activity)
            .options(defer(Activity.before), defer(Activity.after))
            .filter(Activity.id.in_(preview_ids))
            .all()
        )
        for row in preview_rows:
            by_card.setdefault(row.batch_id or row.id, []).append(row)

    json_ids: list[uuid.UUID] = []
    for card_id in card_ids:
        rows = by_card.get(card_id)
        if not rows:
            continue
        ordered = _sort_feed_rows(rows)
        newest = ordered[0]
        if newest.batch_id is not None:
            json_ids.extend(item.id for item in ordered[:FEED_CHILD_LIMIT])
        else:
            json_ids.append(newest.id)

    snaps: dict[uuid.UUID, tuple[dict | None, dict | None]] = {}
    if json_ids:
        for aid, before, after in (
            db.query(Activity.id, Activity.before, Activity.after)
            .filter(Activity.id.in_(json_ids))
            .all()
        ):
            snaps[_as_uuid(aid)] = (before, after)

    names = module_name_map(db, project.id)
    items = []
    for card_id in card_ids:
        rows = by_card.get(card_id)
        if rows:
            items.append(
                _feed_card(
                    rows,
                    snaps,
                    type_counts=types_by_card.get(card_id, {}),
                    children_count=children_by_card.get(card_id, len(rows)),
                    any_undoable=undoable_by_card.get(card_id, False),
                    module_names=names,
                )
            )
    return ActivityFeedOut(items=items, total=total, page=page, page_size=page_size)


def restore_activity_version(
    db: Session,
    project: Project,
    string_id: uuid.UUID,
    activity_id: uuid.UUID,
) -> RestoreVersionOut:
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
    still_pending = bool(entry.pending_delete)
    if _working_copy_matches(entry, activity.after):
        raise HTTPException(
            status_code=400,
            detail=_history_restore_noop_detail(still_pending),
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
    out = serialize_activity(latest or activity, module_name_map(db, project.id))
    return RestoreVersionOut(
        **out.model_dump(),
        notice=_history_restore_notice(still_pending),
        pending_delete=still_pending,
    )


def _activity_link(db: Session, activity_id: uuid.UUID | None) -> ActivityLinkOut | None:
    if not activity_id:
        return None
    other = db.query(Activity).filter(Activity.id == activity_id).first()
    if not other:
        return None
    return ActivityLinkOut(id=other.id, summary=other.summary, created_at=other.created_at)


def get_activity_detail(
    db: Session, project: Project, activity_id: uuid.UUID
) -> ActivityDetailOut:
    activity = (
        db.query(Activity)
        .filter(Activity.id == activity_id, Activity.project_id == project.id)
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    names = module_name_map(db, project.id)
    base = serialize_activity(activity, names)
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    restorable = bool(activity.after) and is_history_restorable(
        activity.event_type, str(action or "update")
    )
    if not activity.after:
        blocked_reason: str | None = "This version cannot be restored"
    elif not restorable:
        blocked_reason = _history_restore_reject_detail(activity.event_type)
    else:
        blocked_reason = None

    snap = activity.after or activity.before or {}
    module_id = snap.get("module_id")
    module_name = names.get(module_id) if module_id else None

    return ActivityDetailOut(
        **base.model_dump(),
        string_key=snapshot_key(activity.before, activity.after),
        module_name=module_name,
        is_history_restorable=restorable,
        restore_blocked_reason=blocked_reason,
        revert_of=_activity_link(db, activity.revert_of_id),
        reverted_by=_activity_link(db, activity.reverted_by_id),
    )


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


def _history_restore_notice(pending_delete: bool) -> str:
    if pending_delete:
        return (
            "Restored this version's text. Publish status is unchanged. "
            "This string is still marked for deletion — use Restore on the grid to cancel the removal."
        )
    return "Restored this version's text. Publish status is unchanged."


def _history_restore_noop_detail(pending_delete: bool) -> str:
    if pending_delete:
        return (
            "Text already matches this version. "
            "This string is still marked for deletion — use Restore on the grid to cancel the removal."
        )
    return "Working copy already matches this version. Publish status is unchanged."


def _working_copy_matches(entry: StringEntry, snap: dict[str, Any]) -> bool:
    if snap.get("key", entry.key) != entry.key:
        return False
    if snap.get("source_text", entry.source_text) != entry.source_text:
        return False
    if "description" in snap and snap.get("description") != entry.description:
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
        candidates = (
            db.query(Activity)
            .filter(
                Activity.project_id == project.id,
                Activity.string_id == entry.id,
                Activity.before.isnot(None),
            )
            .order_by(Activity.created_at.desc(), Activity.id.desc())
            .all()
        )
        latest = None
        for activity in candidates:
            action = (
                activity.action.value
                if hasattr(activity.action, "value")
                else activity.action
            )
            if is_history_restorable(activity.event_type, action):
                latest = activity
                break
        if not latest or not latest.before:
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


def _live_snapshot(entry: StringEntry) -> dict[str, Any]:
    """Read-only snapshot of a live StringEntry, shaped like an activity's before/after
    dict, so it can be diffed with human_changed() for preview purposes."""
    status = entry.status.value if hasattr(entry.status, "value") else entry.status
    return {
        "id": str(entry.id),
        "key": entry.key,
        "source_text": entry.source_text,
        "description": entry.description,
        "status": status,
        "module_id": str(entry.module_id) if entry.module_id else None,
        "published_key": entry.published_key,
        "published_module_id": (
            str(entry.published_module_id) if entry.published_module_id else None
        ),
        "published_source_text": entry.published_source_text,
        "published_at": entry.published_at.isoformat() if entry.published_at else None,
        "pending_delete": bool(entry.pending_delete),
        "deleted_at": entry.deleted_at.isoformat() if entry.deleted_at else None,
        "tag_ids": [str(t.id) for t in (entry.tags or [])],
        "tag_names": [t.name for t in (entry.tags or [])],
        "translations": {t.locale: t.value or "" for t in (entry.translations or [])},
        "published_translations": {
            t.locale: t.published_value for t in (entry.translations or [])
        },
    }


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
            existing.confidence = None


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
        if entry.deleted_at is not None:
            return False
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
                    existing.confidence = None
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
            from app.services.strings import queue_or_soft_delete

            entry = (
                db.query(StringEntry)
                .filter(StringEntry.id == uuid.UUID(activity.entity_id))
                .first()
            )
            if entry:
                queue_or_soft_delete(entry)
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


def _revert_preview_item(
    db: Session, activity: Activity, module_names: dict[str, str]
) -> RevertPreviewItemOut:
    before = activity.before or {}
    after = activity.after or {}
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    etype = (
        activity.entity_type.value
        if hasattr(activity.entity_type, "value")
        else activity.entity_type
    )
    string_key = snapshot_key(activity.before, activity.after)

    if activity.reverted_by_id:
        return RevertPreviewItemOut(
            activity_id=activity.id,
            string_id=activity.string_id,
            string_key=string_key,
            outcome="already_reverted",
            conflict=False,
            affects_published=False,
            changes=[],
        )

    conflict = not current_matches_after(db, activity)
    changes: list[ActivityChangeOut] = []
    affects_published = False

    if etype == "string":
        if action == "create":
            outcome: Literal[
                "restore_values", "move_to_deleted", "recreate", "already_reverted", "missing"
            ] = "move_to_deleted"
        elif action == "delete":
            existing = (
                db.query(StringEntry).filter(StringEntry.id == uuid.UUID(before["id"])).first()
                if before.get("id")
                else None
            )
            outcome = "restore_values" if existing else "recreate"
        else:
            outcome = "restore_values"

        if outcome in ("restore_values", "recreate"):
            affects_published = published_fields_changed(before, after)
            current_entry = None
            if activity.string_id:
                current_entry = (
                    db.query(StringEntry)
                    .options(
                        joinedload(StringEntry.translations), joinedload(StringEntry.tags)
                    )
                    .filter(StringEntry.id == activity.string_id)
                    .first()
                )
            current_snap = _live_snapshot(current_entry) if current_entry else None
            rows = human_changed(current_snap, before, action="update")
            changes = _to_changed_out(rows, module_names)
    else:
        outcome = "restore_values" if action != "create" else "move_to_deleted"

    return RevertPreviewItemOut(
        activity_id=activity.id,
        string_id=activity.string_id,
        string_key=string_key,
        outcome=outcome,
        conflict=conflict,
        affects_published=affects_published,
        changes=changes,
    )


def build_revert_preview(
    db: Session, project: Project, activities: list[Activity]
) -> RevertPreviewOut:
    names = module_name_map(db, project.id)
    items = [_revert_preview_item(db, activity, names) for activity in activities]
    conflict_count = sum(1 for item in items if item.conflict)
    affects_published = any(item.affects_published for item in items)
    return RevertPreviewOut(
        items=items,
        total=len(items),
        conflict_count=conflict_count,
        requires_force=conflict_count > 0,
        affects_published=affects_published,
    )


def preview_revert_batch(db: Session, project: Project, batch_id: uuid.UUID) -> RevertPreviewOut:
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
    return build_revert_preview(db, project, activities)


def preview_revert_activity(
    db: Session, project: Project, activity_id: uuid.UUID
) -> RevertPreviewOut:
    activity = (
        db.query(Activity)
        .filter(Activity.id == activity_id, Activity.project_id == project.id)
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not activity.is_revertible:
        raise HTTPException(status_code=400, detail="Activity is not revertible")
    return build_revert_preview(db, project, [activity])


def preview_restore_activity_version(
    db: Session,
    project: Project,
    string_id: uuid.UUID,
    activity_id: uuid.UUID,
) -> RestorePreviewOut:
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
        return RestorePreviewOut(
            string_id=string_id,
            activity_id=activity_id,
            can_restore=False,
            blocked_reason="This version cannot be restored",
        )
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    if not is_history_restorable(activity.event_type, action):
        return RestorePreviewOut(
            string_id=string_id,
            activity_id=activity_id,
            can_restore=False,
            blocked_reason=_history_restore_reject_detail(activity.event_type),
        )

    entry = get_string(db, project.id, string_id)
    if entry.deleted_at is not None:
        return RestorePreviewOut(
            string_id=string_id,
            activity_id=activity_id,
            can_restore=False,
            blocked_reason="Restore the string from Deleted before restoring a version",
        )

    still_pending = bool(entry.pending_delete)
    if _working_copy_matches(entry, activity.after):
        return RestorePreviewOut(
            string_id=string_id,
            activity_id=activity_id,
            can_restore=False,
            already_matches=True,
            pending_delete=still_pending,
            blocked_reason=_history_restore_noop_detail(still_pending),
        )

    names = module_name_map(db, project.id)
    current_snap = _live_snapshot(entry)
    rows = human_changed(current_snap, activity.after, action="update")
    changes = _to_changed_out(rows, names)
    return RestorePreviewOut(
        string_id=string_id,
        activity_id=activity_id,
        can_restore=True,
        pending_delete=still_pending,
        notice=_history_restore_notice(still_pending),
        changes=changes,
    )


def prune_activities(db: Session, *, days: int, now: datetime | None = None) -> int:
    """Delete activity rows older than `days`. 0 or less keeps everything."""
    if days <= 0:
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    deleted = (
        db.query(Activity)
        .filter(Activity.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)
