"""Fix translate router — remove broken get_job (lives in jobs.py)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.ai import translate_text
from app.auth import project_access
from app.database import SessionLocal, get_db
from app.models import Job, JobStatus, Project, StringEntry, Tag, Translation
from app.schemas import (
    TranslatePreviewRequest,
    TranslatePreviewResult,
    TranslateRequest,
    TranslateResult,
)

router = APIRouter(tags=["translate"])

SYNC_THRESHOLD = 20


def _select_entries(
    db: Session, project: Project, payload: TranslateRequest
) -> list[StringEntry]:
    query = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id)
    )
    if payload.scope == "strings" and payload.string_ids:
        query = query.filter(StringEntry.id.in_(payload.string_ids))
    elif payload.scope == "module" and payload.module_id:
        query = query.filter(StringEntry.module_id == payload.module_id)
    elif payload.scope == "tag" and payload.tag_id:
        query = query.join(StringEntry.tags).filter(Tag.id == payload.tag_id)
    return query.all()


def _count_work(entries: list[StringEntry], locales: list[str], overwrite: bool) -> int:
    count = 0
    for entry in entries:
        for locale in locales:
            t = next((x for x in entry.translations if x.locale == locale), None)
            if t is None or (overwrite or not t.value.strip()):
                count += 1
    return count


def _run_translate(
    project_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    locales: list[str],
    overwrite: bool,
    batch_id: uuid.UUID,
    job_id: uuid.UUID | None = None,
) -> int:
    db = SessionLocal()
    try:
        if job_id:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = JobStatus.running

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return 0

        db.info["activity"] = {
            "actor_type": "system",
            "actor_id": None,
            "actor_label": "AI translate",
            "batch_id": str(batch_id),
            "batch_kind": "translate",
        }

        entries = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations))
            .filter(StringEntry.id.in_(entry_ids))
            .all()
        )
        translated = 0
        for entry in entries:
            for locale in locales:
                translation = next((t for t in entry.translations if t.locale == locale), None)
                if translation is None:
                    translation = Translation(
                        string_id=entry.id,
                        locale=locale,
                        value="",
                    )
                    db.add(translation)
                    entry.translations.append(translation)

                if translation.value.strip() and not overwrite:
                    continue

                try:
                    translation.value = translate_text(
                        entry.source_text,
                        project.base_language,
                        locale,
                        entry.description,
                    )
                    translated += 1
                except Exception as exc:
                    if job_id:
                        job = db.query(Job).filter(Job.id == job_id).first()
                        if job:
                            job.status = JobStatus.failed
                            job.error = str(exc)
                            job.completed_at = datetime.now(UTC)
                        db.commit()
                    raise

        if job_id:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = JobStatus.completed
                job.result = {"translated_count": translated, "locales": locales}
                job.completed_at = datetime.now(UTC)

        db.commit()
        return translated
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.post("/projects/{project_id}/translate", response_model=TranslateResult)
def translate(
    project_id: uuid.UUID,
    payload: TranslateRequest,
    background_tasks: BackgroundTasks,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> TranslateResult:
    locales = payload.locales or list(project.target_languages)
    entries = _select_entries(db, project, payload)
    work = _count_work(entries, locales, payload.overwrite)
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
            _run_translate,
            project.id,
            entry_ids,
            locales,
            payload.overwrite,
            batch_id,
            job.id,
        )
        return TranslateResult(translated_count=0, locales=locales, job_id=job.id)

    existing = db.info.get("activity") or {}
    db.info["activity"] = {**existing, "batch_id": str(batch_id), "batch_kind": "translate"}

    translated = 0
    for entry in entries:
        for locale in locales:
            translation = next((t for t in entry.translations if t.locale == locale), None)
            if translation is None:
                translation = Translation(
                    string_id=entry.id,
                    locale=locale,
                    value="",
                )
                db.add(translation)
                entry.translations.append(translation)

            if translation.value.strip() and not payload.overwrite:
                continue

            try:
                translation.value = translate_text(
                    entry.source_text,
                    project.base_language,
                    locale,
                    entry.description,
                )
                translated += 1
            except ValueError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"AI translation failed: {exc}") from exc

    db.commit()
    return TranslateResult(translated_count=translated, locales=locales)


@router.post("/projects/{project_id}/translate/preview", response_model=TranslatePreviewResult)
def translate_preview(
    project_id: uuid.UUID,
    payload: TranslatePreviewRequest,
    project: Project = Depends(project_access),
) -> TranslatePreviewResult:
    locales = payload.locales or list(project.target_languages)
    allowed = set(project.target_languages)
    allowed.add(project.base_language)
    for locale in locales:
        if locale not in allowed:
            raise HTTPException(status_code=400, detail=f"Locale '{locale}' is not configured")

    translations: dict[str, str] = {}
    for locale in locales:
        try:
            translations[locale] = translate_text(
                payload.source_text,
                project.base_language,
                locale,
                payload.description,
            )
        except ValueError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AI translation failed: {exc}") from exc
    return TranslatePreviewResult(translations=translations)
