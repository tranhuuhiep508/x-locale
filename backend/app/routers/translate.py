"""Translate missing strings with AI (sync or background job)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.activity import attach_batch
from app.ai import AIConfigurationError, log_ai_failure, safe_ai_error
from app.auth import ProjectAccess
from app.database import DbSession
from app.helpers import require_locale_code
from app.models import Job, JobStatus, Module
from app.schemas import (
    TranslateApplyRequest,
    TranslateApplyResult,
    TranslatePreviewRequest,
    TranslatePreviewResult,
    TranslateProposalsResult,
    TranslateRequest,
    TranslateResult,
    TranslationMemoryRequest,
    TranslationMemoryResult,
    TranslationQaRequest,
    TranslationQaResult,
    TranslationSourceConflict,
)
from app.services.strings import get_string, validate_locales
from app.services.translate import (
    SYNC_THRESHOLD,
    apply_translations,
    commit_proposals,
    count_work,
    list_missing_page,
    parse_descriptions,
    preview_translations,
    propose_translations,
    queued_progress,
    resolve_translation_locales,
    run_propose_job,
    run_translate_job,
    select_entries,
    serialize_descriptions,
)
from app.services.translation_memory import lookup_memory
from app.services.translation_qa import check_translation

router = APIRouter(prefix="/projects/{project_id}", tags=["translate"])


def _actor_from_session(db: DbSession) -> dict[str, str | None]:
    info = db.info.get("activity") or {}
    return {
        "actor_type": info.get("actor_type") or "user",
        "actor_id": info.get("actor_id"),
        "actor_label": info.get("actor_label") or "user",
    }


def _ai_http_error(exc: Exception) -> HTTPException:
    log_ai_failure(exc)
    return HTTPException(
        status_code=503 if isinstance(exc, AIConfigurationError) else 502,
        detail=safe_ai_error(exc),
    )


@router.post("/translate", response_model=TranslateResult)
def translate(
    payload: TranslateRequest,
    background_tasks: BackgroundTasks,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateResult:
    locales = resolve_translation_locales(project, payload.locales)
    entries = select_entries(db, project, payload, locales)
    work = count_work(entries, locales, payload.overwrite)
    batch_id = uuid.uuid4()
    entry_ids = [e.id for e in entries]

    if work > SYNC_THRESHOLD:
        job = Job(
            project_id=project.id,
            kind="translate",
            status=JobStatus.pending,
            payload={
                "scope": payload.scope,
                "locales": locales,
                "overwrite": payload.overwrite,
                "entry_count": len(entry_ids),
                "actor": _actor_from_session(db),
            },
        )
        db.add(job)
        db.flush()
        queued_project_id, job_id = project.id, job.id
        # Keep the request connection released while its background task runs.
        db.commit()
        background_tasks.add_task(
            run_translate_job,
            queued_project_id,
            entry_ids,
            locales,
            payload.overwrite,
            batch_id,
            job_id,
        )
        return TranslateResult(translated_count=0, locales=locales, job_id=job_id)

    attach_batch(db, batch_id, "translate")
    try:
        translated, skipped = apply_translations(db, project, entries, locales, payload.overwrite)
    except HTTPException:
        raise
    except Exception as exc:
        raise _ai_http_error(exc) from None

    db.commit()
    return TranslateResult(
        translated_count=translated, locales=locales, skipped_source_conflicts=skipped
    )


@router.post("/translate/preview", response_model=TranslatePreviewResult)
def translate_preview(
    payload: TranslatePreviewRequest,
    project: ProjectAccess,
    db: DbSession,
) -> TranslatePreviewResult:
    locales = resolve_translation_locales(project, payload.locales)

    module = None
    if payload.module_id is not None:
        module = (
            db.query(Module)
            .filter(Module.id == payload.module_id, Module.project_id == project.id)
            .first()
        )
        if module is None:
            raise HTTPException(status_code=400, detail="Unknown module")

    try:
        translations, scores, issues = preview_translations(
            project,
            module,
            payload.source_text,
            locales,
            payload.description,
            db=db,
        )
    except Exception as exc:
        raise _ai_http_error(exc) from None
    return TranslatePreviewResult(translations=translations, scores=scores, issues=issues)


@router.post("/translate/memory", response_model=TranslationMemoryResult)
def translate_memory(
    payload: TranslationMemoryRequest,
    project: ProjectAccess,
    db: DbSession,
) -> TranslationMemoryResult:
    locales = resolve_translation_locales(project, payload.locales)
    if payload.string_id is not None:
        entry = get_string(db, project.id, payload.string_id)
        if entry.deleted_at is not None:
            raise HTTPException(404, detail="String not found")
        if entry.source_text != payload.expected_source_text:
            raise HTTPException(
                409,
                detail={
                    "code": "stale_translation_source",
                    "message": "Source text changed. Refresh before using translation memory.",
                    "conflicts": [
                        TranslationSourceConflict(
                            string_id=entry.id,
                            key=entry.key,
                            expected_source_text=payload.expected_source_text,
                            source_text=entry.source_text,
                        ).model_dump(mode="json")
                    ],
                },
            )
    matches = lookup_memory(db, project, ((payload.source_text, locale) for locale in locales))
    return TranslationMemoryResult(
        source_text=payload.source_text, matches=matches.get(payload.source_text, {})
    )


@router.post("/translate/qa", response_model=TranslationQaResult)
def translate_qa(payload: TranslationQaRequest, project: ProjectAccess) -> TranslationQaResult:
    """Read-only check for the edit form. Computes issues and stores nothing."""
    require_locale_code(payload.locale)
    validate_locales(project, [payload.locale])
    issues = check_translation(payload.source_text, payload.translation, payload.locale)
    return TranslationQaResult(locale=payload.locale, issues=[issue.as_dict() for issue in issues])


@router.post("/translate/missing", response_model=TranslateProposalsResult)
def translate_missing(
    payload: TranslateRequest,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateProposalsResult:
    locales = resolve_translation_locales(project, payload.locales)
    items, total, page, page_size = list_missing_page(db, project, payload, locales)
    return TranslateProposalsResult(
        locales=locales,
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/translate/proposals", response_model=TranslateProposalsResult)
def translate_proposals(
    payload: TranslateRequest,
    background_tasks: BackgroundTasks,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateProposalsResult:
    locales = resolve_translation_locales(project, payload.locales)
    entries = select_entries(db, project, payload, locales)
    descriptions = parse_descriptions(payload.descriptions)
    work = count_work(entries, locales, payload.overwrite, payload.exclude_cells)
    entry_ids = [e.id for e in entries]
    desc_payload = serialize_descriptions(descriptions)

    if work > SYNC_THRESHOLD:
        job = Job(
            project_id=project.id,
            kind="translate_proposals",
            status=JobStatus.pending,
            payload={
                "scope": payload.scope,
                "locales": locales,
                "overwrite": payload.overwrite,
                "entry_count": len(entry_ids),
                "descriptions": desc_payload,
                "exclude_cells": {str(key): value for key, value in payload.exclude_cells.items()},
                "progress": queued_progress(work),
            },
        )
        db.add(job)
        db.flush()
        queued_project_id, job_id = project.id, job.id
        # Keep the request connection released while its background task runs.
        db.commit()
        background_tasks.add_task(
            run_propose_job,
            queued_project_id,
            entry_ids,
            locales,
            payload.overwrite,
            job_id,
            desc_payload,
            {str(key): value for key, value in payload.exclude_cells.items()},
        )
        return TranslateProposalsResult(
            locales=locales,
            items=[],
            job_id=job_id,
            total=work,
            page=1,
            page_size=max(work, 1),
        )

    try:
        items = propose_translations(
            project,
            entries,
            locales,
            payload.overwrite,
            descriptions,
            exclude_cells=payload.exclude_cells,
        )
    except Exception as exc:
        raise _ai_http_error(exc) from None
    return TranslateProposalsResult(
        locales=locales,
        items=items,
        total=len(items),
        page=1,
        page_size=max(len(items), 1),
    )


@router.post("/translate/apply", response_model=TranslateApplyResult)
def translate_apply(
    payload: TranslateApplyRequest,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateApplyResult:
    batch_id = uuid.uuid4()
    attach_batch(db, batch_id, "translate")
    translated, locales = commit_proposals(db, project, payload.items)
    db.commit()
    return TranslateApplyResult(
        translated_count=translated,
        batch_id=batch_id,
        locales=locales,
    )
