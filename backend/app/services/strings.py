"""String lookup, listing, CRUD, locale checks, and batch mutations."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Sequence

from fastapi import HTTPException
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Project, StringEntry, Tag, Translation, TranslationStatus
from app.schemas import (
    BatchRequest,
    BatchResult,
    StringCreate,
    StringListOut,
    StringOut,
    StringUpdate,
    TagOut,
    TranslationOut,
    TranslationUpdate,
)


def mark_deleted(entry: StringEntry) -> None:
    entry.deleted_at = datetime.now(UTC)
    entry.pending_delete = False


def restore_string(entry: StringEntry) -> bool:
    """Clear pending delete and/or tombstone. Returns True if anything changed."""
    changed = False
    if entry.deleted_at is not None:
        entry.deleted_at = None
        changed = True
    if entry.pending_delete:
        entry.pending_delete = False
        changed = True
    return changed


def queue_or_soft_delete(entry: StringEntry) -> bool:
    """Hide a never-published string, or queue removal of a published one."""
    if entry.deleted_at is not None:
        return False
    if entry.published_key is not None:
        if entry.pending_delete:
            return False
        entry.pending_delete = True
        return True
    mark_deleted(entry)
    return True


def has_unpublished_changes(entry: StringEntry) -> bool:
    if entry.deleted_at is not None:
        return False
    if entry.pending_delete:
        return True
    if entry.published_key is None:
        return False
    if entry.key != entry.published_key:
        return True
    if entry.module_id != entry.published_module_id:
        return True
    if entry.source_text != entry.published_source_text:
        return True
    for translation in entry.translations or []:
        published = translation.published_value if translation.published_value is not None else ""
        if (translation.value or "") != published:
            return True
    return False


def unpublished_changes_clause():
    translation_diff = exists(
        select(Translation.id).where(
            Translation.string_id == StringEntry.id,
            func.coalesce(Translation.value, "")
            != func.coalesce(Translation.published_value, ""),
        )
    )
    return or_(
        StringEntry.pending_delete.is_(True),
        (StringEntry.published_key.isnot(None))
        & StringEntry.deleted_at.is_(None)
        & or_(
            StringEntry.key != StringEntry.published_key,
            StringEntry.source_text != StringEntry.published_source_text,
            StringEntry.module_id.is_distinct_from(StringEntry.published_module_id),
            translation_diff,
        ),
    )


def promote_string(entry: StringEntry) -> None:
    """Copy working copy → published snapshot and mark the string public."""
    entry.published_key = entry.key
    entry.published_module_id = entry.module_id
    entry.published_source_text = entry.source_text
    entry.published_at = datetime.now(UTC)
    entry.status = TranslationStatus.public
    entry.pending_delete = False
    for translation in entry.translations or []:
        translation.published_value = translation.value or ""


def unpublish_string(entry: StringEntry) -> None:
    entry.status = TranslationStatus.draft


def discard_working_changes(entry: StringEntry) -> bool:
    """Reset working copy to the last published snapshot. Returns True if anything changed."""
    if entry.published_key is None:
        return False
    changed = False
    if entry.key != entry.published_key:
        entry.key = entry.published_key
        changed = True
    if entry.module_id != entry.published_module_id:
        entry.module_id = entry.published_module_id
        changed = True
    if entry.source_text != (entry.published_source_text or ""):
        entry.source_text = entry.published_source_text or entry.source_text
        changed = True
    for translation in entry.translations or []:
        published = translation.published_value if translation.published_value is not None else ""
        if (translation.value or "") != published:
            translation.value = published
            translation.confidence = None
            changed = True
    if entry.pending_delete:
        entry.pending_delete = False
        changed = True
    return changed


def _actor_type_value(actor_type) -> str | None:
    if actor_type is None:
        return None
    return actor_type.value if hasattr(actor_type, "value") else str(actor_type)


def serialize_string(entry: StringEntry) -> StringOut:
    return StringOut(
        id=entry.id,
        key=entry.key,
        source_text=entry.source_text,
        description=entry.description,
        status=entry.status,
        pending_delete=bool(entry.pending_delete),
        deleted_at=entry.deleted_at,
        has_unpublished_changes=has_unpublished_changes(entry),
        published_at=entry.published_at,
        published_key=entry.published_key,
        published_source_text=entry.published_source_text,
        published_module_id=entry.published_module_id,
        published_module_slug=entry.published_module.slug if entry.published_module else None,
        module_id=entry.module_id,
        module_slug=entry.module.slug if entry.module else None,
        tags=[
            TagOut(id=t.id, name=t.name, color=t.color, string_count=0) for t in (entry.tags or [])
        ],
        created_at=entry.created_at,
        created_by_type=_actor_type_value(entry.created_by_type),
        created_by_label=entry.created_by_label,
        updated_at=entry.updated_at,
        updated_by_type=_actor_type_value(entry.updated_by_type),
        updated_by_label=entry.updated_by_label,
        translations=[
            TranslationOut(
                id=t.id,
                locale=t.locale,
                value=t.value,
                published_value=t.published_value,
                confidence=t.confidence,
                updated_at=t.updated_at,
            )
            for t in (entry.translations or [])
        ],
    )


def ensure_translation_rows(db: Session, entry: StringEntry, project: Project) -> None:
    existing = {t.locale for t in entry.translations}
    for locale in project.target_languages:
        if locale not in existing:
            translation = Translation(
                string_id=entry.id,
                locale=locale,
                value="",
            )
            db.add(translation)
            entry.translations.append(translation)


def apply_translation_values(
    db: Session,
    entry: StringEntry,
    translations: dict[str, str],
    scores: dict[str, int] | None = None,
) -> None:
    """Upsert locale values on an entry. Caller must validate locales.

    Pass scores from an AI write. Any other value change clears the stored score.
    """
    scored = scores or {}
    by_locale = {t.locale: t for t in entry.translations}
    for locale, value in translations.items():
        existing = by_locale.get(locale)
        has_score = locale in scored
        score = scored[locale] if has_score else None
        if existing is None:
            translation = Translation(
                string_id=entry.id,
                locale=locale,
                value=value,
                confidence=score if has_score else None,
            )
            db.add(translation)
            entry.translations.append(translation)
        else:
            value_changed = existing.value != value
            existing.value = value
            if has_score:
                existing.confidence = score
            elif value_changed:
                existing.confidence = None


def string_query(
    db: Session,
    project_id: uuid.UUID,
    *,
    module_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    q: str | None = None,
    missing_locale: str | None = None,
    status: TranslationStatus | None = None,
    pending_delete: bool | None = None,
    has_unpublished_changes: bool | None = None,
    deleted: bool | None = None,
    max_confidence: int | None = None,
):
    query = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
            joinedload(StringEntry.published_module),
        )
        .filter(StringEntry.project_id == project_id)
    )
    if deleted is True:
        query = query.filter(StringEntry.deleted_at.isnot(None))
    else:
        query = query.filter(StringEntry.deleted_at.is_(None))
    if module_id is not None:
        query = query.filter(StringEntry.module_id == module_id)
    if tag_id is not None:
        query = query.join(StringEntry.tags).filter(Tag.id == tag_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                StringEntry.key.ilike(like),
                StringEntry.source_text.ilike(like),
                StringEntry.description.ilike(like),
            )
        )
    if missing_locale:
        subquery = (
            db.query(Translation.string_id)
            .filter(
                Translation.locale == missing_locale,
                Translation.value != "",
            )
            .subquery()
        )
        query = query.filter(~StringEntry.id.in_(db.query(subquery.c.string_id)))
    if status is not None:
        query = query.filter(StringEntry.status == status)
    if pending_delete is not None:
        query = query.filter(StringEntry.pending_delete.is_(pending_delete))
    if has_unpublished_changes is not None:
        clause = unpublished_changes_clause()
        query = query.filter(clause if has_unpublished_changes else ~clause)
    if max_confidence is not None:
        scored = (
            db.query(Translation.string_id)
            .filter(
                Translation.confidence.isnot(None),
                Translation.confidence <= max_confidence,
                Translation.value != "",
            )
            .subquery()
        )
        query = query.filter(StringEntry.id.in_(db.query(scored.c.string_id)))
    return query.distinct()


def resolve_string_ids(
    db: Session,
    project: Project,
    string_ids: Sequence[uuid.UUID] | None,
    filt,
) -> list[uuid.UUID]:
    if string_ids:
        return list(string_ids)
    if filt is None:
        return []
    q = string_query(
        db,
        project.id,
        module_id=getattr(filt, "module_id", None),
        tag_id=getattr(filt, "tag_id", None),
        q=getattr(filt, "q", None),
        missing_locale=getattr(filt, "missing_locale", None),
        status=getattr(filt, "status", None),
        pending_delete=getattr(filt, "pending_delete", None),
        has_unpublished_changes=getattr(filt, "has_unpublished_changes", None),
        deleted=getattr(filt, "deleted", None),
        max_confidence=getattr(filt, "max_confidence", None),
    )
    return [row.id for row in q.with_entities(StringEntry.id).all()]


def validate_locales(project: Project, translations: dict[str, str] | None) -> None:
    if not translations:
        return
    allowed = set(project.target_languages)
    allowed.add(project.base_language)
    for locale in translations:
        if locale not in allowed:
            raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured")


def get_string(db: Session, project_id: uuid.UUID, string_id: uuid.UUID) -> StringEntry:
    entry = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
            joinedload(StringEntry.published_module),
        )
        .filter(StringEntry.id == string_id, StringEntry.project_id == project_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="String not found")
    return entry


def list_strings(
    db: Session,
    project: Project,
    *,
    module: uuid.UUID | None = None,
    tag: uuid.UUID | None = None,
    q: str | None = None,
    missing_locale: str | None = None,
    status: TranslationStatus | None = None,
    pending_delete: bool | None = None,
    has_unpublished_changes: bool | None = None,
    deleted: bool | None = None,
    max_confidence: int | None = None,
    page: int = 1,
    page_size: int = 50,
) -> StringListOut:
    query = string_query(
        db,
        project.id,
        module_id=module,
        tag_id=tag,
        q=q,
        missing_locale=missing_locale,
        status=status,
        pending_delete=pending_delete,
        has_unpublished_changes=has_unpublished_changes,
        deleted=deleted,
        max_confidence=max_confidence,
    )
    total = query.count()
    entries = (
        query.order_by(StringEntry.key)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return StringListOut(
        items=[serialize_string(e) for e in entries],
        total=total,
        page=page,
        page_size=page_size,
    )


def create_string(db: Session, project: Project, payload: StringCreate) -> StringOut:
    existing = (
        db.query(StringEntry)
        .filter(
            StringEntry.project_id == project.id,
            StringEntry.module_id == payload.module_id,
            StringEntry.key == payload.key,
            StringEntry.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"String '{payload.key}' already exists")

    validate_locales(project, payload.translations)

    entry = StringEntry(
        id=uuid.uuid4(),
        project_id=project.id,
        module_id=payload.module_id,
        key=payload.key,
        source_text=payload.source_text,
        description=payload.description,
        status=TranslationStatus.draft,
    )
    db.add(entry)
    if payload.tag_ids:
        tags = (
            db.query(Tag)
            .filter(Tag.project_id == project.id, Tag.id.in_(payload.tag_ids))
            .all()
        )
        entry.tags = tags
    ensure_translation_rows(db, entry, project)
    if payload.translations:
        apply_translation_values(db, entry, payload.translations, payload.translation_scores)
    if payload.status == TranslationStatus.public:
        promote_string(entry)
    db.commit()
    return serialize_string(get_string(db, project.id, entry.id))


def update_string(
    db: Session,
    project: Project,
    string_id: uuid.UUID,
    payload: StringUpdate,
) -> StringOut:
    entry = get_string(db, project.id, string_id)
    if payload.key is not None:
        entry.key = payload.key
    if payload.source_text is not None:
        entry.source_text = payload.source_text
    if "description" in payload.model_fields_set:
        entry.description = payload.description or None
    if "module_id" in payload.model_fields_set:
        entry.module_id = payload.module_id
    if payload.tag_ids is not None:
        tags = (
            db.query(Tag)
            .filter(Tag.project_id == project.id, Tag.id.in_(payload.tag_ids))
            .all()
        )
        entry.tags = tags
    if payload.translations is not None:
        validate_locales(project, payload.translations)
        ensure_translation_rows(db, entry, project)
        apply_translation_values(db, entry, payload.translations, payload.translation_scores)
    if payload.status == TranslationStatus.public:
        promote_string(entry)
    elif payload.status == TranslationStatus.draft:
        unpublish_string(entry)
    db.commit()
    return serialize_string(get_string(db, project.id, string_id))


def upsert_translation(
    db: Session,
    project: Project,
    string_id: uuid.UUID,
    locale: str,
    payload: TranslationUpdate,
) -> StringOut:
    entry = get_string(db, project.id, string_id)
    if locale not in project.target_languages and locale != project.base_language:
        raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured")

    translation = next((t for t in entry.translations if t.locale == locale), None)
    if not translation:
        translation = Translation(
            string_id=entry.id,
            locale=locale,
            value=payload.value,
            confidence=None,
        )
        db.add(translation)
    else:
        if translation.value != payload.value:
            translation.confidence = None
        translation.value = payload.value
    db.commit()
    return serialize_string(get_string(db, project.id, string_id))


def delete_string(db: Session, project: Project, string_id: uuid.UUID) -> None:
    entry = get_string(db, project.id, string_id)
    queue_or_soft_delete(entry)
    db.commit()


def apply_batch(db: Session, project: Project, payload: BatchRequest) -> BatchResult:
    from app.activity import attach_batch

    ids = resolve_string_ids(db, project, payload.string_ids, payload.filter)
    if not ids:
        return BatchResult(affected=0, batch_id=uuid.uuid4())

    batch_id = uuid.uuid4()
    attach_batch(db, batch_id, "batch")

    entries = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
            joinedload(StringEntry.published_module),
        )
        .filter(StringEntry.project_id == project.id, StringEntry.id.in_(ids))
        .all()
    )

    affected = 0
    action = payload.action

    if action == "publish":
        for entry in entries:
            if entry.deleted_at is not None:
                continue
            if entry.pending_delete:
                mark_deleted(entry)
                affected += 1
            else:
                promote_string(entry)
                affected += 1
    elif action == "unpublish":
        for entry in entries:
            if entry.deleted_at is not None:
                continue
            if entry.status != TranslationStatus.draft:
                unpublish_string(entry)
                affected += 1
    elif action == "delete":
        for entry in entries:
            if queue_or_soft_delete(entry):
                affected += 1
    elif action == "discard_changes":
        for entry in entries:
            if discard_working_changes(entry):
                affected += 1
    elif action in ("discard_delete", "restore"):
        for entry in entries:
            if restore_string(entry):
                affected += 1
    elif action == "restore_last_history":
        from app.services.activities import restore_last_history

        affected = restore_last_history(db, project, entries)
    elif action == "move_module":
        module_id = payload.payload.get("module_id")
        mid = uuid.UUID(module_id) if module_id else None
        for entry in entries:
            entry.module_id = mid
            affected += 1
    elif action == "add_tags":
        tag_ids = [uuid.UUID(t) for t in payload.payload.get("tag_ids", [])]
        tags = db.query(Tag).filter(Tag.project_id == project.id, Tag.id.in_(tag_ids)).all()
        for entry in entries:
            existing_ids = {t.id for t in entry.tags}
            for tag in tags:
                if tag.id not in existing_ids:
                    entry.tags.append(tag)
                    affected += 1
    elif action == "remove_tags":
        tag_ids = {uuid.UUID(t) for t in payload.payload.get("tag_ids", [])}
        for entry in entries:
            before = len(entry.tags)
            entry.tags = [t for t in entry.tags if t.id not in tag_ids]
            affected += before - len(entry.tags)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    db.commit()
    return BatchResult(affected=affected, batch_id=batch_id)
