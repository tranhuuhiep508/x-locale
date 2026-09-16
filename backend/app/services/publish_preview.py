"""Read-only publish preview: load the strings a batch publish would touch."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Project
from app.schemas import PublishPreviewEntriesOut, PublishPreviewRequest
from app.services.strings import (
    compute_publish_fingerprint,
    load_string_entries,
    resolve_string_ids,
    serialize_string,
)


def list_publish_preview_entries(
    db: Session,
    project: Project,
    payload: PublishPreviewRequest,
) -> PublishPreviewEntriesOut:
    ids = resolve_string_ids(db, project, payload.string_ids, payload.filter)
    entries = load_string_entries(db, project.id, ids)
    entries.sort(key=lambda entry: (entry.key, str(entry.id)))
    return PublishPreviewEntriesOut(
        items=[serialize_string(entry) for entry in entries],
        fingerprint=compute_publish_fingerprint(entries),
    )
