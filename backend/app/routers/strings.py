"""Strings CRUD with filtering, pagination, and translation upsert."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.auth import ProjectAccess
from app.database import DbSession
from app.helpers import (
    apply_translation_values,
    ensure_translation_rows,
    serialize_string,
    string_query,
)
from app.models import StringEntry, Tag, Translation, TranslationStatus
from app.schemas import (
    StringCreate,
    StringListOut,
    StringOut,
    StringUpdate,
    TranslationUpdate,
)
from app.services.strings import get_string, validate_locales

router = APIRouter(prefix="/projects/{project_id}", tags=["strings"])


@router.get("/strings", response_model=StringListOut)
def list_strings(
    project: ProjectAccess,
    db: DbSession,
    module: Annotated[uuid.UUID | None, Query(alias="module")] = None,
    tag: Annotated[uuid.UUID | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    missing_locale: Annotated[str | None, Query()] = None,
    status: Annotated[TranslationStatus | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
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


@router.post("/strings", response_model=StringOut, status_code=201)
def create_string(
    payload: StringCreate,
    project: ProjectAccess,
    db: DbSession,
) -> StringOut:
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


@router.get("/strings/{string_id}", response_model=StringOut)
def get_string_endpoint(
    string_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> StringOut:
    return serialize_string(get_string(db, project.id, string_id))


@router.patch("/strings/{string_id}", response_model=StringOut)
def update_string(
    string_id: uuid.UUID,
    payload: StringUpdate,
    project: ProjectAccess,
    db: DbSession,
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


@router.put(
    "/strings/{string_id}/translations/{locale}",
    response_model=StringOut,
)
def upsert_translation(
    string_id: uuid.UUID,
    locale: str,
    payload: TranslationUpdate,
    project: ProjectAccess,
    db: DbSession,
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


@router.delete("/strings/{string_id}", status_code=204)
def delete_string(
    string_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> None:
    entry = get_string(db, project.id, string_id)
    db.delete(entry)
    db.commit()
