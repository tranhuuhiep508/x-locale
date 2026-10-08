"""Activity serialization and revert."""

from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import String, and_, case, cast, func, or_
from sqlalchemy.orm import Session, defer, selectinload

from app.helpers import require_locale_code, require_max_length, require_string_key
from app.limits import KEY_MAX_LENGTH
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
    ActivityFeedOut,
    ActivityLinkOut,
    ActivityListItemOut,
    ActivityListOut,
    ActivityOut,
    RestorePreviewOut,
    RestoreVersionOut,
    RevertPreviewConflictOut,
    RevertPreviewItemOut,
    RevertPreviewOut,
    RevertPreviewOutcomeCountsOut,
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
    snapshot_key,
)
from app.services.activity_state import (
    InvalidSnapshot,
    SnapshotReferences,
    check_key_available,
    key_conflict_message,
    normalized_time,
    project_snapshot,
    restore_transaction,
    snapshots_match,
    translation_map,
    validate_undo_timestamps,
)
from app.services.catalog import require_module_in_project

FEED_CHILD_LIMIT = 50
LIST_CHANGE_LIMIT = 5
PREVIEW_ITEM_LIMIT = 20
PREVIEW_CONFLICT_LIMIT = 10
PREVIEW_CHANGE_LIMIT = 2
_LOCALE_RE = re.compile(r"^[\w-]+$")


def module_name_map(db: Session, project_id: uuid.UUID) -> dict[str, str]:
    """id-string -> module name, for resolving module_id change rows to friendly labels."""
    rows = db.query(Module.id, Module.name).filter(Module.project_id == project_id).all()
    return {str(mid): name for mid, name in rows}


def _to_changed_out(
    rows: list[ChangedField],
    module_names: dict[str, str] | None = None,
    *,
    limit: int | None = None,
) -> list[ActivityChangeOut]:
    names = module_names or {}
    out: list[ActivityChangeOut] = []
    for row in rows[:limit] if limit is not None else rows:
        before, after = row.before, row.after
        if row.field in ("module_id", "published_module_id"):
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


def _changed_rows(
    before: dict | None,
    after: dict | None,
    *,
    action: str,
    module_names: dict[str, str] | None = None,
    include_published: bool = True,
    limit: int | None = None,
) -> tuple[list[ActivityChangeOut], int]:
    rows = human_changed(
        before,
        after,
        action=action,
        include_published=include_published,
    )
    full = _to_changed_out(rows, module_names)
    total = len(full)
    if limit is not None:
        return full[:limit], total
    return full, total


def _changed_out(
    activity: Activity,
    module_names: dict[str, str] | None = None,
    *,
    include_published: bool = True,
    limit: int | None = None,
) -> list[ActivityChangeOut]:
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    changed, _ = _changed_rows(
        activity.before,
        activity.after,
        action=str(action or "update"),
        module_names=module_names,
        include_published=include_published,
        limit=limit,
    )
    return changed


def _history_restore_flags(activity: Activity) -> tuple[bool, str | None]:
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    if not activity.after:
        return False, "This version cannot be restored"
    if not is_history_restorable(activity.event_type, str(action or "update")):
        return False, _history_restore_reject_detail(activity.event_type)
    return True, None


def _activity_core_fields(activity: Activity) -> dict[str, Any]:
    return {
        "id": activity.id,
        "actor_type": activity.actor_type.value
        if hasattr(activity.actor_type, "value")
        else activity.actor_type,
        "actor_id": activity.actor_id,
        "actor_label": activity.actor_label,
        "action": activity.action.value if hasattr(activity.action, "value") else activity.action,
        "entity_type": activity.entity_type.value
        if hasattr(activity.entity_type, "value")
        else activity.entity_type,
        "entity_id": activity.entity_id,
        "string_id": activity.string_id,
        "locale": activity.locale,
        "event_type": activity.event_type or "string.updated",
        "summary": activity.summary,
        "batch_id": activity.batch_id,
        "batch_kind": activity.batch_kind.value
        if activity.batch_kind and hasattr(activity.batch_kind, "value")
        else (activity.batch_kind),
        "revert_of_id": activity.revert_of_id,
        "reverted_by_id": activity.reverted_by_id,
        "is_revertible": activity.is_revertible,
        "created_at": activity.created_at,
    }


