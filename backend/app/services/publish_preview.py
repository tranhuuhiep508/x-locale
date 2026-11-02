"""Read-only publish preview: load the strings a batch publish would touch."""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.activity import attach_batch
from app.models import Activity, BatchKind, Project, StringEntry, Translation
from app.schemas import (
    BatchResult,
    CliPushBatchOut,
    CliPushPublishRequest,
    PublishPreviewEntriesOut,
    PublishPreviewRequest,
)
from app.services.strings import (
    PUBLISH_FINGERPRINT_MISMATCH,
    apply_translation_values,
    compute_publish_fingerprint,
    fingerprints_match,
    guard_published_keys,
    is_publishable_entry,
    load_string_entries,
    lock_publication,
    promote_string,
    resolve_string_ids,
    serialize_string,
    validate_locales,
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
        fingerprint=compute_publish_fingerprint(active, include_unchanged=True),
        batch_id=batch_id,
        actor_label=activities[0].actor_label,
        created_at=activities[0].created_at,
        created_count=len(created),
        updated_count=len(members - created),
        excluded_count=len(members) - len(active),
    )


def publish_cli_push_batch(
    db: Session, project: Project, batch_id: UUID, payload: CliPushPublishRequest
) -> BatchResult:
    from app.services.write_transactions import run_write

    def write() -> BatchResult:
        lock_publication(db, project.id)
        db.refresh(project, with_for_update={"read": True})
        activities = (
            db.query(Activity.string_id)
            .filter(
                Activity.project_id == project.id,
                Activity.batch_id == batch_id,
                Activity.batch_kind == BatchKind.cli_push,
            )
            .all()
        )
        if not activities:
            raise HTTPException(404, detail="CLI push batch not found")
        ids = sorted({row[0] for row in activities if row[0] is not None})
        if ids:
            db.query(StringEntry.id).filter(
                StringEntry.project_id == project.id,
                StringEntry.id.in_(ids),
            ).order_by(StringEntry.id).with_for_update().all()
            db.query(Translation.id).filter(Translation.string_id.in_(ids)).order_by(
                Translation.id
            ).with_for_update().all()
        entries = load_string_entries(db, project.id, ids, refresh=True)
        active = [entry for entry in entries if not entry.deleted_at and not entry.pending_delete]
        active.sort(key=lambda entry: (entry.key, str(entry.id)))
        # Validate provenance even for an empty batch; never accept a generic import id.
        current_fingerprint = compute_publish_fingerprint(active, include_unchanged=True)
        if not fingerprints_match(current_fingerprint, payload.fingerprint):
            raise HTTPException(409, detail={"code": PUBLISH_FINGERPRINT_MISMATCH})
        by_id = {entry.id: entry for entry in active}
        seen = set()
        for item in payload.items:
            entry = by_id.get(item.string_id)
            if entry is None or item.string_id in seen:
                raise HTTPException(
                    400, detail="Translations must belong to this active CLI push batch"
                )
            seen.add(item.string_id)
            if entry.source_text != item.expected_source_text:
                raise HTTPException(409, detail={"code": PUBLISH_FINGERPRINT_MISMATCH})
            validate_locales(project, item.translations)
        publication_id = uuid4()
        attach_batch(db, publication_id, "batch")
        for item in payload.items:
            apply_translation_values(db, by_id[item.string_id], item.translations, item.scores)
        publishable = [entry for entry in active if is_publishable_entry(entry)]
        for entry in publishable:
            promote_string(entry)
        db.flush()
        if publishable:
            guard_published_keys(db, project)
        return BatchResult(affected=len(publishable), batch_id=publication_id)

    return run_write(db, project.id, "publish_cli_push_batch", write)
