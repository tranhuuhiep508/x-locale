"""Module CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.auth import ProjectAccess
from app.database import DbSession
from app.models import Module
from app.schemas import ModuleCreate, ModuleOut, ModuleUpdate
from app.services.catalog import count_strings_by_module, to_module_out

router = APIRouter(prefix="/projects/{project_id}", tags=["modules"])


@router.get("/modules", response_model=list[ModuleOut])
def list_modules(
    project: ProjectAccess,
    db: DbSession,
) -> list[ModuleOut]:
    modules = (
        db.query(Module)
        .filter(Module.project_id == project.id)
        .order_by(Module.position, Module.slug)
        .all()
    )
    counts = count_strings_by_module(db, project.id)
    return [to_module_out(db, m, counts) for m in modules]


@router.post("/modules", response_model=ModuleOut, status_code=201)
def create_module(
    payload: ModuleCreate,
    project: ProjectAccess,
    db: DbSession,
) -> ModuleOut:
    existing = (
        db.query(Module)
        .filter(Module.project_id == project.id, Module.slug == payload.slug)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Module '{payload.slug}' already exists")
    module = Module(
        project_id=project.id,
        slug=payload.slug,
        name=payload.name,
        description=payload.description,
        position=payload.position,
    )
    db.add(module)
    db.commit()
    db.refresh(module)
    return to_module_out(db, module)


@router.patch("/modules/{module_id}", response_model=ModuleOut)
def update_module(
    module_id: uuid.UUID,
    payload: ModuleUpdate,
    project: ProjectAccess,
    db: DbSession,
) -> ModuleOut:
    module = (
        db.query(Module)
        .filter(Module.id == module_id, Module.project_id == project.id)
        .first()
    )
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    if payload.slug is not None and payload.slug != module.slug:
        clash = (
            db.query(Module)
            .filter(Module.project_id == project.id, Module.slug == payload.slug)
            .first()
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Module '{payload.slug}' already exists")
        module.slug = payload.slug
    if payload.name is not None:
        module.name = payload.name
    if payload.description is not None:
        module.description = payload.description
    if payload.position is not None:
        module.position = payload.position
    db.commit()
    db.refresh(module)
    return to_module_out(db, module)


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(
    module_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> None:
    module = (
        db.query(Module)
        .filter(Module.id == module_id, Module.project_id == project.id)
        .first()
    )
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    db.delete(module)
    db.commit()
