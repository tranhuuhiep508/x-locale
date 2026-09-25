"""Project CRUD, serialization, and API keys."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import generate_api_key
from app.config import settings
from app.helpers import ensure_unique_slug, slugify, validate_locale_code
from app.models import ApiKey, Project, StringEntry, User
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)


def project_out(project: Project, string_count: int) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        slug=project.slug,
        base_language=project.base_language,
        target_languages=project.target_languages or [],
        layout=project.layout,
        string_count=string_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def count_strings(db: Session, project_id: uuid.UUID) -> int:
    return (
        db.query(func.count(StringEntry.id))
        .filter(StringEntry.project_id == project_id, StringEntry.deleted_at.is_(None))
        .scalar()
        or 0
    )


def count_strings_by_project(db: Session) -> dict[uuid.UUID, int]:
    rows = (
        db.query(StringEntry.project_id, func.count(StringEntry.id))
        .filter(StringEntry.deleted_at.is_(None))
        .group_by(StringEntry.project_id)
        .all()
    )
    return {project_id: n for project_id, n in rows}


def to_project_out(
    db: Session,
    project: Project,
    counts: dict[uuid.UUID, int] | None = None,
) -> ProjectOut:
    if counts is not None:
        n = counts.get(project.id, 0)
    else:
        n = count_strings(db, project.id)
    return project_out(project, n)


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def list_projects(db: Session) -> list[ProjectOut]:
    projects = db.query(Project).order_by(Project.name).all()
    counts = count_strings_by_project(db)
    return [to_project_out(db, p, counts) for p in projects]


def _validated_locales(base: str, targets: list[str]) -> tuple[str, list[str]]:
    base_lang = validate_locale_code(base)
    seen: set[str] = set()
    target_langs: list[str] = []
    for loc in targets:
        code = validate_locale_code(loc)
        if code in seen:
            continue
        seen.add(code)
        target_langs.append(code)
    return base_lang, target_langs


def create_project(db: Session, payload: ProjectCreate, user: User) -> ProjectOut:
    slug = payload.slug or slugify(payload.name)
    slug = ensure_unique_slug(db, slug)
    base = payload.base_language or settings.default_base_language
    try:
        base_lang, target_langs = _validated_locales(base, payload.target_languages)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    project = Project(
        name=payload.name,
        slug=slug,
        base_language=base_lang,
        target_languages=target_langs,
        layout=payload.layout,
        created_by=user.id,
    )
    db.add(project)
    db.flush()
    db.commit()
    db.refresh(project)
    return to_project_out(db, project)


def update_project(db: Session, project_id: uuid.UUID, payload: ProjectUpdate) -> ProjectOut:
    project = get_project(db, project_id)
    if payload.name is not None:
        project.name = payload.name
    if payload.slug is not None:
        project.slug = ensure_unique_slug(db, payload.slug, exclude_id=project.id)
    if payload.base_language is not None or payload.target_languages is not None:
        base = payload.base_language if payload.base_language is not None else project.base_language
        targets = (
            payload.target_languages
            if payload.target_languages is not None
            else (project.target_languages or [])
        )
        try:
            base_lang, target_langs = _validated_locales(base, targets)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        project.base_language = base_lang
        project.target_languages = target_langs
    if payload.layout is not None:
        project.layout = payload.layout
    db.commit()
    db.refresh(project)
    return to_project_out(db, project)


def delete_project(db: Session, project_id: uuid.UUID) -> None:
    project = get_project(db, project_id)
    db.delete(project)
    db.commit()


def list_api_keys(db: Session, project_id: uuid.UUID) -> list[ApiKey]:
    get_project(db, project_id)
    return (
        db.query(ApiKey)
        .filter(ApiKey.project_id == project_id, ApiKey.revoked_at.is_(None))
        .order_by(ApiKey.created_at.desc())
        .all()
    )


def create_api_key(
    db: Session,
    project_id: uuid.UUID,
    payload: ApiKeyCreate,
    user: User,
) -> ApiKeyCreated:
    project = get_project(db, project_id)
    now = datetime.now(UTC)
    previous = (
        db.query(ApiKey)
        .filter(
            ApiKey.project_id == project.id,
            ApiKey.created_by == user.id,
            ApiKey.revoked_at.is_(None),
        )
        .all()
    )
    for old in previous:
        old.revoked_at = now
    raw, prefix, key_hash = generate_api_key()
    api_key = ApiKey(
        project_id=project.id,
        name=payload.name,
        key_prefix=prefix,
        key_hash=key_hash,
        created_by=user.id,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return ApiKeyCreated(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        created_at=api_key.created_at,
        last_used_at=api_key.last_used_at,
        revoked_at=api_key.revoked_at,
        key=raw,
    )


def revoke_api_key(db: Session, project_id: uuid.UUID, key_id: uuid.UUID) -> None:
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.id == key_id, ApiKey.project_id == project_id)
        .first()
    )
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.revoked_at = datetime.now(UTC)
    db.commit()

