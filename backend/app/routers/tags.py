"""Tag CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import project_access
from app.database import get_db
from app.models import Project, StringTag, Tag
from app.schemas import TagCreate, TagOut, TagUpdate

router = APIRouter(tags=["tags"])


def _tag_out(db: Session, tag: Tag) -> TagOut:
    count = db.query(StringTag).filter(StringTag.tag_id == tag.id).count()
    return TagOut(id=tag.id, name=tag.name, color=tag.color, string_count=count)


@router.get("/projects/{project_id}/tags", response_model=list[TagOut])
def list_tags(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> list[TagOut]:
    tags = db.query(Tag).filter(Tag.project_id == project.id).order_by(Tag.name).all()
    return [_tag_out(db, t) for t in tags]


@router.post("/projects/{project_id}/tags", response_model=TagOut, status_code=201)
def create_tag(
    project_id: uuid.UUID,
    payload: TagCreate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
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
    return _tag_out(db, tag)


@router.patch("/projects/{project_id}/tags/{tag_id}", response_model=TagOut)
def update_tag(
    project_id: uuid.UUID,
    tag_id: uuid.UUID,
    payload: TagUpdate,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
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
    return _tag_out(db, tag)


@router.delete("/projects/{project_id}/tags/{tag_id}", status_code=204)
def delete_tag(
    project_id: uuid.UUID,
    tag_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> None:
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.project_id == project.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()
