"""String lookup, listing, CRUD, locale checks, and batch mutations."""

from __future__ import annotations

import uuid
from typing import Sequence

from fastapi import HTTPException
from sqlalchemy import or_
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


def serialize_string(entry: StringEntry) -> StringOut:
    return StringOut(
        id=entry.id,
        key=entry.key,
        source_text=entry.source_text,
        description=entry.description,
        status=entry.status,
        module_id=entry.module_id,
        module_slug=entry.module.slug if entry.module else None,
        tags=[
            TagOut(id=t.id, name=t.name, color=t.color, string_count=0) for t in (entry.tags or [])
        ],
        updated_at=entry.updated_at,
        translations=[
            TranslationOut(
                id=t.id,
                locale=t.locale,
                value=t.value,
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
) -> None:
    """Upsert locale values on an entry. Caller must validate locales."""
    by_locale = {t.locale: t for t in entry.translations}
    for locale, value in translations.items():
        existing = by_locale.get(locale)
        if existing is None:
            translation = Translation(
                string_id=entry.id,
                locale=locale,
                value=value,
            )
            db.add(translation)
            entry.translations.append(translation)
        else:
            existing.value = value


def string_query(
    db: Session,
    project_id: uuid.UUID,
    *,
    module_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    q: str | None = None,
    missing_locale: str | None = None,
    status: TranslationStatus | None = None,
):
    query = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
        )
        .filter(StringEntry.project_id == project_id)
    )
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
        status=payload.status,
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
        apply_translation_values(db, entry, payload.translations)
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
    if payload.status is not None:
        entry.status = payload.status
    if payload.translations is not None:
        validate_locales(project, payload.translations)
        ensure_translation_rows(db, entry, project)
        apply_translation_values(db, entry, payload.translations)
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
        )
        db.add(translation)
    else:
        translation.value = payload.value
    db.commit()
    return serialize_string(get_string(db, project.id, string_id))


def delete_string(db: Session, project: Project, string_id: uuid.UUID) -> None:
    entry = get_string(db, project.id, string_id)
    db.delete(entry)
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
        .options(joinedload(StringEntry.translations), joinedload(StringEntry.tags))
        .filter(StringEntry.project_id == project.id, StringEntry.id.in_(ids))
        .all()
    )

    affected = 0
    action = payload.action

    if action == "publish":
        for entry in entries:
            if entry.status != TranslationStatus.public:
                entry.status = TranslationStatus.public
                affected += 1
    elif action == "unpublish":
        for entry in entries:
            if entry.status != TranslationStatus.draft:
                entry.status = TranslationStatus.draft
                affected += 1
    elif action == "delete":
        for entry in entries:
            db.delete(entry)
            affected += 1
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
