"""AI translate: one Bedrock tool call per string chunk, all requested locales."""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

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
from app.models import Job, JobStatus, Project, StringEntry, Translation, TranslationStatus
from app.schemas import TranslateApplyItem, TranslateRequest
from app.services.strings import string_query

SYNC_THRESHOLD = 20
_progress_lock = threading.Lock()


def _search_q(payload: TranslateRequest) -> str | None:
    return (payload.q or "").strip() or None


def _entries_query(
    db: Session,
    project: Project,
    payload: TranslateRequest,
    locales: list[str],
    *,
    eager: bool,
):
    query = string_query(
        db,
        project.id,
        module_id=payload.module_id,
        tag_id=payload.tag_id,
        q=_search_q(payload),
        missing_locales=None if payload.overwrite else locales,
        eager=eager,
    )
    if payload.scope == "strings" and payload.string_ids:
        query = query.filter(StringEntry.id.in_(payload.string_ids))
    return query


def _load_entries_by_ids(db: Session, ids: list[uuid.UUID]) -> list[StringEntry]:
    if not ids:
        return []
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
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


def work_items(
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
                context=_description_for(entry, descriptions),
            )
        )
    return items


def count_work(
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
    descriptions: dict[uuid.UUID, str] | None = None,
) -> int:
    return len(work_items(entries, locales, overwrite, descriptions))


def _ensure_translation(db: Session, entry: StringEntry, locale: str) -> Translation:
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
) -> int:
    items = work_items(entries, locales, overwrite)
    if not items:
        return 0

    results = translate_batch(project.base_language, items)
    by_id = {str(entry.id): entry for entry in entries}
    translated = 0
    for item in items:
        entry = by_id.get(item.id)
        if entry is None:
            continue
        locale_map = _cell_map(results, item.id)
        for locale in item.locales:
            translation = _ensure_translation(db, entry, locale)
            if translation.value.strip() and not overwrite:
                continue
            cell = locale_map.get(locale)
            if cell is None or not cell.text.strip():
                continue
            translation.value = cell.text
            translation.confidence = cell.confidence
            translated += 1
    return translated


def preview_translations(
    source_locale: str,
    source_text: str,
    locales: list[str],
    context: str | None,
) -> tuple[dict[str, str], dict[str, int]]:
    result = translate_batch(
        source_locale,
        [
            TranslateItem(
                id="preview",
                source_text=source_text,
                locales=tuple(locales),
                context=context,
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
) -> dict[str, Any]:
    return {
        "string_id": str(entry.id),
        "key": entry.key,
        "source_text": entry.source_text,
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


def write_job_progress(
    job_id: uuid.UUID,
    phase: ProgressPhase | str,
    chunks_done: int,
    chunks_total: int,
) -> None:
    with _progress_lock:
        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job is None:
                return
            payload = dict(job.payload or {})
            payload["progress"] = {
                "phase": phase,
                "chunks_done": chunks_done,
                "chunks_total": chunks_total,
            }
            job.payload = payload
            flag_modified(job, "payload")
            db.commit()
        finally:
            db.close()


def propose_translations(
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
    descriptions: dict[uuid.UUID, str] | None = None,
    on_progress: ProgressCallback | None = None,
) -> list[dict[str, Any]]:
    items = work_items(entries, locales, overwrite, descriptions)
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
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(
            StringEntry.project_id == project.id,
            StringEntry.id.in_(ids),
            StringEntry.deleted_at.is_(None),
        )
        .all()
    )
    by_id = {entry.id: entry for entry in entries}
    translated = 0
    locales_written: list[str] = []
    seen_locales: set[str] = set()
    for item in items:
        entry = by_id.get(item.string_id)
        if entry is None:
            continue
        if item.description is not None:
            entry.description = item.description.strip() or None
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


def run_translate_job(
    project_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    locales: list[str],
    overwrite: bool,
    batch_id: uuid.UUID,
    job_id: uuid.UUID | None = None,
) -> int:
    db = SessionLocal()
    try:
        actor: dict[str, str | None] = {}
        if job_id:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = JobStatus.running
                actor = ((job.payload or {}).get("actor") or {})

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return 0

        db.info["activity"] = {
            "actor_type": actor.get("actor_type") or "user",
            "actor_id": actor.get("actor_id"),
            "actor_label": actor.get("actor_label") or "user",
            "batch_id": str(batch_id),
            "batch_kind": "translate",
        }

        entries = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations))
            .filter(StringEntry.id.in_(entry_ids))
            .all()
        )
        translated = apply_translations(db, project, entries, locales, overwrite)

        if job_id:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = JobStatus.completed
                job.result = {"translated_count": translated, "locales": locales}
                job.completed_at = datetime.now(UTC)

        db.commit()
        return translated
    except Exception as exc:
        db.rollback()
        if job_id:
            failed = SessionLocal()
            try:
                job = failed.query(Job).filter(Job.id == job_id).first()
                if job:
                    job.status = JobStatus.failed
                    job.error = str(exc)
                    job.completed_at = datetime.now(UTC)
                    failed.commit()
            finally:
                failed.close()
        raise
    finally:
        db.close()


def run_propose_job(
    project_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    locales: list[str],
    overwrite: bool,
    job_id: uuid.UUID,
    descriptions: dict[str, str] | None = None,
) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = JobStatus.running

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return

        db.commit()

        entries = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations))
            .filter(StringEntry.id.in_(entry_ids))
            .all()
        )

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

        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = JobStatus.completed
            job.result = {"locales": locales, "items": items}
            job.completed_at = datetime.now(UTC)

        db.commit()
    except Exception as exc:
        db.rollback()
        failed = SessionLocal()
        try:
            job = failed.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = JobStatus.failed
                job.error = str(exc)
                job.completed_at = datetime.now(UTC)
                failed.commit()
        finally:
            failed.close()
        raise
    finally:
        db.close()
