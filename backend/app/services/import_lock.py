"""Serialize imports and undo without locking the project row."""

import uuid

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

IMPORT_LOCK_NAMESPACE = 0x584C494D


def _lock_params(project_id: uuid.UUID) -> dict[str, object]:
    return {"namespace": IMPORT_LOCK_NAMESPACE, "project_uuid": str(project_id)}


def _busy() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "import_in_progress",
            "message": "An import is already running for this project, try again when it finishes.",
        },
    )


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
        raise _busy()


def acquire_import_session_lock(db: Session, project_id: uuid.UUID) -> None:
    """Block until this connection holds the session lock.

    The lock survives commit and is released on unlock or when the connection closes.
    """
    db.execute(
        text("SELECT pg_advisory_lock(:namespace, hashtext(:project_uuid))"),
        _lock_params(project_id),
    )


def import_lock_waiting(db: Session, project_id: uuid.UUID) -> bool:
    """True when another session is blocked on this project's import lock."""
    waiting = db.scalar(
        text(
            """
            SELECT EXISTS (
                SELECT 1 FROM pg_locks
                WHERE locktype = 'advisory'
                  AND classid = CAST(:namespace AS oid)
                  AND objid = hashtext(:project_uuid)::oid
                  AND NOT granted
            )
            """
        ),
        _lock_params(project_id),
    )
    return bool(waiting)
