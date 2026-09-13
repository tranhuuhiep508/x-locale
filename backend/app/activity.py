"""Activity log capture via SQLAlchemy before_flush."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
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
from app.services.activity_events import classify_event

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


@dataclass
class _FlushTranslationIndex:
    """Per-flush indexes so activity capture stays O(changed rows), not O(n²)."""

    new_by_string: dict[uuid.UUID, list[Translation]] = field(default_factory=dict)
    dirty_by_string: dict[uuid.UUID, list[Translation]] = field(default_factory=dict)
    deleted_by_string: dict[uuid.UUID, list[Translation]] = field(default_factory=dict)
    deleted_ids: set[int] = field(default_factory=set)

    @classmethod
    def build(cls, session: Session) -> _FlushTranslationIndex:
        index = cls()
        for obj in list(session.new):
            if isinstance(obj, Translation) and obj.string_id:
                index.new_by_string.setdefault(obj.string_id, []).append(obj)
        for obj in list(session.dirty):
            if isinstance(obj, Translation) and obj.string_id:
                index.dirty_by_string.setdefault(obj.string_id, []).append(obj)
        for obj in list(session.deleted):
            index.deleted_ids.add(id(obj))
            if isinstance(obj, Translation) and obj.string_id:
                index.deleted_by_string.setdefault(obj.string_id, []).append(obj)
        return index

    def is_deleted(self, obj: Any) -> bool:
        return id(obj) in self.deleted_ids


def attach_batch(session: Session, batch_id: uuid.UUID, batch_kind: str) -> dict[str, Any]:
    """Stamp the current actor context with batch metadata. Returns the prior info dict."""
    existing = session.info.get("activity") or {}
    session.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": batch_kind,
    }
    return existing


RESTORE_INTENT_KEY = "_x_locale_restore_intent"


def set_restore_intent(session: Session) -> None:
    """Mark the next flush as a history restore so capture emits string.restored."""
    existing = session.info.get("activity") or {}
    session.info["activity"] = {**existing, "intent": "restore"}
    session.info[RESTORE_INTENT_KEY] = True


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


def _tag_pairs(tags: list[Tag]) -> tuple[list[str], list[str]]:
    pairs = sorted(((str(tag.id), tag.name or "") for tag in tags), key=lambda item: item[0])
    return [item[0] for item in pairs], [item[1] for item in pairs]


def _tag_ids_before_after(
    session: Session, obj: StringEntry
) -> tuple[list[str], list[str], list[str], list[str], bool]:
    if _rel_loaded(obj, "tags"):
        current = list(obj.tags or [])
        after_ids, after_names = _tag_pairs(current)
        try:
            hist = sa_inspect(obj).attrs.tags.history
        except Exception:
            return after_ids, after_ids, after_names, after_names, False
        if not hist.has_changes():
            return after_ids, after_ids, after_names, after_names, False
        before_map = {str(tag.id): (tag.name or "") for tag in current}
        for tag in hist.added or []:
            before_map.pop(str(tag.id), None)
        for tag in hist.deleted or []:
            before_map[str(tag.id)] = tag.name or ""
        before_ids = sorted(before_map)
        before_names = [before_map[tid] for tid in before_ids]
        return before_ids, after_ids, before_names, after_names, True

    rows = (
        session.query(Tag.id, Tag.name)
        .join(StringTag, StringTag.tag_id == Tag.id)
        .filter(StringTag.string_id == obj.id)
        .all()
    )
    pairs = sorted(((str(row[0]), row[1] or "") for row in rows), key=lambda item: item[0])
    ids = [item[0] for item in pairs]
    names = [item[1] for item in pairs]
    return ids, ids, names, names, False


def _string_fields_changed(obj: StringEntry) -> bool:
    try:
        state = sa_inspect(obj)
    except Exception:
        return False
    for attr_name in STRING_FIELDS:
        if state.attrs[attr_name].history.has_changes():
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
    session: Session,
    string_id: uuid.UUID,
    entry: StringEntry | None,
    flush_index: _FlushTranslationIndex | None = None,
) -> tuple[dict[str, str], dict[str, str], bool]:
    index = flush_index or _FlushTranslationIndex.build(session)
    before: dict[str, str] = {}
    after: dict[str, str] = {}
    changed = False

    if entry is not None and _rel_loaded(entry, "translations"):
        for translation in list(entry.translations or []):
            if index.is_deleted(translation):
                continue
            after[translation.locale] = translation.value or ""
            before[translation.locale] = translation.value or ""
    elif entry is not None and entry.id:
        for translation in (
            session.query(Translation).filter(Translation.string_id == string_id).all()
        ):
            if index.is_deleted(translation):
                continue
            after[translation.locale] = translation.value or ""
            before[translation.locale] = translation.value or ""

    for obj in index.new_by_string.get(string_id, ()):
        after[obj.locale] = obj.value or ""
        before.setdefault(obj.locale, "")
        changed = True

    for obj in index.dirty_by_string.get(string_id, ()):
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

    for obj in index.deleted_by_string.get(string_id, ()):
        before[obj.locale] = obj.value or ""
        after.pop(obj.locale, None)
        changed = True

    return before, after, changed


def _published_translation_maps(
    session: Session,
    string_id: uuid.UUID,
    entry: StringEntry | None,
    flush_index: _FlushTranslationIndex | None = None,
) -> tuple[dict[str, str | None], dict[str, str | None]]:
    index = flush_index or _FlushTranslationIndex.build(session)
    before: dict[str, str | None] = {}
    after: dict[str, str | None] = {}

    translations: list[Translation] = []
    if entry is not None and _rel_loaded(entry, "translations"):
        translations = [
            t for t in list(entry.translations or []) if not index.is_deleted(t)
        ]
    elif entry is not None and entry.id:
        translations = [
            t
            for t in session.query(Translation).filter(Translation.string_id == string_id).all()
            if not index.is_deleted(t)
        ]

    for translation in translations:
        after[translation.locale] = translation.published_value
        before[translation.locale] = translation.published_value

    for obj in index.new_by_string.get(string_id, ()):
        after[obj.locale] = obj.published_value
        before.setdefault(obj.locale, None)

    for obj in index.dirty_by_string.get(string_id, ()):
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

    for obj in index.deleted_by_string.get(string_id, ()):
        before[obj.locale] = obj.published_value
        after.pop(obj.locale, None)

    return before, after


def _only_empty_new_translations(
    session: Session,
    string_id: uuid.UUID,
    flush_index: _FlushTranslationIndex | None = None,
) -> bool:
    index = flush_index or _FlushTranslationIndex.build(session)
    saw_empty_create = False
    for obj in index.new_by_string.get(string_id, ()):
        if (obj.value or "").strip():
            return False
        saw_empty_create = True
    for obj in index.dirty_by_string.get(string_id, ()):
        try:
            if sa_inspect(obj).attrs.value.history.has_changes():
                return False
        except Exception:
            return False
    if index.deleted_by_string.get(string_id):
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
    tag_names_before: list[str],
    tag_names_after: list[str],
    flush_index: _FlushTranslationIndex | None = None,
) -> dict[str, Any]:
    _ensure_string_identity(obj)
    pub_before, pub_after = _published_translation_maps(
        session, obj.id, obj, flush_index=flush_index
    )
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
        "tag_names": tag_names_before if before else tag_names_after,
        "translations": trans_before if before else trans_after,
        "published_translations": pub_before if before else pub_after,
    }


def _load_entry(session: Session, string_id: uuid.UUID) -> StringEntry | None:
    return session.get(StringEntry, string_id)


def _stamp_string_metadata(session: Session) -> None:
    """Stamp string.updated_* and created_by_* from the current session actor."""
    now = datetime.now(UTC)
    actor_type, actor_id, actor_label, _, _ = _actor_from_session(session)
    string_ids: set[uuid.UUID] = set()
    new_string_ids: set[uuid.UUID] = set()
    entries_by_id: dict[uuid.UUID, StringEntry] = {}

    for obj in list(session.new):
        if isinstance(obj, Activity):
            continue
        if isinstance(obj, StringEntry):
            _ensure_string_identity(obj)
            new_string_ids.add(obj.id)
            entries_by_id[obj.id] = obj
            string_ids.add(obj.id)
        elif isinstance(obj, Translation) and obj.string_id:
            string_ids.add(obj.string_id)

    for obj in list(session.dirty) + list(session.deleted):
        if isinstance(obj, Activity):
            continue
        if isinstance(obj, StringEntry):
            entries_by_id[obj.id] = obj
            string_ids.add(obj.id)
        elif isinstance(obj, Translation) and obj.string_id:
            string_ids.add(obj.string_id)

    for obj in list(session.dirty):
        if not isinstance(obj, StringEntry):
            continue
        _, _, _, _, tags_changed = _tag_ids_before_after(session, obj)
        if tags_changed:
            entries_by_id[obj.id] = obj
            string_ids.add(obj.id)

    for string_id in string_ids:
        if string_id is None:
            continue
        entry = entries_by_id.get(string_id) or session.get(StringEntry, string_id)
        if entry is None:
            continue
        entry.updated_at = now
        entry.updated_by_type = actor_type
        entry.updated_by_id = actor_id
        entry.updated_by_label = actor_label
        if string_id in new_string_ids and entry.created_by_label is None:
            entry.created_by_type = actor_type
            entry.created_by_id = actor_id
            entry.created_by_label = actor_label


def capture_activities(session: Session, flush_context: Any, instances: Any = None) -> None:
    """SQLAlchemy before_flush listener — one string snapshot per flushed string."""
    del flush_context, instances
    _stamp_string_metadata(session)
    actor_type, actor_id, actor_label, batch_id, batch_kind = _actor_from_session(session)
    intent = (session.info.get("activity") or {}).get("intent")
    if session.info.get(RESTORE_INTENT_KEY):
        intent = "restore"
    # Revert routes write an explicit marker; do not also log the restored mutation.
    if batch_kind == BatchKind.revert:
        return

    new_strings: dict[uuid.UUID, StringEntry] = {}
    dirty_strings: dict[uuid.UUID, StringEntry] = {}
    deleted_strings: dict[uuid.UUID, StringEntry] = {}
    string_ids: set[uuid.UUID] = set()
    flush_index = _FlushTranslationIndex.build(session)

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
            tags_before, tags_after, names_before, names_after, _ = _tag_ids_before_after(
                session, entry
            )
            trans_before, trans_after, _ = _translation_maps(
                session, string_id, entry, flush_index=flush_index
            )
            before = _snapshot(
                session,
                entry,
                before=True,
                trans_before=trans_before,
                trans_after=trans_after,
                tags_before=tags_before,
                tags_after=tags_after,
                tag_names_before=names_before,
                tag_names_after=names_after,
                flush_index=flush_index,
            )
            classified = classify_event(
                action=ActivityAction.delete.value,
                before=before,
                after=None,
                batch_kind=batch_kind.value if batch_kind else None,
                intent=intent,
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
                    locale=classified.locale,
                    before=before,
                    after=None,
                    event_type=classified.event_type,
                    summary=classified.summary,
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )
            continue

        if string_id in new_strings:
            entry = new_strings[string_id]
            tags_before, tags_after, names_before, names_after, _ = _tag_ids_before_after(
                session, entry
            )
            trans_before, trans_after, _ = _translation_maps(
                session, string_id, entry, flush_index=flush_index
            )
            after = _snapshot(
                session,
                entry,
                before=False,
                trans_before=trans_before,
                trans_after=trans_after,
                tags_before=tags_before,
                tags_after=tags_after,
                tag_names_before=names_before,
                tag_names_after=names_after,
                flush_index=flush_index,
            )
            classified = classify_event(
                action=ActivityAction.create.value,
                before=None,
                after=after,
                batch_kind=batch_kind.value if batch_kind else None,
                intent=intent,
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
                    locale=classified.locale,
                    before=None,
                    after=after,
                    event_type=classified.event_type,
                    summary=classified.summary,
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
        tags_before, tags_after, names_before, names_after, tags_changed = _tag_ids_before_after(
            session, entry
        )
        trans_before, trans_after, trans_changed = _translation_maps(
            session, string_id, entry, flush_index=flush_index
        )
        if not field_changed and not tags_changed:
            if not trans_changed or _only_empty_new_translations(
                session, string_id, flush_index=flush_index
            ):
                continue

        before = _snapshot(
            session,
            entry,
            before=True,
            trans_before=trans_before,
            trans_after=trans_after,
            tags_before=tags_before,
            tags_after=tags_after,
            tag_names_before=names_before,
            tag_names_after=names_after,
            flush_index=flush_index,
        )
        after = _snapshot(
            session,
            entry,
            before=False,
            trans_before=trans_before,
            trans_after=trans_after,
            tags_before=tags_before,
            tags_after=tags_after,
            tag_names_before=names_before,
            tag_names_after=names_after,
            flush_index=flush_index,
        )
        if before == after:
            continue

        soft_deleted = not before.get("deleted_at") and bool(after.get("deleted_at"))
        action = ActivityAction.delete if soft_deleted else ActivityAction.update
        classified = classify_event(
            action=action.value,
            before=before,
            after=after,
            batch_kind=batch_kind.value if batch_kind else None,
            intent=intent,
        )
        activities.append(
            _make_activity(
                project_id=entry.project_id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                action=action,
                entity_type=EntityType.string,
                entity_id=str(entry.id),
                string_id=entry.id,
                locale=classified.locale,
                before=before,
                after=after,
                event_type=classified.event_type,
                summary=classified.summary,
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
    event_type: str = "string.updated",
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
        event_type=event_type,
        summary=summary,
        batch_id=batch_id,
        batch_kind=batch_kind,
        is_revertible=is_revertible,
    )
