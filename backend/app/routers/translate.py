"""Translate missing strings via Bedrock (sync or background job)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.activity import attach_batch
from app.auth import ProjectAccess
from app.database import DbSession
from app.models import Job, JobStatus
from app.schemas import (
    TranslatePreviewRequest,
    TranslatePreviewResult,
    TranslateRequest,
    TranslateResult,
)
from app.services.translate import (
    SYNC_THRESHOLD,
    apply_translations,
    count_work,
    preview_translations,
    run_translate_job,
    select_entries,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["translate"])


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
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI translation failed: {exc}") from exc

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
        translations = preview_translations(
            project.base_language,
            payload.source_text,
            locales,
            payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI translation failed: {exc}") from exc
    return TranslatePreviewResult(translations=translations)
