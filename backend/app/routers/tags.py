"""Tag CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import TagCreate, TagOut, TagUpdate
from app.services import catalog as catalog_service

router = APIRouter(prefix="/projects/{project_id}", tags=["tags"])


@router.get("/tags", response_model=list[TagOut])
def list_tags(
    project: ProjectAccess,
    db: DbSession,
) -> list[TagOut]:
    return catalog_service.list_tags(db, project)


@router.post("/tags", response_model=TagOut, status_code=201)
def create_tag(
    payload: TagCreate,
    project: ProjectAccess,
    db: DbSession,
) -> TagOut:
    return catalog_service.create_tag(db, project, payload)


@router.patch("/tags/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: uuid.UUID,
    payload: TagUpdate,
    project: ProjectAccess,
    db: DbSession,
) -> TagOut:
    return catalog_service.update_tag(db, project, tag_id, payload)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(
    tag_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> None:
    catalog_service.delete_tag(db, project, tag_id)
