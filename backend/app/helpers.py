"""Shared slug and export helpers."""

from __future__ import annotations

import hashlib
import json
import re
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.limits import KEY_MAX_LENGTH, LOCALE_MAX_LENGTH, MODULE_SLUG_MAX_LENGTH
from app.models import Project, StringEntry

SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


def field_too_long(field: str, limit: int) -> str:
    return f"{field} must be at most {limit} characters"


def key_preview(value: str, width: int = 40) -> str:
    """Quoted preview. The length sits outside the quotes when the value is cut.

    The CLI uses the same shape: 'abcd'… (513 chars).
    """
    if len(value) <= width:
        return repr(value)
    return f"{value[:width]!r}… ({len(value)} chars)"


def validate_locale_code(code: str) -> str:
    """BCP-47-style locale tag safe for paths and DB (single segment)."""
    normalized = (code or "").strip()
    if len(normalized) > LOCALE_MAX_LENGTH:
        raise ValueError(field_too_long("locale", LOCALE_MAX_LENGTH))
    if not LOCALE_RE.fullmatch(normalized):
        raise ValueError(f"Invalid locale code: {code!r}")
    return normalized


def validate_module_slug(slug: str) -> str:
    normalized = (slug or "").strip()
    if len(normalized) > MODULE_SLUG_MAX_LENGTH:
        raise ValueError(
            f"module slug {key_preview(normalized)} must be at most "
            f"{MODULE_SLUG_MAX_LENGTH} characters"
        )
    if not SLUG_RE.fullmatch(normalized):
        raise ValueError(f"Invalid module slug: {slug!r}")
    return normalized


def require_locale_code(code: str) -> str:
    """Reject a locale that cannot fit in the column. Raises HTTP 400.

    Length only. Project create/update and Excel headers still run
    validate_locale_code. String, translation, and activity writes must
    keep accepting legacy target languages such as en_US.
    """
    if len(code) > LOCALE_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=field_too_long("locale", LOCALE_MAX_LENGTH))
    return code


def require_max_length(value: str | None, *, field: str, limit: int) -> str | None:
    """Reject a value that would overflow a varchar. None is unchanged."""
    if value is not None and len(value) > limit:
        raise HTTPException(status_code=400, detail=field_too_long(field, limit))
    return value


def require_string_key(key: str) -> str:
    return require_max_length(key, field="key", limit=KEY_MAX_LENGTH) or ""


def ensure_max_length(value: str, *, field: str, limit: int) -> str:
    """Raise ValueError so file import can turn the message into HTTP 400."""
    if len(value) > limit:
        raise ValueError(
            f"{field} {key_preview(value)} must be at most {limit} characters"
        )
    return value


def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    if not s:
        s = "project"
    if not s[0].isalpha():
        s = f"p-{s}"
    return s[:128]


def ensure_unique_slug(db: Session, base: str) -> str:
    slug = slugify(base)
    try:
        uuid.UUID(slug)
    except ValueError:
        pass
    else:
        slug = f"p-{slug[:126]}"
    candidate = slug
    n = 2
    while True:
        if not db.query(Project).filter(Project.slug == candidate).first():
            return candidate
        candidate = f"{slug[: 127 - len(str(n))]}-{n}"
        n += 1


def resolve_project_ref(db: Session, project_ref: str) -> Project:
    """Resolve a public slug or a legacy UUID without choosing an ambiguous match."""
    by_slug = db.query(Project).filter(Project.slug == project_ref).first()
    try:
        project_id = uuid.UUID(project_ref)
    except ValueError:
        project_id = None
    by_id = db.query(Project).filter(Project.id == project_id).first() if project_id else None
    if by_slug and by_id and by_slug.id != by_id.id:
        raise HTTPException(status_code=409, detail="Ambiguous project reference")
    if by_slug or by_id:
        return by_slug or by_id
    raise HTTPException(status_code=404, detail="Project not found")


def export_key(entry: StringEntry, *, published: bool = False) -> str:
    """Key used in flat export — the stored (or published) key, never module-prefixed."""
    if published:
        return entry.published_key or entry.key
    return entry.key


def content_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()
