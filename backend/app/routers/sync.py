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
    load_export_entries,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["sync"])


@router.get("/export")
def export_project(
    project: ProjectAccess,
    db: DbSession,
    format: Annotated[str, Query(pattern="^(json|xlsx)$")] = "json",
    layout: Annotated[str | None, Query(pattern="^(flat|modular)$")] = None,
    stage: Annotated[str, Query(pattern="^(draft|public)$")] = "draft",
):
    effective_layout = layout or (
        project.layout.value if hasattr(project.layout, "value") else project.layout
    )
    entries = load_export_entries(db, project.id)

    if format == "xlsx":
        from app.excel import build_workbook

        data = build_workbook(project, entries, stage)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{project.slug}-{stage}.xlsx"'
            },
        )

    if effective_layout == "modular":
        payload = build_modular_export(project, entries, stage)
    else:
        payload = build_flat_export(project, entries, stage)

    return JSONResponse(content=payload)


@router.get("/translations.json")
def export_translations_compat(
    project: ProjectAccess,
    db: DbSession,
    stage: Annotated[str, Query(pattern="^(draft|public)$")] = "draft",
) -> dict[str, dict[str, str]]:
    """Back-compat flat export used by older CLI."""
    entries = load_export_entries(db, project.id)
    return build_flat_export(project, entries, stage)


@router.post("/import", response_model=ImportResult)
async def import_project(
    project: ProjectAccess,
    db: DbSession,
    file: Annotated[UploadFile | None, File()] = None,
    dry_run: Annotated[bool, Query()] = False,
    status: Annotated[str, Query(pattern="^(draft|public)$")] = "draft",
    payload: ImportPayload | None = None,
) -> ImportResult:
    batch_id = uuid.uuid4()
    attach_batch(db, batch_id, "import")

    if file is not None:
        filename = (file.filename or "").lower()
        raw = await file.read()
        if filename.endswith(".xlsx"):
            from app.excel import import_workbook

            db.info["activity"]["batch_kind"] = "excel_import"
            result = import_workbook(
                db, project, raw, dry_run=dry_run, status=TranslationStatus(status)
            )
            if not dry_run:
                db.commit()
            result.batch_id = batch_id
            return result
        if filename.endswith(".json"):
            data = json.loads(raw.decode("utf-8"))
            if "strings" in data:
                strings = data["strings"]
            elif isinstance(data, dict) and all(isinstance(v, str) for v in data.values()):
                strings = data
            else:
                raise HTTPException(status_code=400, detail="Unrecognized JSON import shape")
            result = import_flat_strings(db, project, strings, dry_run=dry_run)
            if not dry_run:
                db.commit()
            result.batch_id = batch_id
            return result
        raise HTTPException(status_code=400, detail="Unsupported file type")

    if payload and payload.strings is not None:
        result = import_flat_strings(db, project, payload.strings, dry_run=dry_run)
        if not dry_run:
            db.commit()
        result.batch_id = batch_id
        return result

    raise HTTPException(status_code=400, detail="Provide a file upload or JSON body")


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
    if not payload.strings:
        raise HTTPException(status_code=400, detail="strings required")
    result = import_flat_strings(db, project, payload.strings, dry_run=dry_run)
    if not dry_run:
        db.commit()
    result.batch_id = batch_id
    return result
