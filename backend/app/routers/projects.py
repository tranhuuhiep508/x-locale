"""Project CRUD + API key management."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from app.auth import CurrentUser, generate_api_key
from app.config import settings
from app.database import DbSession
from app.helpers import ensure_unique_slug, slugify
from app.models import ApiKey, Project
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)
from app.services.projects import count_strings_by_project, to_project_out

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user: CurrentUser,
    db: DbSession,
) -> list[ProjectOut]:
    projects = db.query(Project).order_by(Project.name).all()
    counts = count_strings_by_project(db)
    return [to_project_out(db, p, counts) for p in projects]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    slug = payload.slug or slugify(payload.name)
    slug = ensure_unique_slug(db, slug)
    base = payload.base_language or settings.default_base_language
    project = Project(
        name=payload.name,
        slug=slug,
        base_language=base,
        target_languages=payload.target_languages,
        layout=payload.layout,
        created_by=user.id,
    )
    db.add(project)
    db.flush()
    db.commit()
    db.refresh(project)
    return to_project_out(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return to_project_out(db, project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.name is not None:
        project.name = payload.name
    if payload.slug is not None:
        project.slug = ensure_unique_slug(db, payload.slug, exclude_id=project.id)
    if payload.base_language is not None:
        project.base_language = payload.base_language
    if payload.target_languages is not None:
        project.target_languages = payload.target_languages
    if payload.layout is not None:
        project.layout = payload.layout
    db.commit()
    db.refresh(project)
    return to_project_out(db, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()


@router.get("/{project_id}/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> list[ApiKey]:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return (
        db.query(ApiKey)
        .filter(ApiKey.project_id == project_id, ApiKey.revoked_at.is_(None))
        .order_by(ApiKey.created_at.desc())
        .all()
    )


@router.post("/{project_id}/api-keys", response_model=ApiKeyCreated, status_code=201)
def create_api_key(
    project_id: uuid.UUID,
    payload: ApiKeyCreate,
    user: CurrentUser,
    db: DbSession,
) -> ApiKeyCreated:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
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


@router.delete("/{project_id}/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    project_id: uuid.UUID,
    key_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.id == key_id, ApiKey.project_id == project_id)
        .first()
    )
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.revoked_at = datetime.now(UTC)
    db.commit()
