"""Project key identity, shared by editing, imports, and history operations."""

from __future__ import annotations

import uuid
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import String, any_, bindparam
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from app.models import Module, Project, StringEntry

KEY_POLICY_FK = "fk_strings_key_policy"
KEY_CONSTRAINTS = {"uq_project_key_alive", "uq_project_module_key_alive"}


def key_identity(allow_duplicates: bool, key: str, module_id=None) -> tuple[str | None, str]:
    return (str(module_id) if allow_duplicates and module_id is not None else None, key)


def project_key_policy(db: Session, project_id: uuid.UUID) -> bool:
    return bool(db.query(Project.allow_duplicate_keys).filter(Project.id == project_id).scalar())


def key_owner(db: Session, project_id: uuid.UUID, key: str, module_id=None, *, exclude=None):
    query = db.query(StringEntry.id).filter(
        StringEntry.project_id == project_id,
        StringEntry.key == key,
        StringEntry.deleted_at.is_(None),
    )
    if project_key_policy(db, project_id):
        query = query.filter(StringEntry.module_id == module_id)
    if exclude is not None:
        query = query.filter(StringEntry.id != exclude)
    return query.first()


def load_key_owners(db: Session, project_id: uuid.UUID, *, keys=None) -> dict:
    allow = project_key_policy(db, project_id)
    query = db.query(StringEntry.key, StringEntry.id, StringEntry.module_id).filter(
        StringEntry.project_id == project_id, StringEntry.deleted_at.is_(None)
    )
    if keys is not None:
        query = query.filter(
            StringEntry.key == any_(bindparam("undo_keys", sorted(keys), type_=ARRAY(String)))
        )
    return {key_identity(allow, key, mid): sid for key, sid, mid in query.all()}


def duplicate_key_details(db: Session, project_id: uuid.UUID) -> list[dict]:
    rows = (
        db.query(StringEntry.key, Module.slug)
        .outerjoin(Module, StringEntry.module_id == Module.id)
        .filter(StringEntry.project_id == project_id, StringEntry.deleted_at.is_(None))
        .all()
    )
    modules = defaultdict(list)
    for key, slug in rows:
        modules[key].append(slug or "_unassigned")
    return [
        {"key": key, "modules": sorted(slugs)}
        for key, slugs in sorted(modules.items())
        if len(slugs) > 1
    ]


def ambiguous_key(key: str, *, export: bool = False) -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "ambiguous_key",
            "message": (
                f"Key '{key}' appears more than once in this export. Use modular files or resolve the collision."
                if export
                else f"Key '{key}' matches more than one module. Use a module-scoped import."
            ),
            "key": key,
        },
    )


def key_policy_conflict() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "concurrent_modification",
            "message": "The project key setting changed. Please retry.",
            "retryable": True,
        },
    )


def is_key_policy_error(error) -> bool:
    orig = getattr(error, "orig", None)
    return (
        getattr(orig, "sqlstate", None) == "23503"
        and getattr(getattr(orig, "diag", None), "constraint_name", None) == KEY_POLICY_FK
    )
