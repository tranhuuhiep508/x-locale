"""Activity log capture via SQLAlchemy before_flush."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.models import (
    Activity,
    ActivityAction,
    ActorType,
    BatchKind,
    EntityType,
    Snapshot,
    StringEntry,
    Translation,
    TranslationStatus,
)

CONTENT_TYPES = {StringEntry, Translation}
REVERTIBLE_ENTITY = {
    StringEntry: EntityType.string,
    Translation: EntityType.translation,
}

STRING_FIELDS = ("key", "source_text", "description", "module_id")
TRANSLATION_FIELDS = ("locale", "value", "status")


def _serialize_string(obj: StringEntry) -> dict[str, Any]:
    return {
        "id": str(obj.id),
        "project_id": str(obj.project_id),
        "module_id": str(obj.module_id) if obj.module_id else None,
        "key": obj.key,
        "source_text": obj.source_text,
        "description": obj.description,
    }


def _serialize_translation(obj: Translation) -> dict[str, Any]:
    status = obj.status.value if isinstance(obj.status, TranslationStatus) else obj.status
    return {
        "id": str(obj.id),
        "string_id": str(obj.string_id),
        "locale": obj.locale,
        "value": obj.value,
        "status": status,
    }


def _history_before_after(obj: Any, fields: tuple[str, ...]) -> tuple[dict, dict] | None:
    state = sa_inspect(obj)
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    changed = False
    for field in fields:
        attr = state.attrs[field]
        hist = attr.history
        if hist.has_changes():
            changed = True
            before[field] = _jsonify(hist.deleted[0] if hist.deleted else None)
            after[field] = _jsonify(hist.added[0] if hist.added else getattr(obj, field))
        else:
            val = _jsonify(getattr(obj, field))
            before[field] = val
            after[field] = val
    if not changed:
        return None
    # Include identity fields
    before["id"] = str(obj.id)
    after["id"] = str(obj.id)
    return before, after


def _jsonify(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, TranslationStatus):
        return val.value
    if hasattr(val, "value") and isinstance(val, (TranslationStatus,)):
        return val.value
    return val


def _actor_from_session(session: Session) -> tuple[ActorType, str | None, str, uuid.UUID | None, BatchKind | None]:
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
            # Map "import" to import_
            if batch_kind_raw == "import":
                batch_kind = BatchKind.import_
            else:
                batch_kind = BatchKind(batch_kind_raw)
        except ValueError:
            batch_kind = None
    return actor_type, actor_id, actor_label, batch_id, batch_kind


def _is_empty_auto_translation(obj: Translation, action: ActivityAction) -> bool:
    """Skip noise from auto-created empty translation rows."""
    if action != ActivityAction.create:
        return False
    return not (obj.value or "").strip()


def capture_activities(session: Session, flush_context: Any, instances: Any = None) -> None:
    """SQLAlchemy before_flush listener — records content changes as Activity rows."""
    del flush_context, instances  # unused
    actor_type, actor_id, actor_label, batch_id, batch_kind = _actor_from_session(session)
    activities: list[Activity] = []

    for obj in list(session.new):
        if isinstance(obj, (Activity, Snapshot)):
            continue
        if isinstance(obj, StringEntry):
            after = _serialize_string(obj)
            activities.append(
                _make_activity(
                    project_id=obj.project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.create,
                    entity_type=EntityType.string,
                    entity_id=str(obj.id),
                    string_id=obj.id,
                    before=None,
                    after=after,
                    summary=f"Created string '{obj.key}'",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )
        elif isinstance(obj, Translation):
            if _is_empty_auto_translation(obj, ActivityAction.create):
                continue
            # Need project_id via string_entry if loaded
            project_id = _project_id_for_translation(session, obj)
            if project_id is None:
                continue
            after = _serialize_translation(obj)
            activities.append(
                _make_activity(
                    project_id=project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.create,
                    entity_type=EntityType.translation,
                    entity_id=str(obj.id),
                    string_id=obj.string_id,
                    locale=obj.locale,
                    before=None,
                    after=after,
                    summary=f"Created translation {obj.locale}",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )

    for obj in list(session.dirty):
        if isinstance(obj, (Activity, Snapshot)):
            continue
        if isinstance(obj, StringEntry):
            result = _history_before_after(obj, STRING_FIELDS)
            if result is None:
                continue
            before, after = result
            # Enrich with full serialize for revert
            before = {**_serialize_string(obj), **before}
            after = {**_serialize_string(obj), **after}
            # Fix before values from history
            state = sa_inspect(obj)
            for field in STRING_FIELDS:
                hist = state.attrs[field].history
                if hist.has_changes() and hist.deleted:
                    before[field] = _jsonify(hist.deleted[0])
            activities.append(
                _make_activity(
                    project_id=obj.project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.update,
                    entity_type=EntityType.string,
                    entity_id=str(obj.id),
                    string_id=obj.id,
                    before=before,
                    after=after,
                    summary=f"Updated string '{obj.key}'",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )
        elif isinstance(obj, Translation):
            result = _history_before_after(obj, TRANSLATION_FIELDS)
            if result is None:
                continue
            before, after = result
            state = sa_inspect(obj)
            full_before = _serialize_translation(obj)
            full_after = _serialize_translation(obj)
            for field in TRANSLATION_FIELDS:
                hist = state.attrs[field].history
                if hist.has_changes() and hist.deleted:
                    full_before[field] = _jsonify(hist.deleted[0])
                full_after[field] = _jsonify(getattr(obj, field))
            project_id = _project_id_for_translation(session, obj)
            if project_id is None:
                continue
            activities.append(
                _make_activity(
                    project_id=project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.update,
                    entity_type=EntityType.translation,
                    entity_id=str(obj.id),
                    string_id=obj.string_id,
                    locale=obj.locale,
                    before=full_before,
                    after=full_after,
                    summary=f"Updated translation {obj.locale}",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )

    for obj in list(session.deleted):
        if isinstance(obj, (Activity, Snapshot)):
            continue
        if isinstance(obj, StringEntry):
            before = _serialize_string(obj)
            # Include child translations for restore
            translations = []
            for t in list(obj.translations) if obj.translations is not None else []:
                translations.append(_serialize_translation(t))
            before["translations"] = translations
            activities.append(
                _make_activity(
                    project_id=obj.project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.delete,
                    entity_type=EntityType.string,
                    entity_id=str(obj.id),
                    string_id=obj.id,
                    before=before,
                    after=None,
                    summary=f"Deleted string '{obj.key}'",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )
        elif isinstance(obj, Translation):
            project_id = _project_id_for_translation(session, obj)
            if project_id is None:
                continue
            before = _serialize_translation(obj)
            activities.append(
                _make_activity(
                    project_id=project_id,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    action=ActivityAction.delete,
                    entity_type=EntityType.translation,
                    entity_id=str(obj.id),
                    string_id=obj.string_id,
                    locale=obj.locale,
                    before=before,
                    after=None,
                    summary=f"Deleted translation {obj.locale}",
                    batch_id=batch_id,
                    batch_kind=batch_kind,
                    is_revertible=True,
                )
            )

    for activity in activities:
        session.add(activity)


def _project_id_for_translation(session: Session, obj: Translation) -> uuid.UUID | None:
    if obj.string_entry is not None:
        return obj.string_entry.project_id
    # Try identity map / query
    entry = session.get(StringEntry, obj.string_id)
    if entry:
        return entry.project_id
    return None


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
