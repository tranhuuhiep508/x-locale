"""Project serialization helpers."""

from __future__ import annotations

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Project, StringEntry
from app.schemas import ProjectOut


def project_out(project: Project, string_count: int) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        slug=project.slug,
        base_language=project.base_language,
        target_languages=project.target_languages or [],
        layout=project.layout,
        string_count=string_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def count_strings(db: Session, project_id: uuid.UUID) -> int:
    return (
        db.query(func.count(StringEntry.id))
        .filter(StringEntry.project_id == project_id)
        .scalar()
        or 0
    )


def count_strings_by_project(db: Session) -> dict[uuid.UUID, int]:
    rows = (
        db.query(StringEntry.project_id, func.count(StringEntry.id))
        .group_by(StringEntry.project_id)
        .all()
    )
    return {project_id: n for project_id, n in rows}


def to_project_out(
    db: Session,
    project: Project,
    counts: dict[uuid.UUID, int] | None = None,
) -> ProjectOut:
    if counts is not None:
        n = counts.get(project.id, 0)
    else:
        n = count_strings(db, project.id)
    return project_out(project, n)
