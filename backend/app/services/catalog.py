"""Module and tag serialization helpers."""

from __future__ import annotations

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Module, StringEntry, StringTag, Tag
from app.schemas import ModuleOut, TagOut


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
        .filter(StringEntry.project_id == project_id, StringEntry.module_id.isnot(None))
        .group_by(StringEntry.module_id)
        .all()
    )
    return {module_id: n for module_id, n in rows if module_id is not None}


def count_strings_by_tag(db: Session, project_id: uuid.UUID) -> dict[uuid.UUID, int]:
    rows = (
        db.query(StringTag.tag_id, func.count(StringTag.string_id))
        .join(Tag, Tag.id == StringTag.tag_id)
        .filter(Tag.project_id == project_id)
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
            .filter(StringEntry.module_id == module.id)
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
            .filter(StringTag.tag_id == tag.id)
            .scalar()
            or 0
        )
    return tag_out(tag, n)
