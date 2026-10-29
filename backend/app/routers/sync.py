"""Stage-aware export/import and legacy translations.json."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from app.activity import attach_batch
from app.auth import ProjectAccess
from app.database import DbSession
from app.limits import IMPORT_MAX_BYTES
from app.models import Project, TranslationStatus
from app.schemas import ImportPayload, ImportResult, JobAcceptedOut, SyncStateOut
from app.services.import_lock import acquire_import_lock
from app.services.imports import (
    FileImportOptions,
    import_file,
    import_payload,
    import_size,
    parse_import_file,
    payload_size,
    validate_import_base_language,
)
from app.services.jobs import (
    JobWork,
    accepted_response,
    launch_job,
    runs_async,
    wants_async,
)
from app.services.sync import (
    build_flat_export,
    build_modular_export,
    build_sync_state,
    load_export_entries,
    load_export_rows,
    normalize_export_stage,
    resolve_export_locales,
)
from app.upload_limits import LimitedImportRoute

router = APIRouter(prefix="/projects/{project_id}", tags=["sync"])


def _export_filename(project, stage: str, locale: str | None, ext: str) -> str:
    parts = [project.slug]
    if locale:
        parts.append(locale)
    parts.append(stage)
    return f"{'-'.join(parts)}.{ext}"


@router.get("/export")
def export_project(
    project: ProjectAccess,
    db: DbSession,
    format: Annotated[str, Query(pattern="^(json|xlsx)$")] = "json",
    layout: Annotated[str | None, Query(pattern="^(flat|modular)$")] = None,
    stage: Annotated[str, Query(pattern="^(draft|public|all)$")] = "draft",
    locale: Annotated[str | None, Query()] = None,
):
    effective_layout = layout or (
        project.layout.value if hasattr(project.layout, "value") else project.layout
    )
    effective_stage = normalize_export_stage(stage)

    if format == "xlsx":
        entries = load_export_entries(db, project.id)
        from app.excel import build_workbook

        try:
            data = build_workbook(project, entries, effective_stage, locale=locale)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        filename = _export_filename(project, stage, locale, "xlsx")
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    target_locales = [
        loc for loc in resolve_export_locales(project, locale) if loc != project.base_language
    ]
    rows = load_export_rows(db, project.id, target_locales)
    if effective_layout == "modular":
        payload = build_modular_export(project, rows, effective_stage, locale=locale)
    else:
        payload = build_flat_export(project, rows, effective_stage, locale=locale)

    filename = _export_filename(project, stage, locale, "json")
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sync-state", response_model=SyncStateOut)
def project_sync_state(
    project: ProjectAccess,
    db: DbSession,
    layout: Annotated[str | None, Query(pattern="^(flat|modular)$")] = None,
    stage: Annotated[str, Query(pattern="^(draft|public|all)$")] = "draft",
) -> SyncStateOut:
    """Pending-remove and tombstone identities for CLI status."""
    effective_layout = layout or (
        project.layout.value if hasattr(project.layout, "value") else project.layout
    )
    effective_stage = normalize_export_stage(stage)
    rows = load_export_rows(db, project.id, [])
    return build_sync_state(project, rows, effective_layout, effective_stage)


@router.get("/translations.json")
def export_translations_compat(
    project: ProjectAccess,
    db: DbSession,
    stage: Annotated[str, Query(pattern="^(draft|public|all)$")] = "draft",
) -> dict[str, dict[str, str]]:
    """Back-compat flat export used by older CLI."""
    target_locales = [
        loc for loc in resolve_export_locales(project, None) if loc != project.base_language
    ]
    rows = load_export_rows(db, project.id, target_locales)
    return build_flat_export(project, rows, normalize_export_stage(stage))


@router.get("/import-template")
def download_import_template(
    project: ProjectAccess,
    format: Annotated[str, Query(pattern="^(json|xlsx)$")] = "json",
):
    """Demo file for the project's layout so importers can copy the expected shape."""
    if format == "xlsx":
        from app.excel import build_template_workbook

        data = build_template_workbook(project)
        filename = f"{project.slug}-import-template.xlsx"
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    from app.excel import DEMO_IMPORT_ROWS

    payload = {key: source for rows in DEMO_IMPORT_ROWS.values() for key, source in rows}
    filename = f"{project.base_language}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _import_job_work(
    batch_id: uuid.UUID, dry_run: bool, run: Callable[[Session, Project], ImportResult]
) -> JobWork:
    def work(db: Session, project: Project) -> dict:
        attach_batch(db, batch_id, "import")
        result = run(db, project)
        if dry_run:
            db.rollback()
        result.batch_id = batch_id
        return result.model_dump(mode="json")

    return work