def serialize_list_item(
    activity: Activity, module_names: dict[str, str] | None = None
) -> ActivityListItemOut:
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    changed, changed_count = _changed_rows(
        activity.before,
        activity.after,
        action=str(action or "update"),
        module_names=module_names,
        include_published=False,
        limit=LIST_CHANGE_LIMIT,
    )
    restorable, blocked = _history_restore_flags(activity)
    return ActivityListItemOut(
        **_activity_core_fields(activity),
        string_key=snapshot_key(activity.before, activity.after),
        changed=changed,
        changed_count=changed_count,
        is_history_restorable=restorable,
        restore_blocked_reason=blocked,
    )


def serialize_activity(
    activity: Activity, module_names: dict[str, str] | None = None
) -> ActivityOut:
    return ActivityOut(
        **_activity_core_fields(activity),
        before=activity.before,
        after=activity.after,
        changed=_changed_out(activity, module_names, include_published=True),
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
    items = q.order_by(*_inverse_order()).offset((page - 1) * page_size).limit(page_size).all()
    names = module_name_map(db, project.id)
    return ActivityListOut(
        items=[serialize_list_item(a, names) for a in items],
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


def _feed_tie_expr():
    # PostgreSQL has no max(uuid); compare the canonical UUID strings instead.
    return func.max(cast(Activity.id, String(36)))


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
            q = q.filter(Activity.batch_kind.in_([BatchKind.import_, BatchKind.excel_import]))
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


def _inverse_order():
    """SQL counterpart of the UTC/ID order used by feed and inverse previews."""
    return Activity.created_at.desc(), Activity.id.desc()


def _sort_feed_rows(rows: list[Activity]) -> list[Activity]:
    return sorted(
        rows,
        key=lambda item: (
            normalized_time(item.created_at).timestamp() if item.created_at else 0.0,
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
    changed: list[ActivityChangeOut] = []
    changed_count = 0
    if not is_batch:
        changed, changed_count = _changed_rows(
            newest_before,
            newest_after,
            action=str(action or "update"),
            module_names=module_names,
            include_published=False,
            limit=LIST_CHANGE_LIMIT,
        )
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
        changed_count=changed_count,
        children=[],
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
        _feed_tie_expr().label("tie"),
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
    preview_ids = [_as_uuid(row[0]) for row in db.query(ranked.c.id).filter(ranked.c.rn == 1).all()]
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
        if newest.batch_id is None:
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
        raise HTTPException(
            status_code=400, detail=_history_restore_reject_detail(activity.event_type)
        )
    entry = get_string(db, project.id, string_id)
    if entry.deleted_at is not None:
        raise HTTPException(
            status_code=400,
            detail="Restore the string from Deleted before restoring a version",
        )
    still_pending = bool(entry.pending_delete)
    references = SnapshotReferences(db, project.id, [activity.after, _live_snapshot(entry)])
    target = _history_target(db, entry, activity.after, references=references)
    if _working_copy_matches(entry, target):
        raise HTTPException(
            status_code=400,
            detail=_history_restore_noop_detail(still_pending),
        )
    with restore_transaction(db):
        check_key_available(db, project.id, entry.id, target)
        set_restore_intent(db)
        _apply_working_copy_only(db, entry, target, references=references)
        db.commit()
    db.expire_all()
    latest = (
        db.query(Activity)
        .filter(Activity.project_id == project.id, Activity.string_id == string_id)
        .order_by(*_inverse_order())
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


def get_activity_detail(db: Session, project: Project, activity_id: uuid.UUID) -> ActivityDetailOut:
    activity = (
        db.query(Activity)
        .filter(Activity.id == activity_id, Activity.project_id == project.id)
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    names = module_name_map(db, project.id)
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    changed, _ = _changed_rows(
        activity.before,
        activity.after,
        action=str(action or "update"),
        module_names=names,
        include_published=True,
    )
    restorable, blocked_reason = _history_restore_flags(activity)

    snap = activity.after or activity.before or {}
    module_id = snap.get("module_id")
    module_name = names.get(module_id) if module_id else None

    return ActivityDetailOut(
        **_activity_core_fields(activity),
        changed=changed,
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
            "Restored this version's working-copy content. Publish status is unchanged. "
            "Published content stays unchanged. "
            "This string is still marked for deletion — use Restore on the grid to cancel the removal."
        )
    return (
        "Restored this version's working-copy content. Publish status is unchanged. "
        "Published content stays unchanged; publish to apply this version."
    )


def _history_restore_noop_detail(pending_delete: bool) -> str:
    if pending_delete:
        return (
            "Text already matches this version. "
            "This string is still marked for deletion — use Restore on the grid to cancel the removal."
        )
    return "Working copy already matches this version. Publish status is unchanged."


def _history_target(
    db: Session,
    entry: StringEntry,
    snap: dict[str, Any],
    *,
    references: SnapshotReferences | None = None,
) -> dict:
    return project_snapshot(
        db, entry.project_id, _live_snapshot(entry), snap, references=references
    )


def _working_copy_matches(entry: StringEntry, target: dict[str, Any]) -> bool:
    return snapshots_match(_live_snapshot(entry), target)


def restore_last_history(db: Session, project: Project, entries: list[StringEntry]) -> int:
    from app.activity import set_restore_intent

    affected = 0
    active = [entry for entry in entries if entry.deleted_at is None]
    latest_by_string = {}
    ids = [entry.id for entry in active]
    for offset in range(0, len(ids), 400):
        candidates = (
            db.query(Activity)
            .filter(
                Activity.project_id == project.id,
                Activity.string_id.in_(ids[offset : offset + 400]),
                Activity.before.isnot(None),
            )
            .order_by(*_inverse_order())
            .all()
        )
        for candidate in candidates:
            if candidate.string_id not in latest_by_string and is_history_restorable(
                candidate.event_type, candidate.action
            ):
                latest_by_string[candidate.string_id] = candidate
    references = SnapshotReferences(
        db,
        project.id,
        [
            *[_live_snapshot(entry) for entry in active],
            *[a.before for a in latest_by_string.values()],
        ],
    )
    with restore_transaction(db):
        set_restore_intent(db)
        for entry in active:
            latest = latest_by_string.get(entry.id)
            if not latest or not latest.before:
                continue
            target = _history_target(db, entry, latest.before, references=references)
            if _working_copy_matches(entry, target):
                continue
            check_key_available(db, project.id, entry.id, target)
            _apply_working_copy_only(db, entry, target, references=references)
            db.flush()
            affected += 1
    return affected


def _live_snapshot(entry: StringEntry) -> dict[str, Any]:
    """Read-only snapshot of a live StringEntry, shaped like an activity's before/after
    dict, so it can be diffed with human_changed() for preview purposes."""
    status = entry.status.value if hasattr(entry.status, "value") else entry.status
    tags = sorted(entry.tags or [], key=lambda tag: str(tag.id))
    return {
        "id": str(entry.id),
        "project_id": str(entry.project_id),
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
        "published_at": normalized_time(entry.published_at).isoformat()
        if entry.published_at
        else None,
        "pending_delete": bool(entry.pending_delete),
        "deleted_at": normalized_time(entry.deleted_at).isoformat() if entry.deleted_at else None,
        "tag_ids": [str(t.id) for t in tags],
        "tag_names": [t.name for t in tags],
        "translations": {t.locale: t.value or "" for t in (entry.translations or [])},
        "published_translations": {t.locale: t.published_value for t in (entry.translations or [])},
    }


def _set_entry_tags(
    db: Session,
    entry: StringEntry,
    tag_ids: list[str] | None,
    *,
    references: SnapshotReferences | None = None,
) -> None:
    if tag_ids is None:
        return
    ids = [uuid.UUID(tid) for tid in tag_ids]
    tags = (
        references.tag_rows(tag_ids)
        if references is not None
        else (
            db.query(Tag).filter(Tag.project_id == entry.project_id, Tag.id.in_(ids)).all()
            if ids
            else []
        )
    )
    entry.tags = tags


def _set_entry_translations(db: Session, entry: StringEntry, translations: dict[str, str]) -> None:
    by_locale = {t.locale: t for t in list(entry.translations or [])}
    for locale, value in translations.items():
        locale = require_locale_code(locale)
        existing = by_locale.get(locale)
        if existing is None:
            translation = Translation(string_id=entry.id, locale=locale, value=value)
            db.add(translation)
            entry.translations.append(translation)
        else:
            if existing.value != value:
                existing.confidence = None
            existing.value = value


def _set_entry_published_translations(
    db: Session, entry: StringEntry, translations: dict[str, str | None]
) -> None:
    by_locale = {t.locale: t for t in entry.translations}
    for locale, value in translations.items():
        locale = require_locale_code(locale)
        existing = by_locale.get(locale)
        if existing is None:
            translation = Translation(
                string_id=entry.id, locale=locale, value="", published_value=value
            )
            db.add(translation)
            entry.translations.append(translation)
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


def _owned_module_id(db: Session, project_id: uuid.UUID, raw: Any) -> uuid.UUID | None:
    """Keep a module ref only when it belongs to this project.

    History restore already clears foreign modules while building the target.
    Checking again at the write keeps a deferred cross-project FK from waiting
    until commit and returning 500.
    """
    if not raw:
        return None
    try:
        module_id = uuid.UUID(str(raw))
    except ValueError, TypeError:
        return None
    return require_module_in_project(db, project_id, module_id, on_missing="clear")


def _apply_published_snapshot(db: Session, entry: StringEntry, snap: dict[str, Any]) -> None:
    if "published_key" in snap:
        entry.published_key = require_max_length(
            snap.get("published_key"), field="published_key", limit=KEY_MAX_LENGTH
        )
    if "published_source_text" in snap:
        entry.published_source_text = snap.get("published_source_text")
    if "pending_delete" in snap:
        entry.pending_delete = bool(snap.get("pending_delete"))
    if "deleted_at" in snap:
        entry.deleted_at = _parse_datetime(snap.get("deleted_at"))
    if "published_at" in snap:
        entry.published_at = _parse_datetime(snap.get("published_at"))
    if "published_module_id" in snap:
        entry.published_module_id = _owned_module_id(db, entry.project_id, snap.get("published_module_id"))
    if "published_translations" in snap:
        _set_entry_published_translations(
            db, entry, translation_map(snap.get("published_translations"), published=True)
        )


def _string_ids_for_activities(activities: list[Activity]) -> set[uuid.UUID]:
    ids: set[uuid.UUID] = set()
    for activity in activities:
        if activity.string_id:
            ids.add(activity.string_id)
        elif activity.entity_type == EntityType.string or activity.entity_type == "string":
            try:
                ids.add(uuid.UUID(activity.entity_id))
            except ValueError, TypeError:
                continue
    return ids


def _load_string_entries(db: Session, string_ids: set[uuid.UUID]) -> dict[uuid.UUID, StringEntry]:
    if not string_ids:
        return {}
    rows = (
        db.query(StringEntry)
        .options(selectinload(StringEntry.translations), selectinload(StringEntry.tags))
        .filter(StringEntry.id.in_(string_ids))
        .all()
    )
    return {row.id: row for row in rows}


def current_matches_after(
    db: Session,
    activity: Activity,
    *,
    entry: StringEntry | None = None,
) -> bool:
    """Conflict guard: current row must still match activity.after."""
    after = activity.after
    if activity.entity_type == EntityType.string or activity.entity_type == "string":
        if entry is None:
            entry = (
                db.query(StringEntry)
                .options(selectinload(StringEntry.translations), selectinload(StringEntry.tags))
                .filter(StringEntry.id == uuid.UUID(activity.entity_id))
                .first()
            )
        return snapshots_match(_live_snapshot(entry) if entry else None, after)

    after = after or {}

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
    before: dict | None,
    after: dict | None,
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
        before=before,
        after=after,
        event_type="string.restored",
        summary=_revert_summary(activity),
        batch_id=batch_id,
        batch_kind="revert",
        revert_of_id=activity.id,
        is_revertible=True,
    )


def _apply_working_copy_only(
    db: Session,
    entry: StringEntry,
    target: dict[str, Any],
    *,
    include_status: bool = False,
    references: SnapshotReferences | None = None,
) -> None:
    """Apply an already resolved target; validation belongs to the caller."""
    db.info["restore_key"] = target["key"]
    entry.key = require_string_key(target["key"])
    entry.source_text = target["source_text"]
    entry.description = target["description"]
    if include_status:
        entry.status = TranslationStatus(target["status"])
    entry.module_id = _owned_module_id(db, entry.project_id, target.get("module_id"))
    _set_entry_tags(db, entry, target.get("tag_ids") or [], references=references)
    _set_entry_translations(db, entry, target.get("translations") or {})


def _apply_working_snapshot(
    db: Session,
    entry: StringEntry,
    target: dict[str, Any],
    *,
    references: SnapshotReferences,
) -> None:
    _apply_working_copy_only(db, entry, target, include_status=True, references=references)
    _apply_published_snapshot(db, entry, target)


def apply_revert(
    db: Session,
    activity: Activity,
    *,
    entry: StringEntry | None = None,
    target: dict | None = None,
    references: SnapshotReferences | None = None,
) -> None:
    before = activity.before or {}
    action = activity.action.value if hasattr(activity.action, "value") else activity.action
    etype = (
        activity.entity_type.value
        if hasattr(activity.entity_type, "value")
        else activity.entity_type
    )

    if etype == "string":
        if references is None:
            references = SnapshotReferences(
                db, activity.project_id, [activity.before, activity.after]
            )
        if target is None:
            validate_undo_timestamps(activity.id, activity.before, activity.after)
            entry = _load_activity_entry(db, activity)
            current = _live_snapshot(entry) if entry else None
            target = _revert_target(db, activity, current, references=references)
            if target is not None:
                check_key_available(db, activity.project_id, uuid.UUID(activity.entity_id), target)
        if target is None:
            raise HTTPException(status_code=404, detail="String no longer exists")
        string_id = uuid.UUID(activity.entity_id)
        db.info["restore_key"] = target["key"]
        if entry is None:
            entry = StringEntry(
                id=string_id,
                project_id=activity.project_id,
                key=target["key"],
                source_text=target["source_text"],
                status=TranslationStatus.draft,
                pending_delete=False,
            )
            db.add(entry)
        _apply_working_snapshot(db, entry, target, references=references)

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

    from app.activity import attach_batch

    batch_id = uuid.uuid4()
    with restore_transaction(db):
        existing = attach_batch(db, batch_id, "revert")
        references = SnapshotReferences(db, project.id, [activity.before, activity.after])
        before, after = _execute_inverse(db, activity, force=force, references=references)
        revert_marker = _make_revert_marker(
            db,
            project_id=project.id,
            activity=activity,
            existing=existing,
            batch_id=batch_id,
            before=before,
            after=after,
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
        .order_by(*_inverse_order())
        .all()
    )
    if not activities:
        raise HTTPException(status_code=404, detail="No revertible activities in batch")

    from app.activity import attach_batch

    new_batch = uuid.uuid4()
    reverted = 0
    with restore_transaction(db):
        existing = attach_batch(db, new_batch, "revert")
        references = SnapshotReferences(
            db, project.id, [snapshot for a in activities for snapshot in (a.before, a.after)]
        )
        for activity in activities:
            before, after = _execute_inverse(db, activity, force=force, references=references)
            marker = _make_revert_marker(
                db,
                project_id=project.id,
                activity=activity,
                existing=existing,
                batch_id=new_batch,
                before=before,
                after=after,
            )
            db.add(marker)
            db.flush()
            activity.reverted_by_id = marker.id
            reverted += 1
        db.commit()
    return {"reverted": reverted, "batch_id": str(new_batch)}


def _load_activity_entry(db: Session, activity: Activity) -> StringEntry | None:
    return (
        db.query(StringEntry)
        .options(selectinload(StringEntry.translations), selectinload(StringEntry.tags))
        .populate_existing()
        .filter(StringEntry.id == uuid.UUID(activity.entity_id))
        .first()
    )


def _execute_inverse(
    db: Session,
    activity: Activity,
    *,
    force: bool,
    references: SnapshotReferences,
) -> tuple[dict | None, dict | None]:
    validate_undo_timestamps(activity.id, activity.before, activity.after)
    if activity.entity_type == EntityType.string:
        entry = _load_activity_entry(db, activity)
        before = _live_snapshot(entry) if entry else None
        target = _revert_target(db, activity, before, references=references)
        if target is None:
            raise HTTPException(status_code=404, detail="String no longer exists")
        check_key_available(db, activity.project_id, uuid.UUID(activity.entity_id), target)
        matches = snapshots_match(before, activity.after) if not force else True
    else:
        entry, target = None, None
        before = _activity_snapshot(db, activity)
        matches = current_matches_after(db, activity) if not force else True
    if not matches:
        raise HTTPException(
            status_code=409,
            detail=f"Conflict on activity {activity.id}. Pass force=true to override.",
        )
    apply_revert(db, activity, entry=entry, target=target, references=references)
    db.flush()
    return before, _activity_snapshot(db, activity)


def _activity_snapshot(db: Session, activity: Activity) -> dict | None:
    if activity.entity_type == EntityType.string:
        entry = _load_activity_entry(db, activity)
        return _live_snapshot(entry) if entry else None
    translation = db.get(Translation, uuid.UUID(activity.entity_id))
    if not translation:
        return None
    return {
        "id": str(translation.id),
        "string_id": str(translation.string_id),
        "locale": translation.locale,
        "value": translation.value,
    }


def _revert_target(
    db: Session,
    activity: Activity,
    current: dict | None,
    *,
    references: SnapshotReferences | None = None,
) -> dict | None:
    """Read-only destination of one string inverse operation."""
    if activity.action == ActivityAction.create:
        if current is None:
            return None
        target = dict(current)
        if current.get("published_key") is not None:
            target["pending_delete"] = True
        else:
            target["deleted_at"] = datetime.now(UTC).isoformat()
            target["pending_delete"] = False
        return target
    if current is None:
        if activity.action != ActivityAction.delete:
            return None
        current = {
            "id": activity.entity_id,
            "project_id": str(activity.project_id),
            "key": "",
            "source_text": "",
            "description": None,
            "status": "draft",
            "module_id": None,
            "published_module_id": None,
            "published_key": None,
            "published_source_text": None,
            "published_at": None,
            "pending_delete": False,
            "deleted_at": None,
            "tag_ids": [],
            "tag_names": [],
            "translations": {},
            "published_translations": {},
        }
    return project_snapshot(
        db,
        activity.project_id,
        current,
        activity.before or {},
        full_state=True,
        references=references,
    )


def _revert_preview_item(
    db: Session,
    activity: Activity,
    module_names: dict[str, str],
    states: dict[uuid.UUID, dict | None],
    owners: dict[str, uuid.UUID],
    references: SnapshotReferences,
) -> RevertPreviewItemOut:
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
            change_count=0,
            changes=[],
        )

    try:
        validate_undo_timestamps(activity.id, activity.before, activity.after)
    except InvalidSnapshot as error:
        return RevertPreviewItemOut(
            activity_id=activity.id,
            string_id=activity.string_id,
            string_key=string_key,
            outcome="restore_values",
            blocked_reason=error.detail["message"],
        )

    current_snap = states.get(uuid.UUID(activity.entity_id)) if etype == "string" else None
    conflict = (
        not snapshots_match(current_snap, activity.after)
        if etype == "string"
        else not current_matches_after(db, activity)
    )
    changes: list[ActivityChangeOut] = []
    blocked_reason = None
    affects_published = False
    outcome: Literal[
        "restore_values", "move_to_deleted", "recreate", "already_reverted", "missing"
    ] = "restore_values"
    if etype == "string":
        target = _revert_target(db, activity, current_snap, references=references)
        if target is None:
            outcome = "missing"
            blocked_reason = "String no longer exists"
        else:
            if action == "create":
                outcome = "move_to_deleted"
            elif action == "delete" and current_snap is None:
                outcome = "recreate"
            sid = uuid.UUID(activity.entity_id)
            owner = owners.get(target["key"])
            if not target.get("deleted_at") and owner is not None and owner != sid:
                blocked_reason = key_conflict_message(target["key"])
            published_target = {
                name: value for name, value in target.items() if name.startswith("published_")
            }
            affects_published = not snapshots_match(current_snap or {}, published_target) or (
                (current_snap or {}).get("status") == "public"
            ) != (target.get("status") == "public")
            # A tombstone also changes public visibility; a queued deletion doesn't.
            if (current_snap or {}).get("status") == "public" and bool(
                (current_snap or {}).get("deleted_at")
            ) != bool(target.get("deleted_at")):
                affects_published = True
            changes = _to_changed_out(
                human_changed(current_snap, target, action="update"), module_names
            )
            if blocked_reason is None:
                if (
                    current_snap
                    and not current_snap.get("deleted_at")
                    and owners.get(current_snap["key"]) == sid
                ):
                    owners.pop(current_snap["key"], None)
                if not target.get("deleted_at"):
                    owners[target["key"]] = sid
                states[sid] = target
    elif action == "create":
        outcome = "move_to_deleted"
    return RevertPreviewItemOut(
        activity_id=activity.id,
        string_id=activity.string_id,
        string_key=string_key,
        outcome=outcome,
        conflict=conflict,
        affects_published=affects_published,
        change_count=len(changes),
        changes=changes[:PREVIEW_CHANGE_LIMIT],
        blocked_reason=blocked_reason,
    )


def _outcome_counts(items: list[RevertPreviewItemOut]) -> RevertPreviewOutcomeCountsOut:
    tallies = Counter(item.outcome for item in items)
    return RevertPreviewOutcomeCountsOut(
        restore_values=tallies["restore_values"],
        move_to_deleted=tallies["move_to_deleted"],
        recreate=tallies["recreate"],
        already_reverted=tallies["already_reverted"],
        missing=tallies["missing"],
    )


def build_revert_preview(
    db: Session, project: Project, activities: list[Activity]
) -> RevertPreviewOut:
    names = module_name_map(db, project.id)
    entries = _load_string_entries(db, _string_ids_for_activities(activities))
    states = {sid: _live_snapshot(entry) for sid, entry in entries.items()}
    owners = dict(
        db.query(StringEntry.key, StringEntry.id)
        .filter(
            StringEntry.project_id == project.id,
            StringEntry.deleted_at.is_(None),
        )
        .all()
    )
    references = SnapshotReferences(
        db,
        project.id,
        [*states.values(), *[snapshot for a in activities for snapshot in (a.before, a.after)]],
    )
    all_items = [
        _revert_preview_item(db, activity, names, states, owners, references)
        for activity in _sort_feed_rows(activities)
    ]
    blocked_reason = next((item.blocked_reason for item in all_items if item.blocked_reason), None)
    conflict_count = sum(1 for item in all_items if item.conflict)
    affects_published = any(item.affects_published for item in all_items)
    conflicted = [item for item in all_items if item.conflict]
    conflicts = [
        RevertPreviewConflictOut(activity_id=item.activity_id, string_key=item.string_key)
        for item in conflicted[:PREVIEW_CONFLICT_LIMIT]
    ]
    return RevertPreviewOut(
        items=all_items[:PREVIEW_ITEM_LIMIT],
        can_revert=blocked_reason is None,
        blocked_reason=blocked_reason,
        conflicts=conflicts,
        total=len(all_items),
        conflict_count=conflict_count,
        requires_force=conflict_count > 0,
        affects_published=affects_published,
        outcome_counts=_outcome_counts(all_items),
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
        .order_by(*_inverse_order())
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
    references = SnapshotReferences(db, project.id, [activity.after, _live_snapshot(entry)])
    target = _history_target(db, entry, activity.after, references=references)
    if _working_copy_matches(entry, target):
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
    try:
        check_key_available(db, project.id, entry.id, target)
    except HTTPException as error:
        return RestorePreviewOut(
            string_id=string_id,
            activity_id=activity_id,
            can_restore=False,
            blocked_reason=error.detail["message"],
            pending_delete=still_pending,
        )
    rows = human_changed(current_snap, target, action="update", include_published=False)
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
        db.query(Activity).filter(Activity.created_at < cutoff).delete(synchronize_session=False)
    )
    return int(deleted or 0)
