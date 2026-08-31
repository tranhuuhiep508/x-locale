"""Activity log capture via SQLAlchemy before_flush."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.models import (
    Activity,
    ActivityAction,
    ActorType,
    BatchKind,
    EntityType,
    StringEntry,
    StringTag,
    Tag,
    Translation,
    TranslationStatus,
)

STRING_FIELDS = (
    "key",
    "source_text",
    "description",
    "module_id",
    "status",
    "published_key",
    "published_module_id",
    "published_source_text",
    "published_at",
    "pending_delete",
    "deleted_at",
)


def attach_batch(session: Session, batch_id: uuid.UUID, batch_kind: str) -> dict[str, Any]:
    """Stamp the current actor context with batch metadata. Returns the prior info dict."""
    existing = session.info.get("activity") or {}
    session.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": batch_kind,
    }
    return existing


def _jsonify(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, TranslationStatus):
        return val.value
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _ensure_string_identity(obj: StringEntry) -> None:
    if obj.id is None:
        obj.id = uuid.uuid4()
    if obj.status is None:
        obj.status = TranslationStatus.draft
    if obj.pending_delete is None:
        obj.pending_delete = False


def _status_value(obj: StringEntry) -> str:
    status = obj.status
    if status is None:
        return TranslationStatus.draft.value
    if isinstance(status, TranslationStatus):
        return status.value
    return str(status)


def _actor_from_session(
    session: Session,
) -> tuple[ActorType, str | None, str, uuid.UUID | None, BatchKind | None]:
    info = session.info.get("activity") or {}
    actor_type_raw = info.get("actor_type", "system")
    try:
        actor_type = ActorType(actor_type_raw)
    except ValueError:
        actor_type = ActorType.system
    actor_id = info.get("actor_id")
    actor_label = info.get("actor_label", "system")
    batch_id_raw = info.get("batch_id")
    batch_id = uuid.UUID(batch_id_raw) if batch_id_raw else None
    batch_kind_raw = info.get("batch_kind")
    batch_kind = None
    if batch_kind_raw:
        try:
            if batch_kind_raw == "import":
                batch_kind = BatchKind.import_
            else:
                batch_kind = BatchKind(batch_kind_raw)
        except ValueError:
            batch_kind = None
    return actor_type, actor_id, actor_label, batch_id, batch_kind


def _rel_loaded(obj: Any, name: str) -> bool:
    try:
        return name not in sa_inspect(obj).unloaded
    except Exception:
        return False


def _tag_ids_before_after(session: Session, obj: StringEntry) -> tuple[list[str], list[str], bool]:
    if _rel_loaded(obj, "tags"):
        current = list(obj.tags or [])
        after = sorted(str(t.id) for t in current)
        try:
            hist = sa_inspect(obj).attrs.tags.history
        except Exception:
            return after, after, False
        if not hist.has_changes():
            return after, after, False
        before_ids = {str(t.id) for t in current}
        for tag in hist.added or []:
            before_ids.discard(str(tag.id))
        for tag in hist.deleted or []:
            before_ids.add(str(tag.id))
        return sorted(before_ids), after, True

    rows = (
        session.query(Tag.id)
        .join(StringTag, StringTag.tag_id == Tag.id)
        .filter(StringTag.string_id == obj.id)
        .all()
    )
    ids = sorted(str(row[0]) for row in rows)
    return ids, ids, False


def _string_fields_changed(obj: StringEntry) -> bool:
    try:
        state = sa_inspect(obj)
    except Exception:
        return False
    for field in STRING_FIELDS:
        if state.attrs[field].history.has_changes():
            return True
    return False


def _field_value(obj: StringEntry, field: str, *, before: bool) -> Any:
    current = getattr(obj, field)
    if not before:
        return _jsonify(current)
    try:
        hist = sa_inspect(obj).attrs[field].history
    except Exception:
        return _jsonify(current)
    if hist.has_changes() and hist.deleted:
        return _jsonify(hist.deleted[0])
    return _jsonify(current)


def _translation_maps(
    session: Session, string_id: uuid.UUID, entry: StringEntry | None
) -> tuple[dict[str, str], dict[str, str], bool]:
    before: dict[str, str] = {}
    after: dict[str, str] = {}
    changed = False

    if entry is not None and _rel_loaded(entry, "translations"):
        for translation in list(entry.translations or []):
            if translation in session.deleted:
                continue
            after[translation.locale] = translation.value or ""
            before[translation.locale] = translation.value or ""
    elif entry is not None and entry.id:
        for translation in (
            session.query(Translation).filter(Translation.string_id == string_id).all()
        ):
            if translation in session.deleted:
                continue
            after[translation.locale] = translation.value or ""
            before[translation.locale] = translation.value or ""

    for obj in list(session.new):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            after[obj.locale] = obj.value or ""
            before.setdefault(obj.locale, "")
            changed = True

    for obj in list(session.dirty):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            after[obj.locale] = obj.value or ""
            try:
                hist = sa_inspect(obj).attrs.value.history
            except Exception:
                before[obj.locale] = obj.value or ""
                continue
            if hist.has_changes():
                changed = True
                before[obj.locale] = (hist.deleted[0] if hist.deleted else "") or ""
            else:
                before.setdefault(obj.locale, obj.value or "")
            try:
                pub_hist = sa_inspect(obj).attrs.published_value.history
            except Exception:
                pass
            else:
                if pub_hist.has_changes():
                    changed = True

    for obj in list(session.deleted):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            before[obj.locale] = obj.value or ""
            after.pop(obj.locale, None)
            changed = True

    return before, after, changed


def _published_translation_maps(
    session: Session, string_id: uuid.UUID, entry: StringEntry | None
) -> tuple[dict[str, str | None], dict[str, str | None]]:
    before: dict[str, str | None] = {}
    after: dict[str, str | None] = {}

    translations: list[Translation] = []
    if entry is not None and _rel_loaded(entry, "translations"):
        translations = [t for t in list(entry.translations or []) if t not in session.deleted]
    elif entry is not None and entry.id:
        translations = [
            t
            for t in session.query(Translation).filter(Translation.string_id == string_id).all()
            if t not in session.deleted
        ]

    for translation in translations:
        after[translation.locale] = translation.published_value
        before[translation.locale] = translation.published_value

    for obj in list(session.new):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            after[obj.locale] = obj.published_value
            before.setdefault(obj.locale, None)

    for obj in list(session.dirty):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            after[obj.locale] = obj.published_value
            try:
                hist = sa_inspect(obj).attrs.published_value.history
            except Exception:
                before[obj.locale] = obj.published_value
                continue
            if hist.has_changes():
                before[obj.locale] = hist.deleted[0] if hist.deleted else None
            else:
                before.setdefault(obj.locale, obj.published_value)

    for obj in list(session.deleted):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            before[obj.locale] = obj.published_value
            after.pop(obj.locale, None)

    return before, after


def _only_empty_new_translations(session: Session, string_id: uuid.UUID) -> bool:
    saw_empty_create = False
    for obj in list(session.new):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            if (obj.value or "").strip():
                return False
            saw_empty_create = True
    for obj in list(session.dirty):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            try:
                if sa_inspect(obj).attrs.value.history.has_changes():
                    return False
            except Exception:
                return False
    for obj in list(session.deleted):
        if isinstance(obj, Translation) and obj.string_id == string_id:
            return False
    return saw_empty_create


def _snapshot(
    session: Session,
    obj: StringEntry,
    *,
    before: bool,
    trans_before: dict[str, str],
    trans_after: dict[str, str],
    tags_before: list[str],
    tags_after: list[str],
) -> dict[str, Any]:
    _ensure_string_identity(obj)
    pub_before, pub_after = _published_translation_maps(session, obj.id, obj)
    return {
        "id": str(obj.id),
        "project_id": str(obj.project_id),
        "key": _field_value(obj, "key", before=before),
        "source_text": _field_value(obj, "source_text", before=before),
        "description": _field_value(obj, "description", before=before),
        "status": _field_value(obj, "status", before=before) or _status_value(obj),
        "module_id": _field_value(obj, "module_id", before=before),
        "published_key": _field_value(obj, "published_key", before=before),
        "published_module_id": _field_value(obj, "published_module_id", before=before),
        "published_source_text": _field_value(obj, "published_source_text", before=before),
        "published_at": _field_value(obj, "published_at", before=before),
        "pending_delete": bool(_field_value(obj, "pending_delete", before=before)),
        "deleted_at": _field_value(obj, "deleted_at", before=before),
        "tag_ids": tags_before if before else tags_after,
        "translations": trans_before if before else trans_after,
        "published_translations": pub_before if before else pub_after,
    }


def _load_entry(session: Session, string_id: uuid.UUID) -> StringEntry | None:
    return session.get(StringEntry, string_id)


def capture_activities(session: Session, flush_context: Any, instances: Any = None) -> None:
    """SQLAlchemy before_flush listener — one string snapshot per flushed string."""
    del flush_context, instances
    actor_type, actor_id, actor_label, batch_id, batch_kind = _actor_from_session(session)
    # Revert routes write an explicit marker; do not also log the restored mutation.
    if batch_kind == BatchKind.revert:
        return

    new_strings: dict[uuid.UUID, StringEntry] = {}
    dirty_strings: dict[uuid.UUID, StringEntry] = {}
    deleted_strings: dict[uuid.UUID, StringEntry] = {}
    string_ids: set[uuid.UUID] = set()

    for obj in list(session.new):
        if isinstance(obj, Activity):
            continue
        if isinstance(obj, StringEntry):
            _ensure_string_identity(obj)
            new_strings[obj.id] = obj
            string_ids.add(obj.id)
        elif isinstance(obj, Translation) and obj.string_id:
            string_ids.add(obj.string_id)

    for obj in list(session.dirty):
        if isinstance(obj, Activity):
            continue
        if isinstance(obj, StringEntry):
            dirty_strings[obj.id] = obj
            string_ids.add(obj.id)
        elif isinstance(obj, Translation) and obj.string_id:
            string_ids.add(obj.string_id)

    for obj in list(session.deleted):
        if isinstance(obj, Activity):
            continue
        if isinstance(obj, StringEntry):
            deleted_strings[obj.id] = obj
            string_ids.add(obj.id)
        elif isinstance(obj, Translation) and obj.string_id:
            string_ids.add(obj.string_id)

    activities: list[Activity] = []
    for string_id in string_ids:
        if string_id in deleted_strings:
            entry = deleted_strings[string_id]
            tags_before, tags_after, _ = _tag_ids_before_after(session, entry)
            trans_before, trans_after, _ = _translation_maps(session, string_id, entry)
            before = _snapshot(
                session,
                entry,
                before=True,
                trans_before=trans_before,
                trans_after=trans_after,
                tags_before=tags_before,
                tags_after=tags_after,
            )
            activities.append(
                _make_activity(
                    project_id=entry.project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.delete,
                    entity_type=EntityType.string,
                    entity_id=str(entry.id),
                    string_id=entry.id,
                    before=before,
                    after=None,
                    summary=f"Deleted string '{entry.key}'",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )
            continue

        if string_id in new_strings:
            entry = new_strings[string_id]
            tags_before, tags_after, _ = _tag_ids_before_after(session, entry)
            trans_before, trans_after, _ = _translation_maps(session, string_id, entry)
            after = _snapshot(
                session,
                entry,
                before=False,
                trans_before=trans_before,
                trans_after=trans_after,
                tags_before=tags_before,
                tags_after=tags_after,
            )
            activities.append(
                _make_activity(
                    project_id=entry.project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.create,
                    entity_type=EntityType.string,
                    entity_id=str(entry.id),
                    string_id=entry.id,
                    before=None,
                    after=after,
                    summary=f"Created string '{entry.key}'",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )
            continue

        entry = dirty_strings.get(string_id) or _load_entry(session, string_id)
        if entry is None:
            continue

        field_changed = string_id in dirty_strings and _string_fields_changed(entry)
        tags_before, tags_after, tags_changed = _tag_ids_before_after(session, entry)
        trans_before, trans_after, trans_changed = _translation_maps(session, string_id, entry)
        if not field_changed and not tags_changed:
            if not trans_changed or _only_empty_new_translations(session, string_id):
                continue

        before = _snapshot(
            session,
            entry,
            before=True,
            trans_before=trans_before,
            trans_after=trans_after,
            tags_before=tags_before,
            tags_after=tags_after,
        )
        after = _snapshot(
            session,
            entry,
            before=False,
            trans_before=trans_before,
            trans_after=trans_after,
            tags_before=tags_before,
            tags_after=tags_after,
        )
        if before == after:
            continue

        soft_deleted = not before.get("deleted_at") and bool(after.get("deleted_at"))
        activities.append(
            _make_activity(
                project_id=entry.project_id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                action=ActivityAction.delete if soft_deleted else ActivityAction.update,
                entity_type=EntityType.string,
                entity_id=str(entry.id),
                string_id=entry.id,
                before=before,
                after=after,
                summary=(
                    f"Deleted string '{entry.key}'"
                    if soft_deleted
                    else f"Updated string '{entry.key}'"
                ),
                batch_id=batch_id,
                batch_kind=batch_kind,
                is_revertible=True,
            )
        )

    for activity in activities:
        session.add(activity)


def _make_activity(
    *,
    project_id: uuid.UUID,
    actor_type: ActorType,
    actor_id: str | None,
    actor_label: str,
    action: ActivityAction,
    entity_type: EntityType,
    entity_id: str,
    string_id: uuid.UUID | None = None,
    locale: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    summary: str = "",
    batch_id: uuid.UUID | None = None,
    batch_kind: BatchKind | None = None,
    is_revertible: bool = False,
) -> Activity:
    return Activity(
        project_id=project_id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_label=actor_label,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        string_id=string_id,
        locale=locale,
        before=before,
        after=after,
        summary=summary,
        batch_id=batch_id,
        batch_kind=batch_kind,
        is_revertible=is_revertible,
    )
