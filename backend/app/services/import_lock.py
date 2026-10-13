"""Serialize imports and undo without locking the project row."""

import uuid

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

IMPORT_LOCK_NAMESPACE = 0x584C494D


def acquire_import_lock(db: Session, project_id: uuid.UUID) -> None:
    acquired = db.scalar(
        text("SELECT pg_try_advisory_xact_lock(:namespace, hashtext(:project_uuid))"),
        {"namespace": IMPORT_LOCK_NAMESPACE, "project_uuid": str(project_id)},
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
