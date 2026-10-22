"""AI translate: one Bedrock request per string chunk, all requested locales."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.activity import attach_batch
from app.ai import (
    BATCH_SIZE,
    ProgressCallback,
    ProgressPhase,
    TranslatedCell,
    TranslateItem,
    as_translated_cell,
    translate_batch,
)
from app.database import SessionLocal
from app.helpers import require_locale_code
from app.models import Job, JobStatus, Module, Project, StringEntry, Translation, TranslationStatus
from app.schemas import TranslateApplyItem, TranslateRequest, TranslationSourceConflict
from app.services.catalog import owned_module
from app.services.job_progress import write_job_progress
from app.services.jobs import _finish, owned_job_connection
from app.services.strings import _missing_locales_clause, filtered_string_query, load_string_entries

SYNC_THRESHOLD = 20


def _entries_query(
    db: Session,
    project: Project,
    payload: TranslateRequest,
    locales: list[str],
    *,
    eager: bool,
):
    query = filtered_string_query(
        db,
        project,
        payload.model_copy(update={"q": (payload.q or "").strip() or None}),
        eager=eager,
    )
    # Translation work is the filtered grid intersected with actionable cells.
    # A complete-locale filter can legitimately leave no missing work.
    query = query.filter(StringEntry.deleted_at.is_(None))
    if not payload.overwrite:
        query = query.filter(_missing_locales_clause(db, locales))
    if payload.scope == "strings" and payload.string_ids:
        query = query.filter(StringEntry.id.in_(payload.string_ids))
    return query


def _load_entries_by_ids(db: Session, ids: list[uuid.UUID]) -> list[StringEntry]:
    if not ids:
        return []
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations), joinedload(StringEntry.module))
        .filter(StringEntry.id.in_(ids))
        .all()
    )
    by_id = {entry.id: entry for entry in entries}
    return [by_id[entry_id] for entry_id in ids if entry_id in by_id]


def select_entries(
    db: Session,
    project: Project,
    payload: TranslateRequest,
    locales: list[str] | None = None,
) -> list[StringEntry]:
    target_locales = locales or payload.locales or list(project.target_languages)
    query = _entries_query(db, project, payload, target_locales, eager=False)
    id_rows = (
        query.with_entities(StringEntry.id, StringEntry.key)
        .distinct()
        .order_by(StringEntry.key)
        .all()
    )
    return _load_entries_by_ids(db, [row[0] for row in id_rows])


def list_missing_page(
    db: Session,
    project: Project,
    payload: TranslateRequest,
    locales: list[str],
) -> tuple[list[dict[str, Any]], int, int, int]:
    page = payload.page
    page_size = payload.page_size
    query = _entries_query(db, project, payload, locales, eager=False)
    total = query.with_entities(StringEntry.id).distinct().order_by(None).count()
    max_page = max(1, (total + page_size - 1) // page_size) if total else 1
    if page > max_page:
        page = max_page
    id_rows = (
        query.with_entities(StringEntry.id, StringEntry.key)
        .distinct()
        .order_by(StringEntry.key)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    entries = _load_entries_by_ids(db, [row[0] for row in id_rows])
    return list_missing_items(entries, locales, payload.overwrite), total, page, page_size


def needed_locales(entry: StringEntry, locales: list[str], overwrite: bool) -> list[str]:
    by_locale = {t.locale: t for t in entry.translations}
    needed: list[str] = []
    for locale in locales:
        translation = by_locale.get(locale)
        if translation is None or overwrite or not translation.value.strip():
            needed.append(locale)
    return needed


def parse_descriptions(
    raw: dict[uuid.UUID, str] | dict[str, str] | None,
) -> dict[uuid.UUID, str] | None:
    if not raw:
        return None
    parsed: dict[uuid.UUID, str] = {}
    for key, value in raw.items():
        try:
            parsed[key if isinstance(key, uuid.UUID) else uuid.UUID(str(key))] = value
        except ValueError:
            continue
    return parsed or None


def serialize_descriptions(descriptions: dict[uuid.UUID, str] | None) -> dict[str, str] | None:
    if not descriptions:
        return None
    return {str(key): value for key, value in descriptions.items()}


def _description_for(
    entry: StringEntry, descriptions: dict[uuid.UUID, str] | None
) -> str | None:
    if descriptions is not None and entry.id in descriptions:
        return descriptions[entry.id].strip() or None
    return entry.description


def compose_translation_context(
    project: Project,
    module: Module | None,
    description: str | None,
) -> str | None:
    """Compose AI instructions without changing the string's own description."""
    module = owned_module(project.id, module)
    parts = (
        project.translation_context,
        module.translation_context if module is not None else None,
        description,
    )
    return "\n".join(part.strip() for part in parts if part and part.strip()) or None


