"""Project CRUD + API key management."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path

from app.auth import CurrentUser
from app.database import DbSession
from app.helpers import resolve_project_ref
from app.models import ApiKey
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    ProjectCreate,
    ProjectOut,
    ProjectSummaryOut,
    ProjectUpdate,
)
from app.services import projects as projects_service

router = APIRouter(prefix="/projects", tags=["projects"])
ProjectRef = Annotated[str, Path(description="Project UUID or immutable slug")]


@router.get("", response_model=list[ProjectSummaryOut])
def list_projects(
    user: CurrentUser,
    db: DbSession,
) -> list[ProjectOut]:
    return projects_service.list_projects(db)


@router.post("", response_model=ProjectSummaryOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.create_project(db, payload, user)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: ProjectRef,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.to_project_out(db, resolve_project_ref(db, project_id))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: ProjectRef,
    payload: ProjectUpdate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.update_project(db, resolve_project_ref(db, project_id).id, payload)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: ProjectRef,
    user: CurrentUser,
    db: DbSession,
) -> None:
    projects_service.delete_project(db, resolve_project_ref(db, project_id).id)


@router.get("/{project_id}/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(
    project_id: ProjectRef,
    user: CurrentUser,
    db: DbSession,
) -> list[ApiKey]:
    return projects_service.list_api_keys(db, resolve_project_ref(db, project_id).id)


@router.post("/{project_id}/api-keys", response_model=ApiKeyCreated, status_code=201)
def create_api_key(
    project_id: ProjectRef,
    payload: ApiKeyCreate,
    user: CurrentUser,
    db: DbSession,
) -> ApiKeyCreated:
    return projects_service.create_api_key(db, resolve_project_ref(db, project_id).id, payload, user)


@router.delete("/{project_id}/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    project_id: ProjectRef,
    key_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    projects_service.revoke_api_key(db, resolve_project_ref(db, project_id).id, key_id)
