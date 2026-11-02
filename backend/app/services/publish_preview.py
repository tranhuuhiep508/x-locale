"""Read-only publish preview: load the strings a batch publish would touch."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Activity, BatchKind, Project
from app.schemas import (
    CliPushBatchOut,
    PublishPreviewEntriesOut,
    PublishPreviewRequest,
)
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


def cli_push_batch(db: Session, project: Project, batch_id: UUID) -> CliPushBatchOut:
    activities = (
        db.query(Activity)
        .filter(
            Activity.project_id == project.id,
            Activity.batch_id == batch_id,
            Activity.batch_kind == BatchKind.cli_push,
        )
        .order_by(Activity.created_at, Activity.id)
        .all()
    )
    if not activities:
        raise HTTPException(404, detail="CLI push batch not found")
    members = {item.string_id for item in activities if item.string_id is not None}
    created = {item.string_id for item in activities if item.event_type == "string.created"}
    entries = load_string_entries(db, project.id, list(members))
    active = [entry for entry in entries if not entry.deleted_at and not entry.pending_delete]
    active.sort(key=lambda entry: (entry.key, str(entry.id)))
    return CliPushBatchOut(
        items=[serialize_string(entry) for entry in active],
        fingerprint=compute_publish_fingerprint(active),
        batch_id=batch_id,
        actor_label=activities[0].actor_label,
        created_at=activities[0].created_at,
        created_count=len(created),
        updated_count=len(members - created),
        excluded_count=len(members) - len(active),
    )
