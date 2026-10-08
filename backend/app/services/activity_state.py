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

from app.models import Module, StringEntry, Tag
from app.services.catalog import is_module_project_fk_error, require_module_in_project


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
    if value is None or (isinstance(value, str) and value == ""):
        return None
    if not isinstance(value, (str, datetime)):
        raise ValueError("Expected an ISO timestamp or datetime")
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


class InvalidSnapshot(HTTPException):
    """A recorded field cannot be safely interpreted, even with forced undo."""

    def __init__(self, activity_id: uuid.UUID, field: str):
        super().__init__(
            status_code=409,
            detail={
                "code": "invalid_snapshot",
                "message": f"Cannot undo this activity because its saved {field} timestamp is invalid.",
                "activity_id": str(activity_id),
                "field": field,
            },
        )


def validate_undo_timestamps(
    activity_id: uuid.UUID, before: dict | None, after: dict | None
) -> None:
    # Validate independently of comparison's short circuit and force's conflict bypass.
    for side, snapshot in (("before", before), ("after", after)):
        for field in ("published_at", "deleted_at"):
            if snapshot is not None and field in snapshot:
                try:
                    normalized_time(snapshot[field])
                except (ValueError, TypeError, OverflowError) as error:
                    raise InvalidSnapshot(activity_id, f"{side}.{field}") from error


def _reference_id(raw: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(raw)) if raw else None
    except ValueError, TypeError:
        return None


class SnapshotReferences:
    """Project-scoped, request-local reference resolution; cache misses as well as hits."""

    def __init__(self, db: Session, project_id: uuid.UUID, snapshots: list[dict | None]):
        self.db = db
        self.project_id = project_id
        self.modules: set[uuid.UUID] = set()
        self.tags: dict[uuid.UUID, Tag] = {}
        self._known_modules: set[uuid.UUID] = set()
        self._known_tags: set[uuid.UUID] = set()
        module_ids = set()
        tag_ids = set()
        for snapshot in snapshots:
            if snapshot is None:
                continue
            for name in ("module_id", "published_module_id"):
                mid = _reference_id(snapshot.get(name))
                if mid:
                    module_ids.add(mid)
            tag_ids.update(
                tid for raw in snapshot.get("tag_ids") or [] if (tid := _reference_id(raw))
            )
        self._load_modules(module_ids)
        self._load_tags(tag_ids)

    def _load_modules(self, ids: set[uuid.UUID]) -> None:
        missing = list(ids - self._known_modules)
        for offset in range(0, len(missing), 400):
            chunk = missing[offset : offset + 400]
            self.modules.update(
                mid
                for (mid,) in self.db.query(Module.id)
                .filter(Module.project_id == self.project_id, Module.id.in_(chunk))
                .all()
            )
            self._known_modules.update(chunk)

    def _load_tags(self, ids: set[uuid.UUID]) -> None:
        missing = list(ids - self._known_tags)
        for offset in range(0, len(missing), 400):
            chunk = missing[offset : offset + 400]
            rows = (
                self.db.query(Tag)
                .filter(Tag.project_id == self.project_id, Tag.id.in_(chunk))
                .all()
            )
            self.tags.update((tag.id, tag) for tag in rows)
            self._known_tags.update(chunk)

    def module(self, raw: Any) -> str | None:
        mid = _reference_id(raw)
        if mid is None:
            return None
        self._load_modules({mid})
        return str(mid) if mid in self.modules else None

    def tag_rows(self, raw_ids: list) -> list[Tag]:
        ids = {tid for raw in raw_ids if (tid := _reference_id(raw))}
        self._load_tags(ids)
        return [self.tags[tid] for tid in sorted(ids, key=str) if tid in self.tags]


def project_snapshot(
    db: Session,
    project_id: uuid.UUID,
    current: dict,
    historical: dict,
    *,
    full_state: bool = False,
    references: SnapshotReferences | None = None,
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
            if references is not None:
                target[name] = references.module(raw)
                continue
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
        tags = (
            references.tag_rows(historical["tag_ids"] or [])
            if references is not None
            else db.query(Tag).filter(Tag.project_id == project_id, Tag.id.in_(ids)).all()
            if ids
            else []
        )
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
        if is_module_project_fk_error(error):
            raise HTTPException(status_code=400, detail="Unknown module") from error
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.info.pop("restore_key", None)
