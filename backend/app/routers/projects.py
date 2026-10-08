"""Project CRUD, membership, and API key management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.auth import CurrentUser, MemberApi, ProjectAccess, SessionAdmin, SessionMember
from app.database import DbSession
from app.models import ApiKey, MemberRole
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    MemberCreate,
    MemberOut,
    MemberUpdate,
    ProjectCoverageOut,
    ProjectCreate,
    ProjectDelete,
    ProjectOut,
    ProjectSummaryOut,
    ProjectUpdate,
)
from app.services import members as members_service
from app.services import projects as projects_service
from app.services import strings as strings_service
from app.services.members import role_name

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectSummaryOut])
def list_projects(
    user: CurrentUser,
    db: DbSession,
) -> list[ProjectOut]:
    return projects_service.list_projects(db, user)


@router.post("", response_model=ProjectSummaryOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    user: CurrentUser,
    db: DbSession,
) -> ProjectOut:
    return projects_service.create_project(db, payload, user)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    access: SessionMember,
    db: DbSession,
) -> ProjectOut:
    return projects_service.to_project_out(db, access.project, role=role_name(access.member.role))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    payload: ProjectUpdate,
    access: SessionAdmin,
    db: DbSession,
) -> ProjectOut:
    return projects_service.update_project(
        db, access.project.id, payload, role=role_name(access.member.role)
    )


@router.get("/{project_id}/coverage")
def get_project_coverage(project: ProjectAccess, db: DbSession) -> ProjectCoverageOut:
    return strings_service.project_coverage(db, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    access: SessionAdmin,
    db: DbSession,
    payload: ProjectDelete | None = None,
) -> None:
    confirm_slug = payload.confirm_slug if payload is not None else None
    projects_service.delete_project(db, access.project, confirm_slug)


@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(access: MemberApi, db: DbSession) -> list[MemberOut]:
    return members_service.list_members(db, access.project.id)


@router.post("/{project_id}/members", response_model=MemberOut, status_code=201)
def add_member(
    payload: MemberCreate,
    access: SessionAdmin,
    db: DbSession,
) -> MemberOut:
    return members_service.add_member(
        db, access.project.id, payload.email, MemberRole(payload.role)
    )


@router.patch("/{project_id}/members/{user_id}", response_model=MemberOut)
def update_member(
    user_id: uuid.UUID,
    payload: MemberUpdate,
    access: SessionAdmin,
    db: DbSession,
) -> MemberOut:
    return members_service.set_member_role(
        db, access.project.id, user_id, MemberRole(payload.role)
    )


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(
    user_id: uuid.UUID,
    access: SessionAdmin,
    db: DbSession,
) -> None:
    members_service.remove_member(db, access.project.id, user_id)


@router.get("/{project_id}/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(
    access: SessionMember,
    db: DbSession,
) -> list[ApiKey]:
    return projects_service.list_api_keys(db, access.project.id)


@router.post("/{project_id}/api-keys", response_model=ApiKeyCreated, status_code=201)
def create_api_key(
    payload: ApiKeyCreate,
    access: SessionMember,
    db: DbSession,
) -> ApiKeyCreated:
    return projects_service.create_api_key(db, access.project.id, payload, access.user)


@router.delete("/{project_id}/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    key_id: uuid.UUID,
    access: SessionMember,
    db: DbSession,
) -> None:
    projects_service.revoke_api_key(db, access.project.id, key_id)
