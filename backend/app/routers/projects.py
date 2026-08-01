"""Project CRUD + API key management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, generate_api_key, set_activity_context, AuthContext
from app.config import settings
from app.database import get_db
from app.helpers import ensure_unique_slug, slugify
from app.models import ApiKey, Project, StringEntry, User
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _project_out(db: Session, project: Project) -> ProjectOut:
    count = db.query(StringEntry).filter(StringEntry.project_id == project.id).count()
    return ProjectOut(
        id=project.id,
        name=project.name,
        slug=project.slug,
        base_language=project.base_language,
        target_languages=project.target_languages or [],
        layout=project.layout,
        string_count=count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> list[ProjectOut]:
    projects = db.query(Project).order_by(Project.name).all()
    return [_project_out(db, p) for p in projects]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    user: CurrentUser,
    db: Session = Depends(get_db),
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
    return _project_out(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_out(db, project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: CurrentUser,
    db: Session = Depends(get_db),
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
    return _project_out(db, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
) -> None:
    from datetime import UTC, datetime

    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.id == key_id, ApiKey.project_id == project_id)
        .first()
    )
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.revoked_at = datetime.now(UTC)
    db.commit()
