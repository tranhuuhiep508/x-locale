"""Shared slug and export helpers."""

from __future__ import annotations

import hashlib
import json
import re
import uuid

from sqlalchemy.orm import Session

from app.models import Project, StringEntry

SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


def validate_locale_code(code: str) -> str:
    """BCP-47-style locale tag safe for paths and DB (single segment)."""
    normalized = (code or "").strip()
    if not LOCALE_RE.fullmatch(normalized):
        raise ValueError(f"Invalid locale code: {code!r}")
    return normalized


def validate_module_slug(slug: str) -> str:
    normalized = (slug or "").strip()
    if not SLUG_RE.fullmatch(normalized):
        raise ValueError(f"Invalid module slug: {slug!r}")
    return normalized


def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    if not s:
        s = "project"
    if not s[0].isalpha():
        s = f"p-{s}"
    return s[:128]


def ensure_unique_slug(db: Session, base: str, exclude_id: uuid.UUID | None = None) -> str:
    slug = slugify(base)
    candidate = slug
    n = 2
    while True:
        q = db.query(Project).filter(Project.slug == candidate)
        if exclude_id:
            q = q.filter(Project.id != exclude_id)
        if not q.first():
            return candidate
        candidate = f"{slug}-{n}"
        n += 1


def export_key(entry: StringEntry, *, published: bool = False) -> str:
    """Key used in flat export — the stored (or published) key, never module-prefixed."""
    if published:
        return entry.published_key or entry.key
    return entry.key


def content_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()
