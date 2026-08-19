"""Stage-aware export/import and legacy translations.json."""

from __future__ import annotations

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response

from app.activity import attach_batch
from app.auth import ProjectAccess
from app.database import DbSession
from app.models import TranslationStatus
from app.schemas import ImportPayload, ImportResult
from app.services.sync import (
    build_flat_export,
    build_modular_export,
    import_flat_strings,
    import_json_data,
    load_export_entries,
    normalize_export_stage,
)

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
    entries = load_export_entries(db, project.id)

    if format == "xlsx":
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

    if effective_layout == "modular":
        payload = build_modular_export(project, entries, effective_stage, locale=locale)
    else:
        payload = build_flat_export(project, entries, effective_stage, locale=locale)

    filename = _export_filename(project, stage, locale, "json")
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/translations.json")
def export_translations_compat(
    project: ProjectAccess,
    db: DbSession,
    stage: Annotated[str, Query(pattern="^(draft|public|all)$")] = "draft",
) -> dict[str, dict[str, str]]:
    """Back-compat flat export used by older CLI."""
    entries = load_export_entries(db, project.id)
    return build_flat_export(project, entries, normalize_export_stage(stage))


@router.post("/import", response_model=ImportResult)
async def import_project(
    project: ProjectAccess,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    dry_run: Annotated[bool, Query()] = False,
    status: Annotated[str, Query(pattern="^(draft|public)$")] = "draft",
    locale: Annotated[str | None, Query()] = None,
) -> ImportResult:
    batch_id = uuid.uuid4()
    attach_batch(db, batch_id, "import")
    import_status = TranslationStatus(status)

    filename = (file.filename or "").lower()
    raw = await file.read()
    if filename.endswith(".xlsx") or (file.content_type or "").endswith("spreadsheetml.sheet"):
        from app.excel import import_workbook

        db.info["activity"]["batch_kind"] = "excel_import"
        try:
            result = import_workbook(
                db, project, raw, dry_run=dry_run, status=import_status
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not dry_run:
            db.commit()
        result.batch_id = batch_id
        return result

    if filename.endswith(".json") or (file.content_type or "").endswith("json") or not filename:
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON file") from exc
        result = import_json_data(
            db, project, data, dry_run=dry_run, locale=locale, status=import_status
        )
        if not dry_run:
            db.commit()
        result.batch_id = batch_id
        return result

    raise HTTPException(status_code=400, detail="Unsupported file type")


@router.post("/strings/import", response_model=ImportResult)
def import_strings_compat(
    payload: ImportPayload,
    project: ProjectAccess,
    db: DbSession,
    dry_run: Annotated[bool, Query()] = False,
) -> ImportResult:
    """JSON-body import used by the CLI push command."""
    batch_id = uuid.uuid4()
    attach_batch(db, batch_id, "import")
    if payload.modules:
        result = import_json_data(
            db, project, {"modules": payload.modules}, dry_run=dry_run
        )
    elif payload.strings:
        result = import_flat_strings(db, project, payload.strings, dry_run=dry_run)
    else:
        raise HTTPException(status_code=400, detail="strings required")
    if not dry_run:
        db.commit()
    result.batch_id = batch_id
    return result
