"""Translate missing strings with AI (sync or background job)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.activity import attach_batch
from app.ai import AIConfigurationError, log_ai_failure, safe_ai_error
from app.auth import ProjectAccess
from app.database import DbSession
from app.models import Job, JobStatus, Module
from app.schemas import (
    TranslateApplyRequest,
    TranslateApplyResult,
    TranslatePreviewRequest,
    TranslatePreviewResult,
    TranslateProposalsResult,
    TranslateRequest,
    TranslateResult,
)
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
        db.commit()
        db.refresh(job)
        background_tasks.add_task(
            run_translate_job,
            project.id,
            entry_ids,
            locales,
            payload.overwrite,
            batch_id,
            job.id,
        )
        return TranslateResult(translated_count=0, locales=locales, job_id=job.id)

    attach_batch(db, batch_id, "translate")
    try:
        translated, skipped = apply_translations(db, project, entries, locales, payload.overwrite)
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
        translations, scores = preview_translations(
            project,
            module,
            payload.source_text,
            locales,
            payload.description,
        )
    except Exception as exc:
        raise _ai_http_error(exc) from None
    return TranslatePreviewResult(translations=translations, scores=scores)


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
    work = count_work(entries, locales, payload.overwrite)
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
                "progress": queued_progress(work),
            },
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        background_tasks.add_task(
            run_propose_job,
            project.id,
            entry_ids,
            locales,
            payload.overwrite,
            job.id,
            desc_payload,
        )
        return TranslateProposalsResult(
            locales=locales,
            items=[],
            job_id=job.id,
            total=work,
            page=1,
            page_size=max(work, 1),
        )

    try:
        items = propose_translations(project, entries, locales, payload.overwrite, descriptions)
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