ASYNC_RESPONSES = {202: {"model": JobAcceptedOut, "description": "Import runs as a background job"}}


def import_project(
    project: ProjectAccess,
    db: DbSession,
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    dry_run: Annotated[bool, Query()] = False,
    status: Annotated[str, Query(pattern="^(draft|public)$")] = "draft",
    locale: Annotated[str | None, Query()] = None,
    module_id: Annotated[uuid.UUID | None, Query()] = None,
    tag_ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    partial: Annotated[bool, Query()] = False,
    prefer: Annotated[str | None, Header()] = None,
):
    acquire_import_lock(db, project.id)
    db.refresh(project)
    batch_id = uuid.uuid4()
    options = FileImportOptions(
        dry_run=dry_run,
        status=TranslationStatus(status),
        locale=locale,
        module_id=module_id,
        tag_ids=tag_ids,
        partial=partial,
    )
    raw = file.file.read(IMPORT_MAX_BYTES + 1)
    if len(raw) > IMPORT_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Import file must be at most {IMPORT_MAX_BYTES} bytes",
        )
    parsed = parse_import_file(raw, file.filename, file.content_type)

    excel = parsed.excel is not None
    if wants_async(prefer) and (excel or runs_async(prefer, import_size(parsed.data))):
        job = launch_job(
            db,
            project.id,
            "excel_import" if excel else "import",
            {"batch_id": str(batch_id), "dry_run": dry_run},
            _import_job_work(
                batch_id,
                dry_run,
                lambda job_db, job_project: import_file(job_db, job_project, parsed, options),
            ),
        )
        return accepted_response(job)

    attach_batch(db, batch_id, "import")
    result = import_file(db, project, parsed, options)
    if not dry_run:
        db.commit()
    result.batch_id = batch_id
    return result


router.add_api_route(
    "/import",
    import_project,
    methods=["POST"],
    response_model=ImportResult,
    responses={**ASYNC_RESPONSES, 413: {"description": "Import request exceeds 21 MiB"}},
    route_class_override=LimitedImportRoute,
)


@router.post("/strings/import", response_model=ImportResult, responses=ASYNC_RESPONSES)
def import_strings_compat(
    payload: ImportPayload,
    project: ProjectAccess,
    db: DbSession,
    background_tasks: BackgroundTasks,
    dry_run: Annotated[bool, Query()] = False,
    partial: Annotated[bool, Query()] = False,
    prefer: Annotated[str | None, Header()] = None,
):
    """JSON-body import used by the CLI push command."""
    validate_import_base_language(project, payload)
    acquire_import_lock(db, project.id)
    db.refresh(project)
    validate_import_base_language(project, payload)
    if not payload.modules and payload.strings is None:
        raise HTTPException(status_code=400, detail="strings required")
    batch_id = uuid.uuid4()
    if runs_async(prefer, payload_size(payload)):
        job = launch_job(
            db,
            project.id,
            "import",
            {"batch_id": str(batch_id), "dry_run": dry_run},
            _import_job_work(
                batch_id,
                dry_run,
                lambda job_db, job_project: import_payload(
                    job_db, job_project, payload, dry_run=dry_run, partial=partial
                ),
            ),
        )
        return accepted_response(job)

    attach_batch(db, batch_id, "import")
    result = import_payload(db, project, payload, dry_run=dry_run, partial=partial)
    if not dry_run:
        db.commit()
    result.batch_id = batch_id
    return result
