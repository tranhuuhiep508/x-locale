"""Stage-aware export/import and legacy translations.json."""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy.orm import Session, joinedload

from app.auth import project_access
from app.database import get_db
from app.helpers import content_hash, export_key
from app.models import Module, Project, ProjectLayout, StringEntry, Translation, TranslationStatus
from app.schemas import ImportDiff, ImportPayload, ImportResult

router = APIRouter(tags=["sync"])


def _translation_value(
    entry: StringEntry,
    locale: str,
    project: Project,
    stage: str,
) -> str | None:
    """Return value for locale given stage, or None to omit."""
    if locale == project.base_language:
        return entry.source_text

    translation = next((t for t in entry.translations if t.locale == locale), None)
    if stage == "public":
        if translation and translation.value.strip() and translation.status == TranslationStatus.public:
            return translation.value
        # Fallback to source so production never renders a raw key
        return entry.source_text
    # draft stage: latest value
    if translation and translation.value.strip():
        return translation.value
    return None


def build_flat_export(
    project: Project, entries: list[StringEntry], stage: str
) -> dict[str, dict[str, str]]:
    locales = [project.base_language, *project.target_languages]
    result: dict[str, dict[str, str]] = {loc: {} for loc in locales}
    for entry in entries:
        key = export_key(entry, "flat")
        for locale in locales:
            val = _translation_value(entry, locale, project, stage)
            if val is not None:
                result[locale][key] = val
            elif locale == project.base_language:
                result[locale][key] = entry.source_text
    return result


def build_modular_export(
    project: Project, entries: list[StringEntry], stage: str
) -> dict[str, Any]:
    locales = [project.base_language, *project.target_languages]
    modules: dict[str, dict[str, dict[str, str]]] = {}
    unassigned: dict[str, dict[str, str]] = {loc: {} for loc in locales}

    for entry in entries:
        bucket_key = entry.module.slug if entry.module else None
        if bucket_key:
            if bucket_key not in modules:
                modules[bucket_key] = {loc: {} for loc in locales}
            target = modules[bucket_key]
        else:
            target = unassigned

        for locale in locales:
            val = _translation_value(entry, locale, project, stage)
            if val is not None:
                target[locale][entry.key] = val
            elif locale == project.base_language:
                target[locale][entry.key] = entry.source_text

    module_list = sorted(modules.keys())
    manifest = {
        "modules": module_list,
        "locales": locales,
        "base_language": project.base_language,
        "content_hash": content_hash({"modules": modules, "unassigned": unassigned}),
    }
    return {"modules": modules, "unassigned": unassigned, "manifest": manifest}


@router.get("/projects/{project_id}/export")
def export_project(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    format: str = Query(default="json", pattern="^(json|xlsx)$"),
    layout: str | None = Query(default=None, pattern="^(flat|modular)$"),
    stage: str = Query(default="draft", pattern="^(draft|public)$"),
):
    effective_layout = layout or (
        project.layout.value if hasattr(project.layout, "value") else project.layout
    )
    entries = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.module),
            joinedload(StringEntry.tags),
        )
        .filter(StringEntry.project_id == project.id)
        .order_by(StringEntry.key)
        .all()
    )

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


@router.get("/projects/{project_id}/translations.json")
def export_translations_compat(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    stage: str = Query(default="draft", pattern="^(draft|public)$"),
) -> dict[str, dict[str, str]]:
    """Back-compat flat export used by older CLI."""
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations), joinedload(StringEntry.module))
        .filter(StringEntry.project_id == project.id)
        .order_by(StringEntry.key)
        .all()
    )
    return build_flat_export(project, entries, stage)


def _import_flat_strings(
    db: Session,
    project: Project,
    strings: dict[str, str],
    *,
    dry_run: bool,
) -> ImportResult:
    create_keys: list[str] = []
    update_keys: list[str] = []
    existing_keys = {
        e.key: e
        for e in db.query(StringEntry)
        .filter(StringEntry.project_id == project.id, StringEntry.module_id.is_(None))
        .all()
    }
    # Also index flat-prefixed keys
    all_entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.module))
        .filter(StringEntry.project_id == project.id)
        .all()
    )
    by_export_key: dict[str, StringEntry] = {}
    for e in all_entries:
        by_export_key[export_key(e, "flat")] = e
        if e.module_id is None:
            by_export_key[e.key] = e

    for key, source_text in strings.items():
        entry = by_export_key.get(key)
        if entry:
            if entry.source_text != source_text:
                update_keys.append(key)
                if not dry_run:
                    entry.source_text = source_text
        else:
            create_keys.append(key)
            if not dry_run:
                # Parse module prefix if present
                module_id = None
                actual_key = key
                if "." in key:
                    prefix, rest = key.split(".", 1)
                    mod = (
                        db.query(Module)
                        .filter(Module.project_id == project.id, Module.slug == prefix)
                        .first()
                    )
                    if mod:
                        module_id = mod.id
                        actual_key = rest
                entry = StringEntry(
                    project_id=project.id,
                    module_id=module_id,
                    key=actual_key,
                    source_text=source_text,
                )
                db.add(entry)
                db.flush()
                for locale in project.target_languages:
                    db.add(
                        Translation(
                            string_id=entry.id,
                            locale=locale,
                            value="",
                            status=TranslationStatus.draft,
                        )
                    )

    orphan_keys = [k for k in by_export_key if k not in strings]
    diff = ImportDiff(
        create=create_keys,
        update=update_keys,
        orphan=orphan_keys,
        create_count=len(create_keys),
        update_count=len(update_keys),
        orphan_count=len(orphan_keys),
    )
    if dry_run:
        return ImportResult(
            created=0,
            updated=0,
            total=len(strings),
            dry_run=True,
            diff=diff,
        )
    return ImportResult(
        created=len(create_keys),
        updated=len(update_keys),
        total=len(strings),
        dry_run=False,
        diff=diff,
    )


@router.post("/projects/{project_id}/import", response_model=ImportResult)
async def import_project(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
    file: UploadFile | None = File(default=None),
    dry_run: bool = Query(default=False),
    status: str = Query(default="draft", pattern="^(draft|public)$"),
    payload: ImportPayload | None = None,
) -> ImportResult:
    batch_id = uuid.uuid4()
    existing = db.info.get("activity") or {}
    db.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": "import",
    }

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
            result = _import_flat_strings(db, project, strings, dry_run=dry_run)
            if not dry_run:
                db.commit()
            result.batch_id = batch_id
            return result
        raise HTTPException(status_code=400, detail="Unsupported file type")

    # JSON body import (CLI push)
    if payload and payload.strings is not None:
        result = _import_flat_strings(db, project, payload.strings, dry_run=dry_run)
        if not dry_run:
            db.commit()
        result.batch_id = batch_id
        return result

    raise HTTPException(status_code=400, detail="Provide a file upload or JSON body")


@router.post("/projects/{project_id}/strings/import", response_model=ImportResult)
def import_strings_compat(
    project_id: uuid.UUID,
    payload: ImportPayload,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> ImportResult:
    """Back-compat endpoint for CLI push."""
    batch_id = uuid.uuid4()
    existing = db.info.get("activity") or {}
    db.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": "import",
    }
    if not payload.strings:
        raise HTTPException(status_code=400, detail="strings required")
    result = _import_flat_strings(db, project, payload.strings, dry_run=False)
    db.commit()
    result.batch_id = batch_id
    return result
