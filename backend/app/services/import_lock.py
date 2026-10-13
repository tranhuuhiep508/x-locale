"""Serialize imports and undo without locking the project row."""

import uuid

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

IMPORT_LOCK_NAMESPACE = 0x584C494D


def _lock_params(project_id: uuid.UUID) -> dict[str, object]:
    return {"namespace": IMPORT_LOCK_NAMESPACE, "project_uuid": str(project_id)}


def wait_for_import_lock(db: Session, project_id: uuid.UUID) -> None:
    """Block until this transaction holds the project's import lock (background jobs)."""
    db.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, hashtext(:project_uuid))"),
        _lock_params(project_id),
    )


def acquire_import_lock(db: Session, project_id: uuid.UUID) -> None:
    acquired = db.scalar(
        text("SELECT pg_try_advisory_xact_lock(:namespace, hashtext(:project_uuid))"),
        _lock_params(project_id),
    )
    if not acquired:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "import_in_progress",
                "message": (
                    "An import is already running for this project, try again when it finishes."
                ),
            },
        )
