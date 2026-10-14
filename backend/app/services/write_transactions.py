"""Bounded retries of complete writes whose failed transaction was rolled back."""

from __future__ import annotations

import logging
import random
import time
import uuid
from collections.abc import Callable

from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.models import Project

logger = logging.getLogger(__name__)
MODULE_REFERENCE_CONSTRAINTS = frozenset(
    {
        "strings_module_id_fkey",
        "fk_strings_published_module_id_modules",
        # Legacy create_all databases predate the ORM's explicit constraint name.
        "strings_published_module_id_fkey",
    }
)


def retryable_write_code(error: DBAPIError, *, restore: bool) -> str | None:
    orig = error.orig
    if getattr(orig, "sqlstate", None) == "40P01":
        return "concurrent_modification"
    if (
        restore
        and isinstance(error, IntegrityError)
        and getattr(orig, "sqlstate", None) == "23503"
        and getattr(getattr(orig, "diag", None), "constraint_name", None)
        in MODULE_REFERENCE_CONSTRAINTS
    ):
        return "module_reference_conflict"
    return None


def retryable_write_conflict(code: str) -> HTTPException:
    message = (
        "A referenced module changed. Please retry the operation."
        if code == "module_reference_conflict"
        else "A concurrent operation conflicted. Please retry the operation."
    )
    return HTTPException(
        status_code=409, detail={"code": code, "message": message, "retryable": True}
    )


def run_write[T](
    db: Session,
    project_id: uuid.UUID,
    operation: str,
    write: Callable[[], T],
    *,
    restore: bool = False,
    commit: bool = True,
) -> T:
    """Own the commit; callbacks reload inputs and must never commit themselves.

    ``commit=False`` leaves the successful write open so the caller can commit
    it with another change (a background job's completed status).

    Only explicit Postgres errors proving a failed transaction are replayed.
    Response construction belongs to the caller, outside this retry boundary.
    """
    actor = dict(db.info.get("activity") or {})

    def reset_context() -> None:
        db.info["activity"] = dict(actor)
        db.info.pop("restore_key", None)
        db.info.pop("_x_locale_restore_intent", None)

    for attempt in (1, 2):
        try:
            if attempt == 2:
                reauthorize = db.info.get("retry_project_access")
                if reauthorize is not None:
                    reauthorize()
                elif db.get(Project, project_id) is None:
                    # Trusted internal service calls have no HTTP auth dependency.
                    raise HTTPException(status_code=404, detail="Project not found")
            result = write()
            if commit:
                db.commit()
        except DBAPIError as error:
            key = db.info.get("restore_key", "")
            db.rollback()
            db.expire_all()
            reset_context()
            code = retryable_write_code(error, restore=restore)
            if code is not None:
                logger.warning(
                    "Write %s operation=%s project_id=%s attempt=%s sqlstate=%s",
                    "retry" if attempt == 1 else "retry exhausted",
                    operation,
                    project_id,
                    attempt,
                    getattr(error.orig, "sqlstate", None),
                )
                if attempt == 1:
                    time.sleep(random.uniform(0.05, 0.15))
                    continue
                raise retryable_write_conflict(code) from error
            if restore and isinstance(error, IntegrityError):
                from app.services.activity_state import is_key_integrity_error, key_conflict
                from app.services.catalog import is_module_project_fk_error

                if is_key_integrity_error(error):
                    raise key_conflict(key) from error
                if is_module_project_fk_error(error):
                    raise HTTPException(status_code=400, detail="Unknown module") from error
            raise
        except Exception:
            db.rollback()
            reset_context()
            raise
        else:
            reset_context()
            return result
    raise AssertionError("Unreachable retry state")
