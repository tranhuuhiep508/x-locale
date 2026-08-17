"""Tag CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.auth import ProjectAccess
from app.database import DbSession
from app.models import Tag
from app.schemas import TagCreate, TagOut, TagUpdate
from app.services.catalog import count_strings_by_tag, to_tag_out

router = APIRouter(prefix="/projects/{project_id}", tags=["tags"])


@router.get("/tags", response_model=list[TagOut])
def list_tags(
    project: ProjectAccess,
    db: DbSession,
) -> list[TagOut]:
    tags = db.query(Tag).filter(Tag.project_id == project.id).order_by(Tag.name).all()
    counts = count_strings_by_tag(db, project.id)
    return [to_tag_out(db, t, counts) for t in tags]


@router.post("/tags", response_model=TagOut, status_code=201)
def create_tag(
    payload: TagCreate,
    project: ProjectAccess,
    db: DbSession,
) -> TagOut:
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


@router.patch("/tags/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: uuid.UUID,
    payload: TagUpdate,
    project: ProjectAccess,
    db: DbSession,
) -> TagOut:
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.project_id == project.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if payload.name is not None:
        tag.name = payload.name
    if payload.color is not None:
        tag.color = payload.color
    db.commit()
    db.refresh(tag)
    return to_tag_out(db, tag)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(
    tag_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> None:
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.project_id == project.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()