def work_items(
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
    descriptions: dict[uuid.UUID, str] | None = None,
) -> list[TranslateItem]:
    items: list[TranslateItem] = []
    for entry in entries:
        needed = needed_locales(entry, locales, overwrite)
        if not needed:
            continue
        items.append(
            TranslateItem(
                id=str(entry.id),
                source_text=entry.source_text,
                locales=tuple(needed),
                context=compose_translation_context(
                    project, entry.module, _description_for(entry, descriptions)
                ),
            )
        )
    return items


def count_work(
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
) -> int:
    return sum(bool(needed_locales(entry, locales, overwrite)) for entry in entries)


def _ensure_translation(db: Session, entry: StringEntry, locale: str) -> Translation:
    locale = require_locale_code(locale)
    translation = next((t for t in entry.translations if t.locale == locale), None)
    if translation is None:
        translation = Translation(string_id=entry.id, locale=locale, value="")
        db.add(translation)
        entry.translations.append(translation)
    return translation


def _cell_map(results: dict[str, dict], item_id: str) -> dict[str, TranslatedCell]:
    raw = results.get(item_id) or {}
    cells: dict[str, TranslatedCell] = {}
    for locale, value in raw.items():
        cell = as_translated_cell(value)
        if cell is not None:
            cells[locale] = cell
    return cells


def _scores_from_cells(
    cells: dict[str, TranslatedCell], locales: tuple[str, ...] | list[str]
) -> dict[str, int]:
    scores: dict[str, int] = {}
    for locale in locales:
        cell = cells.get(locale)
        if cell is not None and cell.confidence is not None:
            scores[locale] = cell.confidence
    return scores


def apply_translations(
    db: Session,
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
) -> tuple[int, list[TranslationSourceConflict]]:
    items = work_items(project, entries, locales, overwrite)
    if not items:
        return 0, []

    results = translate_batch(project.base_language, items)
    # Generation can outlive an editor save. Lock first, then replace cached values.
    ids = [uuid.UUID(item.id) for item in items]
    locked_ids = [
        row[0]
        for row in db.query(StringEntry.id)
        .filter(
            StringEntry.project_id == project.id,
            StringEntry.id.in_(ids),
            StringEntry.deleted_at.is_(None),
        )
        .order_by(StringEntry.id)
        .with_for_update()
        .all()
    ]
    if not locked_ids:
        return 0, []
    db.query(Translation.id).filter(Translation.string_id.in_(locked_ids)).order_by(
        Translation.id
    ).with_for_update().all()
    refreshed = load_string_entries(db, project.id, locked_ids, refresh=True)
    by_id = {str(entry.id): entry for entry in refreshed}
    translated = 0
    skipped: list[TranslationSourceConflict] = []
    for item in items:
        entry = by_id.get(item.id)
        if entry is None:
            continue
        if entry.source_text != item.source_text:
            skipped.append(
                TranslationSourceConflict(
                    string_id=entry.id,
                    key=entry.key,
                    expected_source_text=item.source_text,
                    source_text=entry.source_text,
                )
            )
            continue
        locale_map = _cell_map(results, item.id)
        for locale in item.locales:
            cell = locale_map.get(locale)
            if cell is None or not cell.text.strip():
                continue
            translation = _ensure_translation(db, entry, locale)
            if translation.value.strip() and not overwrite:
                continue
            translation.value = cell.text
            translation.confidence = cell.confidence
            translated += 1
    return translated, skipped


def preview_translations(
    project: Project,
    module: Module | None,
    source_text: str,
    locales: list[str],
    description: str | None,
) -> tuple[dict[str, str], dict[str, int]]:
    result = translate_batch(
        project.base_language,
        [
            TranslateItem(
                id="preview",
                source_text=source_text,
                locales=tuple(locales),
                context=compose_translation_context(project, module, description),
            )
        ],
    )
    cells = _cell_map(result, "preview")
    translations = {locale: cells[locale].text for locale in locales if locale in cells}
    return translations, _scores_from_cells(cells, locales)


