"""Shared slug and export helpers."""

from __future__ import annotations

import hashlib
import json
import re
import uuid

from fastapi import HTTPException
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
