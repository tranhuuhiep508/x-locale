"""Batch operations on strings."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import project_access, set_activity_context, AuthContext
from app.database import get_db
from app.helpers import resolve_string_ids
from app.models import Project, StringEntry, Tag, TranslationStatus
from app.schemas import BatchRequest, BatchResult

router = APIRouter(tags=["batch"])


@router.post("/projects/{project_id}/strings/batch", response_model=BatchResult)
def batch_strings(
    project_id: uuid.UUID,
    payload: BatchRequest,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> BatchResult:
    ids = resolve_string_ids(db, project, payload.string_ids, payload.filter)
    if not ids:
        return BatchResult(affected=0, batch_id=uuid.uuid4())

    batch_id = uuid.uuid4()
    # Preserve existing actor context and add batch metadata
    existing = db.info.get("activity") or {}
    db.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": "batch",
    }

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
