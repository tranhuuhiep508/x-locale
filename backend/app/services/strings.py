"""String lookup, locale checks, and batch mutations."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.helpers import resolve_string_ids
from app.models import Project, StringEntry, Tag, TranslationStatus
from app.schemas import BatchRequest, BatchResult


def validate_locales(project: Project, translations: dict[str, str] | None) -> None:
    if not translations:
        return
    allowed = set(project.target_languages)
    allowed.add(project.base_language)
    for locale in translations:
        if locale not in allowed:
            raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured")


def get_string(db: Session, project_id: uuid.UUID, string_id: uuid.UUID) -> StringEntry:
    entry = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
        )
        .filter(StringEntry.id == string_id, StringEntry.project_id == project_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="String not found")
    return entry


def apply_batch(db: Session, project: Project, payload: BatchRequest) -> BatchResult:
    from app.activity import attach_batch

    ids = resolve_string_ids(db, project, payload.string_ids, payload.filter)
    if not ids:
        return BatchResult(affected=0, batch_id=uuid.uuid4())

    batch_id = uuid.uuid4()
    attach_batch(db, batch_id, "batch")

    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations), joinedload(StringEntry.tags))
        .filter(StringEntry.project_id == project.id, StringEntry.id.in_(ids))
        .all()
    )

    affected = 0
    action = payload.action

    if action == "publish":
        for entry in entries:
            if entry.status != TranslationStatus.public:
                entry.status = TranslationStatus.public
                affected += 1
    elif action == "unpublish":
        for entry in entries:
            if entry.status != TranslationStatus.draft:
                entry.status = TranslationStatus.draft
                affected += 1
    elif action == "delete":
        for entry in entries:
            db.delete(entry)
            affected += 1
    elif action == "move_module":
        module_id = payload.payload.get("module_id")
        mid = uuid.UUID(module_id) if module_id else None
        for entry in entries:
            entry.module_id = mid
            affected += 1
    elif action == "add_tags":
        tag_ids = [uuid.UUID(t) for t in payload.payload.get("tag_ids", [])]
        tags = db.query(Tag).filter(Tag.project_id == project.id, Tag.id.in_(tag_ids)).all()
        for entry in entries:
            existing_ids = {t.id for t in entry.tags}
            for tag in tags:
                if tag.id not in existing_ids:
                    entry.tags.append(tag)
                    affected += 1
    elif action == "remove_tags":
        tag_ids = {uuid.UUID(t) for t in payload.payload.get("tag_ids", [])}
        for entry in entries:
            before = len(entry.tags)
            entry.tags = [t for t in entry.tags if t.id not in tag_ids]
            affected += before - len(entry.tags)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    db.commit()
    return BatchResult(affected=affected, batch_id=batch_id)
