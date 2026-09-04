"""Translate missing strings via Bedrock (sync or background job)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.activity import attach_batch
from app.auth import ProjectAccess
from app.database import DbSession
from app.models import Job, JobStatus
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
    list_missing_items,
    preview_translations,
    propose_translations,
    run_propose_job,
    run_translate_job,
    select_entries,
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
    if isinstance(exc, ValueError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=502, detail=f"AI translation failed: {exc}")


@router.post("/translate", response_model=TranslateResult)
def translate(
    payload: TranslateRequest,
    background_tasks: BackgroundTasks,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateResult:
    locales = payload.locales or list(project.target_languages)
    entries = select_entries(db, project, payload)
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
        translated = apply_translations(db, project, entries, locales, payload.overwrite)
    except Exception as exc:
        raise _ai_http_error(exc) from exc

    db.commit()
    return TranslateResult(translated_count=translated, locales=locales)


@router.post("/translate/preview", response_model=TranslatePreviewResult)
def translate_preview(
    payload: TranslatePreviewRequest,
    project: ProjectAccess,
) -> TranslatePreviewResult:
    locales = payload.locales or list(project.target_languages)
    allowed = set(project.target_languages)
    allowed.add(project.base_language)
    for locale in locales:
        if locale not in allowed:
            raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured")

    try:
        translations, scores = preview_translations(
            project.base_language,
            payload.source_text,
            locales,
            payload.description,
        )
    except Exception as exc:
        raise _ai_http_error(exc) from exc
    return TranslatePreviewResult(translations=translations, scores=scores)


@router.post("/translate/missing", response_model=TranslateProposalsResult)
def translate_missing(
    payload: TranslateRequest,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateProposalsResult:
    locales = payload.locales or list(project.target_languages)
    entries = select_entries(db, project, payload)
    items = list_missing_items(entries, locales, payload.overwrite)
    return TranslateProposalsResult(locales=locales, items=items)


@router.post("/translate/proposals", response_model=TranslateProposalsResult)
def translate_proposals(
    payload: TranslateRequest,
    background_tasks: BackgroundTasks,
    project: ProjectAccess,
    db: DbSession,
) -> TranslateProposalsResult:
    locales = payload.locales or list(project.target_languages)
    entries = select_entries(db, project, payload)
    work = count_work(entries, locales, payload.overwrite)
    entry_ids = [e.id for e in entries]

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
        )
        return TranslateProposalsResult(locales=locales, items=[], job_id=job.id)

    try:
        items = propose_translations(project, entries, locales, payload.overwrite)
    except Exception as exc:
        raise _ai_http_error(exc) from exc
    return TranslateProposalsResult(locales=locales, items=items)


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
