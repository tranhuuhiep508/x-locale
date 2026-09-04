"""AI translate: one Bedrock tool call per string chunk, all requested locales."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.ai import TranslatedCell, TranslateItem, as_translated_cell, translate_batch
from app.database import SessionLocal
from app.models import Job, JobStatus, Project, StringEntry, Tag, Translation, TranslationStatus
from app.schemas import TranslateApplyItem, TranslateRequest

SYNC_THRESHOLD = 20


def select_entries(
    db: Session, project: Project, payload: TranslateRequest
) -> list[StringEntry]:
    query = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id, StringEntry.deleted_at.is_(None))
    )
    if payload.scope == "strings" and payload.string_ids:
        query = query.filter(StringEntry.id.in_(payload.string_ids))
    elif payload.scope == "module" and payload.module_id:
        query = query.filter(StringEntry.module_id == payload.module_id)
    elif payload.scope == "tag" and payload.tag_id:
        query = query.join(StringEntry.tags).filter(Tag.id == payload.tag_id)
    return query.all()


def needed_locales(entry: StringEntry, locales: list[str], overwrite: bool) -> list[str]:
    by_locale = {t.locale: t for t in entry.translations}
    needed: list[str] = []
    for locale in locales:
        translation = by_locale.get(locale)
        if translation is None or overwrite or not translation.value.strip():
            needed.append(locale)
    return needed


def work_items(
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
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
                context=entry.description,
            )
        )
    return items


def count_work(entries: list[StringEntry], locales: list[str], overwrite: bool) -> int:
    return len(work_items(entries, locales, overwrite))


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
) -> dict[str, Any]:
    return {
        "string_id": str(entry.id),
        "key": entry.key,
        "source_text": entry.source_text,
        "status": _status_str(entry),
        "description": entry.description,
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
        items.append(_proposal_dict(entry, {locale: "" for locale in needed}))
    return items


def propose_translations(
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
) -> list[dict[str, Any]]:
    items = work_items(entries, locales, overwrite)
    if not items:
        return []

    results = translate_batch(project.base_language, items)
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
            _proposal_dict(entry, translations, _scores_from_cells(locale_map, item.locales))
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
) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = JobStatus.running

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return

        entries = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations))
            .filter(StringEntry.id.in_(entry_ids))
            .all()
        )
        items = propose_translations(project, entries, locales, overwrite)

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