def _status_str(entry: StringEntry) -> str:
    status = entry.status
    if isinstance(status, TranslationStatus):
        return status.value
    return str(status)


def _proposal_dict(
    entry: StringEntry,
    translations: dict[str, str],
    scores: dict[str, int] | None = None,
    description: str | None = None,
    source_text: str | None = None,
) -> dict[str, Any]:
    return {
        "string_id": str(entry.id),
        "key": entry.key,
        "source_text": entry.source_text if source_text is None else source_text,
        "status": _status_str(entry),
        "description": description,
        "translations": translations,
        "scores": scores or {},
    }


def list_missing_items(
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for entry in entries:
        needed = needed_locales(entry, locales, overwrite)
        if not needed:
            continue
        items.append(
            _proposal_dict(
                entry,
                {locale: "" for locale in needed},
                description=entry.description,
            )
        )
    return items


def chunk_count(work: int) -> int:
    if work <= 0:
        return 0
    return (work + BATCH_SIZE - 1) // BATCH_SIZE


def queued_progress(work: int) -> dict[str, int | str]:
    return {
        "phase": "queued",
        "chunks_done": 0,
        "chunks_total": chunk_count(work),
    }


def propose_translations(
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
    descriptions: dict[uuid.UUID, str] | None = None,
    on_progress: ProgressCallback | None = None,
) -> list[dict[str, Any]]:
    items = work_items(project, entries, locales, overwrite, descriptions)
    if not items:
        return []

    results = translate_batch(project.base_language, items, on_progress=on_progress)
    by_id = {str(entry.id): entry for entry in entries}
    proposals: list[dict[str, Any]] = []
    for item in items:
        entry = by_id.get(item.id)
        if entry is None:
            continue
        locale_map = _cell_map(results, item.id)
        translations: dict[str, str] = {}
        for locale in item.locales:
            cell = locale_map.get(locale)
            if cell is None or not cell.text.strip():
                continue
            translations[locale] = cell.text
        if not translations:
            continue
        proposals.append(
            _proposal_dict(
                entry,
                translations,
                _scores_from_cells(locale_map, item.locales),
                description=_description_for(entry, descriptions),
                source_text=item.source_text,
            )
        )
    return proposals


def commit_proposals(
    db: Session,
    project: Project,
    items: list[TranslateApplyItem],
) -> tuple[int, list[str]]:
    if not items:
        return 0, []

    allowed = set(project.target_languages)
    ids = [item.string_id for item in items]
    # Lock parents separately: the eager translation join has a nullable side.
    db.query(StringEntry.id).filter(
        StringEntry.project_id == project.id,
        StringEntry.id.in_(ids),
    ).order_by(StringEntry.id).with_for_update().all()
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(
            StringEntry.project_id == project.id,
            StringEntry.id.in_(ids),
            StringEntry.deleted_at.is_(None),
        )
        .populate_existing()
        .all()
    )
    by_id = {entry.id: entry for entry in entries}
    source_conflicts = [
        TranslationSourceConflict(
            string_id=entry.id,
            key=entry.key,
            expected_source_text=item.expected_source_text,
            source_text=entry.source_text,
        ).model_dump(mode="json")
        for item in items
        if (entry := by_id.get(item.string_id)) is not None
        and entry.source_text != item.expected_source_text
    ]
    if source_conflicts:
        raise HTTPException(
            409,
            detail={
                "code": "stale_translation_source",
                "message": "Source text changed. Regenerate the affected translations before applying again.",
                "conflicts": source_conflicts,
            },
        )
    conflicts = []
    for item in items:
        entry = by_id.get(item.string_id)
        if entry is None or "description" not in item.model_fields_set:
            continue
        desired = (item.description or "").strip() or None
        if entry.description not in (item.expected_description, desired):
            conflicts.append(
                {
                    "string_id": str(entry.id),
                    "key": entry.key,
                    "description": entry.description,
                }
            )
    if conflicts:
        raise HTTPException(
            409,
            detail={
                "code": "stale_translation_description",
                "message": "Descriptions changed. Resolve each conflict, then apply again.",
                "conflicts": conflicts,
            },
        )
    translated = 0
    locales_written: list[str] = []
    seen_locales: set[str] = set()
    for item in items:
        entry = by_id.get(item.string_id)
        if entry is None:
            continue
        if "description" in item.model_fields_set:
            entry.description = (item.description or "").strip() or None
        for locale, value in item.translations.items():
            if locale not in allowed:
                continue
            if not value or not value.strip():
                continue
            translation = _ensure_translation(db, entry, locale)
            if translation.value.strip():
                continue
            translation.value = value
            translation.confidence = item.scores.get(locale)
            translated += 1
            if locale not in seen_locales:
                seen_locales.add(locale)
                locales_written.append(locale)
    return translated, locales_written


