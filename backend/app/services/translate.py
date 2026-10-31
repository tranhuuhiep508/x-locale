"""AI translate: one AI request per string chunk, all requested locales."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from dataclasses import replace
from typing import Any

from fastapi import HTTPException
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, joinedload, object_session

from app.activity import attach_batch
from app.ai import (
    AITranslationError,
    ProgressCallback,
    ProgressPhase,
    TranslatedCell,
    TranslateItem,
    as_translated_cell,
    log_ai_failure,
    safe_ai_error,
    translate_batch,
)
from app.config import settings
from app.database import SessionLocal
from app.helpers import require_locale_code, require_max_length
from app.limits import TEXT_MAX_LENGTH
from app.models import Job, JobStatus, Module, Project, StringEntry, Translation, TranslationStatus
from app.schemas import TranslateApplyItem, TranslateRequest, TranslationSourceConflict
from app.services.catalog import owned_module
from app.services.job_progress import write_job_progress
from app.services.jobs import _finish, owned_job_connection
from app.services.strings import (
    _missing_locales_clause,
    filtered_string_query,
    load_string_entries,
    validate_locales,
)
from app.services.translation_memory import memory_examples, optional_memory
from app.services.translation_qa import check_translation

SYNC_THRESHOLD = 20


def resolve_translation_locales(project: Project, locales: list[str] | None) -> list[str]:
    targets = locales or [loc for loc in project.target_languages if loc != project.base_language]
    validate_locales(project, targets)
    return targets


def _entries_query(
    db: Session,
    project: Project,
    payload: TranslateRequest,
    locales: list[str],
    *,
    eager: bool,
):
    validate_locales(project, locales)
    for excluded in payload.exclude_cells.values():
        validate_locales(project, excluded)
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
    target_locales = resolve_translation_locales(project, locales or payload.locales)
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
    items = list_missing_items(entries, locales, payload.overwrite)
    memory, memory_error = optional_memory(
        db,
        project,
        ((item["source_text"], locale) for item in items for locale in item["translations"]),
    )
    for item in items:
        item["memory"] = memory.get(item["source_text"], {})
        item["memory_error"] = memory_error
    return items, total, page, page_size


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


def _description_for(entry: StringEntry, descriptions: dict[uuid.UUID, str] | None) -> str | None:
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
    exclude_cells: dict[uuid.UUID, list[str]] | None = None,
) -> list[TranslateItem]:
    validate_locales(project, locales)
    items: list[TranslateItem] = []
    for entry in entries:
        needed = [
            locale
            for locale in needed_locales(entry, locales, overwrite)
            if locale not in (exclude_cells or {}).get(entry.id, [])
        ]
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
    exclude_cells: dict[uuid.UUID, list[str]] | None = None,
) -> int:
    return sum(
        any(
            locale not in (exclude_cells or {}).get(entry.id, [])
            for locale in needed_locales(entry, locales, overwrite)
        )
        for entry in entries
    )


def with_memory(
    db: Session,
    project: Project,
    items: list[TranslateItem],
    fields: dict[str, dict[str, Any]] | None = None,
) -> list[TranslateItem]:
    memory, memory_error = optional_memory(
        db, project, ((item.source_text, locale) for item in items for locale in item.locales)
    )
    if fields is not None:
        for item in items:
            fields[item.id]["memory_error"] = memory_error
            fields[item.id]["memory"] = {
                locale: [match.model_dump(mode="json") for match in matches]
                for locale, matches in memory.get(item.source_text, {}).items()
            }
    return [
        replace(item, memory_examples=memory_examples(memory.get(item.source_text, {})))
        for item in items
    ]


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


def save_translations(
    db: Session,
    project: Project,
    items: list[TranslateItem],
    results: dict[str, dict],
    overwrite: bool,
) -> tuple[int, list[TranslationSourceConflict]]:
    if not items:
        return 0, []
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
            require_max_length(cell.text, field="value", limit=TEXT_MAX_LENGTH)
            translation.value = cell.text
            translation.confidence = cell.confidence
            translated += 1
    return translated, skipped


def apply_translations(
    db: Session,
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
) -> tuple[int, list[TranslationSourceConflict]]:
    items = with_memory(db, project, work_items(project, entries, locales, overwrite))
    if not items:
        return 0, []
    results = translate_batch(project.base_language, items)
    return save_translations(db, project, items, results, overwrite)


def preview_translations(
    project: Project,
    module: Module | None,
    source_text: str,
    locales: list[str],
    description: str | None,
    db: Session | None = None,
) -> tuple[dict[str, str], dict[str, int], dict[str, list[dict[str, Any]]]]:
    validate_locales(project, locales)
    db = db if db is not None else object_session(project)
    memory, _ = (
        optional_memory(db, project, ((source_text, locale) for locale in locales))
        if db is not None
        else ({}, None)
    )
    examples = memory_examples(memory.get(source_text, {}))
    result = translate_batch(
        project.base_language,
        [
            TranslateItem(
                id="preview",
                source_text=source_text,
                locales=tuple(locales),
                context=compose_translation_context(project, module, description),
                memory_examples=examples,
            )
        ],
    )
    cells = _cell_map(result, "preview")
    translations = {locale: cells[locale].text for locale in locales if locale in cells}
    return (
        translations,
        _scores_from_cells(cells, locales),
        _qa_by_locale(source_text, translations),
    )


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
    size = settings.ai_translate_batch_size
    return (work + size - 1) // size


def queued_progress(work: int) -> dict[str, int | str]:
    return {
        "phase": "queued",
        "chunks_done": 0,
        "chunks_total": chunk_count(work),
    }


def _proposal_fields(
    entry: StringEntry, descriptions: dict[uuid.UUID, str] | None
) -> dict[str, Any]:
    return {
        "string_id": str(entry.id),
        "key": entry.key,
        "status": _status_str(entry),
        "description": _description_for(entry, descriptions),
    }


def proposals_from_results(
    items: list[TranslateItem],
    results: dict[str, dict],
    fields: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    proposals: list[dict[str, Any]] = []
    for item in items:
        meta = fields.get(item.id)
        if meta is None:
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
            {
                **meta,
                "source_text": item.source_text,
                "translations": translations,
                "scores": _scores_from_cells(locale_map, item.locales),
                "issues": _qa_by_locale(item.source_text, translations),
            }
        )
    return proposals


def _qa_by_locale(source: str, translations: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    return {
        locale: [issue.as_dict() for issue in check_translation(source, text, locale)]
        for locale, text in translations.items()
    }


def propose_translations(
    project: Project,
    entries: list[StringEntry],
    locales: list[str],
    overwrite: bool,
    descriptions: dict[uuid.UUID, str] | None = None,
    on_progress: ProgressCallback | None = None,
    exclude_cells: dict[uuid.UUID, list[str]] | None = None,
) -> list[dict[str, Any]]:
    items = work_items(project, entries, locales, overwrite, descriptions, exclude_cells)
    fields = {str(entry.id): _proposal_fields(entry, descriptions) for entry in entries}
    db = object_session(project)
    if db is not None:
        items = with_memory(db, project, items, fields)
    if not items:
        return []
    results = translate_batch(project.base_language, items, on_progress=on_progress)
    return proposals_from_results(items, results, fields)


def commit_proposals(
    db: Session,
    project: Project,
    items: list[TranslateApplyItem],
) -> tuple[int, list[str]]:
    if not items:
        return 0, []

    # Legacy proposal clients silently skip unconfigured targets; only reject the base here.
    if any(project.base_language in item.translations for item in items):
        validate_locales(project, [project.base_language])
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


def _claim_ai_job(job_id: uuid.UUID) -> bool:
    with SessionLocal() as db:
        job = (
            db.query(Job)
            .filter(Job.id == job_id, Job.status == JobStatus.pending)
            .with_for_update()
            .first()
        )
        if job is None:
            return False
        job.status = JobStatus.running
        db.commit()
        return True


def _fail_ai_job(job_id: uuid.UUID, message: str) -> None:
    with SessionLocal() as db:
        job = (
            db.query(Job)
            .filter(Job.id == job_id, Job.status == JobStatus.running)
            .with_for_update()
            .first()
        )
        if job is None:
            return
        _finish(job, JobStatus.failed, phase="failed")
        job.error = message
        db.commit()


def _require_job_lock(conn: Connection | None) -> None:
    if conn is not None and conn.invalidated:
        raise RuntimeError("AI job lost its database connection")


def _actor_from_job(db: Session, job_id: uuid.UUID | None) -> dict[str, Any]:
    actor: dict[str, Any] = {}
    if job_id is not None:
        job = db.get(Job, job_id)
        actor = dict((job.payload or {}).get("actor") or {}) if job is not None else {}
    else:
        actor = dict(db.info.get("activity") or {})
    return {
        "actor_type": actor.get("actor_type") or "user",
        "actor_id": actor.get("actor_id"),
        "actor_label": actor.get("actor_label") or "user",
    }


@contextmanager
def _ai_job(job_id: uuid.UUID | None) -> Iterator[tuple[bool, Connection | None]]:
    """Own the job lock for the whole run; work sessions come from the request pool."""
    with owned_job_connection(job_id) if job_id else nullcontext() as conn:
        try:
            if job_id is not None and not _claim_ai_job(job_id):
                yield False, conn
                return
            yield True, conn
        except Exception as exc:
            log_ai_failure(exc)
            # HTTPException and AITranslationError text is already safe for clients.
            message = (
                str(exc)
                if isinstance(exc, (HTTPException, AITranslationError))
                else safe_ai_error(exc)
            )
            # Never record a failure after losing ownership.
            if job_id is not None and not (conn is not None and conn.invalidated):
                _fail_ai_job(job_id, message)
            if isinstance(exc, (HTTPException, AITranslationError)):
                raise
            # The original message can contain request data. Its type and stack are logged.
            raise AITranslationError(message) from None


def _complete_ai_job(
    db: Session,
    job_id: uuid.UUID | None,
    result: dict[str, Any],
    *,
    lock_conn: Connection | None = None,
) -> bool:
    if job_id is not None:
        _require_job_lock(lock_conn)
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
    with _ai_job(job_id) as (owned, lock_conn):
        if not owned:
            return 0
        with SessionLocal() as db:
            project = db.get(Project, project_id)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
            base_language = project.base_language
            entries = _load_entries_by_ids(db, entry_ids)
            items = with_memory(db, project, work_items(project, entries, locales, overwrite))
            db.commit()
        _require_job_lock(lock_conn)
        results = translate_batch(base_language, items) if items else {}
        _require_job_lock(lock_conn)
        with SessionLocal() as db:
            project = db.get(Project, project_id)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
            db.info["activity"] = _actor_from_job(db, job_id)
            attach_batch(db, batch_id, "translate")
            translated, skipped = save_translations(db, project, items, results, overwrite)
            completed = _complete_ai_job(
                db,
                job_id,
                {
                    "translated_count": translated,
                    "locales": locales,
                    "skipped_source_conflicts": [item.model_dump(mode="json") for item in skipped],
                },
                lock_conn=lock_conn,
            )
            return translated if completed else 0


def run_propose_job(
    project_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    locales: list[str],
    overwrite: bool,
    job_id: uuid.UUID,
    descriptions: dict[str, str] | None = None,
    exclude_cells: dict[str, list[str]] | None = None,
) -> None:
    with _ai_job(job_id) as (owned, lock_conn):
        if not owned:
            return
        parsed = parse_descriptions(descriptions)
        with SessionLocal() as db:
            project = db.get(Project, project_id)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
            base_language = project.base_language
            entries = _load_entries_by_ids(db, entry_ids)
            exclusions = {uuid.UUID(key): value for key, value in (exclude_cells or {}).items()}
            fields = {str(entry.id): _proposal_fields(entry, parsed) for entry in entries}
            items = with_memory(
                db,
                project,
                work_items(project, entries, locales, overwrite, parsed, exclusions),
                fields,
            )
            db.commit()

        def on_progress(phase: ProgressPhase, chunks_done: int, chunks_total: int) -> None:
            write_job_progress(job_id, phase, chunks_done, chunks_total)

        _require_job_lock(lock_conn)
        results = translate_batch(base_language, items, on_progress=on_progress) if items else {}
        _require_job_lock(lock_conn)
        proposals = proposals_from_results(items, results, fields)
        with SessionLocal() as db:
            _complete_ai_job(
                db, job_id, {"locales": locales, "items": proposals}, lock_conn=lock_conn
            )
