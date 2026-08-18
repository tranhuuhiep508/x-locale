"""Bootstrap endpoint — CLI project discovery via API key."""

from __future__ import annotations

from fastapi import APIRouter

from app.auth import ProjectFromApiKey
from app.database import DbSession
from app.schemas import ProjectOut
from app.services.projects import to_project_out

router = APIRouter(tags=["bootstrap"])


@router.get("/bootstrap", response_model=ProjectOut)
def bootstrap(
    project: ProjectFromApiKey,
    db: DbSession,
) -> ProjectOut:
    """Return the project associated with the supplied API key."""
    return to_project_out(db, project)