@contextmanager
def _ai_job_session(job_id: uuid.UUID | None) -> Iterator[Session | None]:
    """Own AI work across transactions; a delayed callback cannot restart a finished job."""
    with owned_job_connection(job_id) if job_id else nullcontext() as conn:
        with SessionLocal(bind=conn) if conn is not None else SessionLocal() as db:
            try:
                if job_id is not None:
                    job = (
                        db.query(Job)
                        .filter(Job.id == job_id, Job.status == JobStatus.pending)
                        .with_for_update()
                        .first()
                    )
                    if job is None:
                        yield None
                        return
                    db.info["activity"] = dict((job.payload or {}).get("actor") or {})
                    job.status = JobStatus.running
                    db.commit()
                yield db
            except Exception as exc:
                # Rollback can allow reconnection. Never record a failure after losing ownership.
                lost_ownership = conn is not None and conn.invalidated
                db.rollback()
                if job_id is not None and not lost_ownership and not conn.invalidated:
                    job = (
                        db.query(Job)
                        .filter(Job.id == job_id, Job.status == JobStatus.running)
                        .populate_existing()
                        .with_for_update()
                        .first()
                    )
                    if job is not None:
                        _finish(job, JobStatus.failed, phase="failed")
                        job.error = str(exc)
                        db.commit()
                raise


def _complete_ai_job(db: Session, job_id: uuid.UUID | None, result: dict[str, Any]) -> bool:
    if job_id is not None:
        if db.get_bind().invalidated:
            raise RuntimeError("AI job lost its database connection")
        job = (
            db.query(Job)
            .filter(Job.id == job_id, Job.status == JobStatus.running)
            .populate_existing()
            .with_for_update()
            .first()
        )
        if job is None:
            db.rollback()
            return False
        _finish(job, JobStatus.completed, phase="done")
        job.result = result
    db.commit()
    return True


def run_translate_job(
    project_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    locales: list[str],
    overwrite: bool,
    batch_id: uuid.UUID,
    job_id: uuid.UUID | None = None,
) -> int:
    with _ai_job_session(job_id) as db:
        if db is None:
            return 0
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        actor = db.info.get("activity") or {}
        db.info["activity"] = {
            "actor_type": actor.get("actor_type") or "user",
            "actor_id": actor.get("actor_id"),
            "actor_label": actor.get("actor_label") or "user",
        }
        attach_batch(db, batch_id, "translate")
        entries = _load_entries_by_ids(db, entry_ids)
        translated, skipped = apply_translations(db, project, entries, locales, overwrite)
        completed = _complete_ai_job(
            db,
            job_id,
            {
                "translated_count": translated,
                "locales": locales,
                "skipped_source_conflicts": [item.model_dump(mode="json") for item in skipped],
            },
        )
        return translated if completed else 0


def run_propose_job(
    project_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    locales: list[str],
    overwrite: bool,
    job_id: uuid.UUID,
    descriptions: dict[str, str] | None = None,
) -> None:
    with _ai_job_session(job_id) as db:
        if db is None:
            return
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        entries = _load_entries_by_ids(db, entry_ids)

        def on_progress(phase: ProgressPhase, chunks_done: int, chunks_total: int) -> None:
            write_job_progress(job_id, phase, chunks_done, chunks_total)

        items = propose_translations(
            project,
            entries,
            locales,
            overwrite,
            parse_descriptions(descriptions),
            on_progress=on_progress,
        )
        _complete_ai_job(db, job_id, {"locales": locales, "items": items})
