"""Module CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.auth import ProjectAccess
from app.database import DbSession
from app.schemas import ModuleCreate, ModuleOut, ModuleUpdate
from app.services import catalog as catalog_service

router = APIRouter(prefix="/projects/{project_id}", tags=["modules"])


@router.get("/modules", response_model=list[ModuleOut])
def list_modules(
    project: ProjectAccess,
    db: DbSession,
) -> list[ModuleOut]:
    return catalog_service.list_modules(db, project)


@router.post("/modules", response_model=ModuleOut, status_code=201)
def create_module(
    payload: ModuleCreate,
    project: ProjectAccess,
    db: DbSession,
) -> ModuleOut:
    return catalog_service.create_module(db, project, payload)


@router.patch("/modules/{module_id}", response_model=ModuleOut)
def update_module(
    module_id: uuid.UUID,
    payload: ModuleUpdate,
    project: ProjectAccess,
    db: DbSession,
) -> ModuleOut:
    return catalog_service.update_module(db, project, module_id, payload)


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(
    module_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> None:
    catalog_service.delete_module(db, project, module_id)
