"""Module CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, project_access
from app.database import get_db
from app.models import Module, Project, StringEntry
from app.schemas import ModuleCreate, ModuleOut, ModuleUpdate

router = APIRouter(tags=["modules"])


def _module_out(db: Session, module: Module) -> ModuleOut:
    count = db.query(StringEntry).filter(StringEntry.module_id == module.id).count()
    return ModuleOut(
        id=module.id,
        slug=module.slug,
        name=module.name,
        description=module.description,
        position=module.position,
        string_count=count,
    )


@router.get("/projects/{project_id}/modules", response_model=list[ModuleOut])
def list_modules(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> list[ModuleOut]:
    modules = (
        db.query(Module)
        .filter(Module.project_id == project.id)
        .order_by(Module.position, Module.slug)
        .all()
    )
    return [_module_out(db, m) for m in modules]


@router.post("/projects/{project_id}/modules", response_model=ModuleOut, status_code=201)
def create_module(
    project_id: uuid.UUID,
    payload: ModuleCreate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
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
    return _module_out(db, module)


@router.patch("/projects/{project_id}/modules/{module_id}", response_model=ModuleOut)
def update_module(
    project_id: uuid.UUID,
    module_id: uuid.UUID,
    payload: ModuleUpdate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
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
    return _module_out(db, module)


@router.delete("/projects/{project_id}/modules/{module_id}", status_code=204)
def delete_module(
    project_id: uuid.UUID,
    module_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
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
