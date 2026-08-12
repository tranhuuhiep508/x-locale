"""Shared helpers for string queries, serialization, and slug generation."""

from __future__ import annotations

import re
import uuid
from typing import Sequence

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.models import Module, Project, StringEntry, Tag, Translation, TranslationStatus
from app.schemas import StringOut, TagOut, TranslationOut

SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]*$")


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


def serialize_string(entry: StringEntry) -> StringOut:
    return StringOut(
        id=entry.id,
        key=entry.key,
        source_text=entry.source_text,
        description=entry.description,
        status=entry.status,
        module_id=entry.module_id,
        module_slug=entry.module.slug if entry.module else None,
        tags=[
            TagOut(id=t.id, name=t.name, color=t.color, string_count=0) for t in (entry.tags or [])
        ],
        updated_at=entry.updated_at,
        translations=[
            TranslationOut(
                id=t.id,
                locale=t.locale,
                value=t.value,
                updated_at=t.updated_at,
            )
            for t in (entry.translations or [])
        ],
    )


def ensure_translation_rows(db: Session, entry: StringEntry, project: Project) -> None:
    existing = {t.locale for t in entry.translations}
    for locale in project.target_languages:
        if locale not in existing:
            db.add(
                Translation(
                    string_id=entry.id,
                    locale=locale,
                    value="",
                )
            )


def string_query(
    db: Session,
    project_id: uuid.UUID,
    *,
    module_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    q: str | None = None,
    missing_locale: str | None = None,
    status: TranslationStatus | None = None,
):
    query = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
        )
        .filter(StringEntry.project_id == project_id)
    )
    if module_id is not None:
        query = query.filter(StringEntry.module_id == module_id)
    if tag_id is not None:
        query = query.join(StringEntry.tags).filter(Tag.id == tag_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                StringEntry.key.ilike(like),
                StringEntry.source_text.ilike(like),
                StringEntry.description.ilike(like),
            )
        )
    if missing_locale:
        # Strings with no non-empty translation for this locale
        subquery = (
            db.query(Translation.string_id)
            .filter(
                Translation.locale == missing_locale,
                Translation.value != "",
            )
            .subquery()
        )
        query = query.filter(~StringEntry.id.in_(db.query(subquery.c.string_id)))
    if status is not None:
        query = query.filter(StringEntry.status == status)
    return query.distinct()


def resolve_string_ids(
    db: Session,
    project: Project,
    string_ids: Sequence[uuid.UUID] | None,
    filt,
) -> list[uuid.UUID]:
    if string_ids:
        return list(string_ids)
    if filt is None:
        return []
    q = string_query(
        db,
        project.id,
        module_id=getattr(filt, "module_id", None),
        tag_id=getattr(filt, "tag_id", None),
        q=getattr(filt, "q", None),
        missing_locale=getattr(filt, "missing_locale", None),
        status=getattr(filt, "status", None),
    )
    return [row.id for row in q.with_entities(StringEntry.id).all()]


def export_key(entry: StringEntry, layout: str) -> str:
    """Key used in flat export — prefix with module slug when modular-aware flat."""
    if entry.module and layout == "flat":
        return f"{entry.module.slug}.{entry.key}"
    if entry.module:
        return entry.key
    return entry.key


def content_hash(payload: dict) -> str:
    import hashlib
    import json

    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()
