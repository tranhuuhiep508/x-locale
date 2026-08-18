"""Project CRUD + API key management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.auth import CurrentUser
from app.database import DbSession
from app.models import ApiKey
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)
from app.services import projects as projects_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user: CurrentUser,
    db: DbSession,
) -> list[ProjectOut]:
    return projects_service.list_projects(db)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.create_project(db, payload, user)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.to_project_out(db, projects_service.get_project(db, project_id))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.update_project(db, project_id, payload)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    projects_service.delete_project(db, project_id)


@router.get("/{project_id}/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> list[ApiKey]:
    return projects_service.list_api_keys(db, project_id)


@router.post("/{project_id}/api-keys", response_model=ApiKeyCreated, status_code=201)
def create_api_key(
    project_id: uuid.UUID,
    payload: ApiKeyCreate,
    user: CurrentUser,
    db: DbSession,
) -> ApiKeyCreated:
    return projects_service.create_api_key(db, project_id, payload, user)


@router.delete("/{project_id}/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    project_id: uuid.UUID,
    key_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    projects_service.revoke_api_key(db, project_id, key_id)
