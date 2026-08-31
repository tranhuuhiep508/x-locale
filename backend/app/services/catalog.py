"""Module and tag CRUD and serialization."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Module, Project, StringEntry, StringTag, Tag
from app.schemas import ModuleCreate, ModuleOut, ModuleUpdate, TagCreate, TagOut, TagUpdate


def module_out(module: Module, string_count: int) -> ModuleOut:
    return ModuleOut(
        id=module.id,
        slug=module.slug,
        name=module.name,
        description=module.description,
        position=module.position,
        string_count=string_count,
    )


def tag_out(tag: Tag, string_count: int) -> TagOut:
    return TagOut(id=tag.id, name=tag.name, color=tag.color, string_count=string_count)


def count_strings_by_module(db: Session, project_id: uuid.UUID) -> dict[uuid.UUID, int]:
    rows = (
        db.query(StringEntry.module_id, func.count(StringEntry.id))
        .filter(
            StringEntry.project_id == project_id,
            StringEntry.module_id.isnot(None),
            StringEntry.deleted_at.is_(None),
        )
        .group_by(StringEntry.module_id)
        .all()
    )
    return {module_id: n for module_id, n in rows if module_id is not None}


def count_strings_by_tag(db: Session, project_id: uuid.UUID) -> dict[uuid.UUID, int]:
    rows = (
        db.query(StringTag.tag_id, func.count(StringTag.string_id))
        .join(Tag, Tag.id == StringTag.tag_id)
        .join(StringEntry, StringEntry.id == StringTag.string_id)
        .filter(Tag.project_id == project_id, StringEntry.deleted_at.is_(None))
        .group_by(StringTag.tag_id)
        .all()
    )
    return {tag_id: n for tag_id, n in rows}


def to_module_out(
    db: Session,
    module: Module,
    counts: dict[uuid.UUID, int] | None = None,
) -> ModuleOut:
    if counts is not None:
        n = counts.get(module.id, 0)
    else:
        n = (
            db.query(func.count(StringEntry.id))
            .filter(StringEntry.module_id == module.id, StringEntry.deleted_at.is_(None))
            .scalar()
            or 0
        )
    return module_out(module, n)


def to_tag_out(
    db: Session,
    tag: Tag,
    counts: dict[uuid.UUID, int] | None = None,
) -> TagOut:
    if counts is not None:
        n = counts.get(tag.id, 0)
    else:
        n = (
            db.query(func.count(StringTag.string_id))
            .join(StringEntry, StringEntry.id == StringTag.string_id)
            .filter(StringTag.tag_id == tag.id, StringEntry.deleted_at.is_(None))
            .scalar()
            or 0
        )
    return tag_out(tag, n)


def list_modules(db: Session, project: Project) -> list[ModuleOut]:
    modules = (
        db.query(Module)
        .filter(Module.project_id == project.id)
        .order_by(Module.position, Module.slug)
        .all()
    )
    counts = count_strings_by_module(db, project.id)
    return [to_module_out(db, m, counts) for m in modules]


def get_module(db: Session, project_id: uuid.UUID, module_id: uuid.UUID) -> Module:
    module = (
        db.query(Module)
        .filter(Module.id == module_id, Module.project_id == project_id)
        .first()
    )
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    return module


def create_module(db: Session, project: Project, payload: ModuleCreate) -> ModuleOut:
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


def update_module(
    db: Session,
    project: Project,
    module_id: uuid.UUID,
    payload: ModuleUpdate,
) -> ModuleOut:
    module = get_module(db, project.id, module_id)
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


def delete_module(db: Session, project: Project, module_id: uuid.UUID) -> None:
    module = get_module(db, project.id, module_id)
    db.delete(module)
    db.commit()


def list_tags(db: Session, project: Project) -> list[TagOut]:
    tags = db.query(Tag).filter(Tag.project_id == project.id).order_by(Tag.name).all()
    counts = count_strings_by_tag(db, project.id)
    return [to_tag_out(db, t, counts) for t in tags]


def get_tag(db: Session, project_id: uuid.UUID, tag_id: uuid.UUID) -> Tag:
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.project_id == project_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


def create_tag(db: Session, project: Project, payload: TagCreate) -> TagOut:
    existing = (
        db.query(Tag).filter(Tag.project_id == project.id, Tag.name == payload.name).first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Tag '{payload.name}' already exists")
    tag = Tag(project_id=project.id, name=payload.name, color=payload.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return to_tag_out(db, tag)


def update_tag(db: Session, project: Project, tag_id: uuid.UUID, payload: TagUpdate) -> TagOut:
    tag = get_tag(db, project.id, tag_id)
    if payload.name is not None:
        tag.name = payload.name
    if payload.color is not None:
        tag.color = payload.color
    db.commit()
    db.refresh(tag)
    return to_tag_out(db, tag)


def delete_tag(db: Session, project: Project, tag_id: uuid.UUID) -> None:
    tag = get_tag(db, project.id, tag_id)
    db.delete(tag)
    db.commit()
