"""Bootstrap endpoint — CLI project discovery via API key."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import ProjectFromApiKey
from app.database import get_db
from app.models import Project, StringEntry
from app.schemas import ProjectOut

router = APIRouter(tags=["bootstrap"])


def _project_out(db: Session, project: Project) -> ProjectOut:
    count = db.query(StringEntry).filter(StringEntry.project_id == project.id).count()
    return ProjectOut(
        id=project.id,
        name=project.name,
        slug=project.slug,
        base_language=project.base_language,
        target_languages=project.target_languages or [],
        layout=project.layout,
        string_count=count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("/bootstrap", response_model=ProjectOut)
def bootstrap(
    project: ProjectFromApiKey,
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Return the project associated with the supplied API key.

    Used by the CLI ``tms init`` command to discover the project without
    needing the project UUID up-front.
    """
    return _project_out(db, project)
