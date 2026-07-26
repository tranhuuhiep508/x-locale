from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project


def get_project_by_api_key(
    api_key: str = Query(..., description="Project API key"),
    db: Session = Depends(get_db),
) -> Project:
    project = db.query(Project).filter(Project.api_key == api_key).first()
    if not project:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return project
