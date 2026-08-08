"""Strings CRUD with filtering, pagination, and translation upsert."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.auth import project_access
from app.database import get_db
from app.helpers import ensure_translation_rows, serialize_string, string_query
from app.models import Project, StringEntry, Tag, Translation, TranslationStatus
from app.schemas import (
    StringCreate,
    StringListOut,
    StringOut,
    StringUpdate,
    TranslationUpdate,
)

router = APIRouter(tags=["strings"])


def _get_string(db: Session, project_id: uuid.UUID, string_id: uuid.UUID) -> StringEntry:
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


@router.get("/projects/{project_id}/strings", response_model=StringListOut)
def list_strings(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    module: uuid.UUID | None = Query(default=None, alias="module"),
    tag: uuid.UUID | None = Query(default=None),
    q: str | None = Query(default=None),
    missing_locale: str | None = Query(default=None),
    status: TranslationStatus | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
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


@router.post("/projects/{project_id}/strings", response_model=StringOut, status_code=201)
def create_string(
    project_id: uuid.UUID,
    payload: StringCreate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
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

    entry = StringEntry(
        project_id=project.id,
        module_id=payload.module_id,
        key=payload.key,
        source_text=payload.source_text,
        description=payload.description,
    )
    db.add(entry)
    db.flush()
    if payload.tag_ids:
        tags = (
            db.query(Tag)
            .filter(Tag.project_id == project.id, Tag.id.in_(payload.tag_ids))
            .all()
        )
        entry.tags = tags
    ensure_translation_rows(db, entry, project)
    db.commit()
    return serialize_string(_get_string(db, project.id, entry.id))


@router.get("/projects/{project_id}/strings/{string_id}", response_model=StringOut)
def get_string(
    project_id: uuid.UUID,
    string_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> StringOut:
    return serialize_string(_get_string(db, project.id, string_id))


@router.patch("/projects/{project_id}/strings/{string_id}", response_model=StringOut)
def update_string(
    project_id: uuid.UUID,
    string_id: uuid.UUID,
    payload: StringUpdate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> StringOut:
    entry = _get_string(db, project.id, string_id)
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
    db.commit()
    return serialize_string(_get_string(db, project.id, string_id))


@router.put(
    "/projects/{project_id}/strings/{string_id}/translations/{locale}",
    response_model=StringOut,
)
def upsert_translation(
    project_id: uuid.UUID,
    string_id: uuid.UUID,
    locale: str,
    payload: TranslationUpdate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> StringOut:
    entry = _get_string(db, project.id, string_id)
    if locale not in project.target_languages and locale != project.base_language:
        raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured")

    translation = next((t for t in entry.translations if t.locale == locale), None)
    if not translation:
        translation = Translation(
            string_id=entry.id,
            locale=locale,
            value=payload.value,
            status=payload.status or TranslationStatus.draft,
        )
        db.add(translation)
    else:
        translation.value = payload.value
        if payload.status is not None:
            translation.status = payload.status
    db.commit()
    return serialize_string(_get_string(db, project.id, string_id))


@router.delete("/projects/{project_id}/strings/{string_id}", status_code=204)
def delete_string(
    project_id: uuid.UUID,
    string_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> None:
    entry = _get_string(db, project.id, string_id)
    db.delete(entry)
    db.commit()
