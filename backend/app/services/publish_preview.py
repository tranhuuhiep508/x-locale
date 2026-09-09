"""Read-only publish preview: load the strings a batch publish would touch."""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models import Project, StringEntry
from app.schemas import PublishPreviewEntriesOut, PublishPreviewRequest
from app.services.strings import resolve_string_ids, serialize_string


def list_publish_preview_entries(
    db: Session,
    project: Project,
    payload: PublishPreviewRequest,
) -> PublishPreviewEntriesOut:
    ids = resolve_string_ids(db, project, payload.string_ids, payload.filter)
    if not ids:
        return PublishPreviewEntriesOut(items=[])

    entries = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.tags),
            joinedload(StringEntry.module),
            joinedload(StringEntry.published_module),
        )
        .filter(StringEntry.project_id == project.id, StringEntry.id.in_(ids))
        .order_by(StringEntry.key)
        .all()
    )
    return PublishPreviewEntriesOut(items=[serialize_string(entry) for entry in entries])
