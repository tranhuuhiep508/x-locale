"""Shared snapshot projection and validation for history and undo.

Projection is read-only: previews and writes calculate the same destination,
including translation rows added after the selected history version.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import StringEntry, Tag
from app.services.catalog import require_module_in_project


def translation_map(raw: Any, *, published: bool = False) -> dict:
    if isinstance(raw, list):
        raw = {
            item["locale"]: item.get("value")
            for item in raw
            if isinstance(item, dict) and item.get("locale")
        }
    if not isinstance(raw, dict):
        return {}
    values = {}
    for locale, value in raw.items():
        if isinstance(value, dict):
            value = value.get("value")
        values[str(locale)] = value if published else value or ""
    return values


def normalized_time(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def project_snapshot(
    db: Session,
    project_id: uuid.UUID,
    current: dict,
    historical: dict,
    *,
    full_state: bool = False,
) -> dict:
    target = deepcopy(current)
    fields = ["key", "source_text", "description"]
    if full_state:
        fields += [
            "status",
            "published_key",
            "published_source_text",
            "published_at",
            "pending_delete",
            "deleted_at",
        ]
    for name in fields:
        if name in historical:
            target[name] = historical[name]
            if name in {"published_at", "deleted_at"}:
                parsed = normalized_time(target[name])
                target[name] = parsed.isoformat() if parsed else None
    for name in ["module_id"] + (["published_module_id"] if full_state else []):
        if name in historical:
            raw = historical[name]
            try:
                mid = uuid.UUID(str(raw)) if raw else None
            except ValueError, TypeError:
                mid = None
            resolved = require_module_in_project(db, project_id, mid, on_missing="clear")
            target[name] = str(resolved) if resolved else None
    if "tag_ids" in historical:
        ids = []
        for raw in historical["tag_ids"] or []:
            try:
                ids.append(uuid.UUID(str(raw)))
            except ValueError, TypeError:
                continue
        tags = db.query(Tag).filter(Tag.project_id == project_id, Tag.id.in_(ids)).all()
        tags.sort(key=lambda tag: str(tag.id))
        target["tag_ids"] = [str(tag.id) for tag in tags]
        target["tag_names"] = [tag.name for tag in tags]
    for name in ["translations"] + (["published_translations"] if full_state else []):
        if name not in historical:
            continue
        published = name == "published_translations"
        old = translation_map(historical[name], published=published)
        live = translation_map(current.get(name), published=published)
        target[name] = {
            locale: old.get(locale, None if published else "")
            for locale in sorted(set(live) | set(old))
        }
    return target


def snapshots_match(current: dict | None, expected: dict | None) -> bool:
    """Compare recorded fields, including additional nonempty locale values."""
    if current is None or expected is None:
        return current is expected
    ignored = {"id", "project_id", "tag_names"}
    for name, value in expected.items():
        if name in ignored:
            continue
        live = current.get(name)
        if name in {"translations", "published_translations"}:
            published = name == "published_translations"
            left = translation_map(live, published=published)
            right = translation_map(value, published=published)
            default = None if published else ""
            if any(
                left.get(loc, default) != right.get(loc, default) for loc in set(left) | set(right)
            ):
                return False
        elif name in {"published_at", "deleted_at"}:
            if normalized_time(live) != normalized_time(value):
                return False
        elif name == "tag_ids":
            if sorted(live or []) != sorted(value or []):
                return False
        elif live != value:
            return False
    return True


def key_conflict_message(key: str) -> str:
    return f"Key '{key}' is already used by another string."


def key_conflict(key: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "key_conflict", "message": key_conflict_message(key), "key": key},
    )


def check_key_available(
    db: Session, project_id: uuid.UUID, string_id: uuid.UUID, target: dict
) -> None:
    if target.get("deleted_at") or "key" not in target:
        return
    owner = (
        db.query(StringEntry.id)
        .filter(
            StringEntry.project_id == project_id,
            StringEntry.key == target["key"],
            StringEntry.deleted_at.is_(None),
            StringEntry.id != string_id,
        )
        .first()
    )
    if owner:
        raise key_conflict(target["key"])


def is_key_integrity_error(error: IntegrityError) -> bool:
    diagnostic = getattr(error.orig, "diag", None)
    if getattr(diagnostic, "constraint_name", None) == "uq_project_key_alive":
        return True
    return "UNIQUE constraint failed: strings.project_id, strings.key" in str(error.orig)


@contextmanager
def restore_transaction(db: Session):
    """Roll back all writes/markers on failure, including uniqueness races."""
    try:
        yield
    except IntegrityError as error:
        key = db.info.get("restore_key", "")
        db.rollback()
        if is_key_integrity_error(error):
            raise key_conflict(key) from error
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.info.pop("restore_key", None)
