"""Import entry points shared by the sync routes and background jobs.

Callers own the import lock, the batch context, and the commit.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Project, TranslationStatus
from app.schemas import ImportPayload, ImportResult
from app.services.job_progress import report_progress
from app.services.sync import import_flat_strings, import_json_data


@dataclass(frozen=True)
class ParsedImportFile:
    excel: bytes | None = None
    data: Any = None


@dataclass(frozen=True)
class FileImportOptions:
    dry_run: bool = False
    status: TranslationStatus = TranslationStatus.draft
    locale: str | None = None
    module_id: uuid.UUID | None = None
    tag_ids: list[uuid.UUID] | None = None
    partial: bool = False


def parse_import_file(raw: bytes, filename: str | None, content_type: str | None) -> ParsedImportFile:
    name = (filename or "").lower()
    kind = content_type or ""
    if name.endswith(".xlsx") or kind.endswith("spreadsheetml.sheet"):
        return ParsedImportFile(excel=raw)
    if name.endswith(".json") or kind.endswith("json") or not name:
        try:
            return ParsedImportFile(data=json.loads(raw.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON file") from exc
    raise HTTPException(status_code=400, detail="Unsupported file type")


def import_size(data: Any) -> int:
    """Number of string values in a JSON import, the unit of import work."""
    if isinstance(data, str):
        return 1
    if isinstance(data, dict):
        return sum(import_size(value) for value in data.values())
    if isinstance(data, list):
        return sum(import_size(value) for value in data)
    return 0


def import_file(
    db: Session, project: Project, parsed: ParsedImportFile, options: FileImportOptions
) -> ImportResult:
    report_progress(db, "parsing")
    if parsed.excel is not None:
        from app.excel import import_workbook

        db.info["activity"]["batch_kind"] = "excel_import"
        try:
            return import_workbook(
                db, project, parsed.excel, dry_run=options.dry_run, status=options.status
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return import_json_data(
        db,
        project,
        parsed.data,
        dry_run=options.dry_run,
        locale=options.locale,
        status=options.status,
        module_id=options.module_id,
        tag_ids=options.tag_ids,
        report_orphans=False if options.partial else None,
        partial=options.partial,
    )


def import_payload(
    db: Session, project: Project, payload: ImportPayload, *, dry_run: bool, partial: bool
) -> ImportResult:
    """JSON-body import used by the CLI push command."""
    if payload.modules:
        return import_json_data(
            db,
            project,
            {"modules": payload.modules},
            dry_run=dry_run,
            partial=partial,
            reject_deleted=True,
        )
    if payload.strings is not None:
        return import_flat_strings(
            db,
            project,
            payload.strings,
            dry_run=dry_run,
            report_orphans=not partial,
            partial=partial,
            reject_deleted=True,
        )
    raise HTTPException(status_code=400, detail="strings required")


def payload_size(payload: ImportPayload) -> int:
    if payload.modules:
        return import_size(payload.modules)
    return len(payload.strings or {})


def validate_import_base_language(project: Project, payload: ImportPayload) -> None:
    if payload.base_language is not None and payload.base_language != project.base_language:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "base_language_mismatch",
                "message": (
                    f"Configured base language '{payload.base_language}' does not match "
                    f"project base language '{project.base_language}'. Refresh config with loc init."
                ),
                "configured": payload.base_language,
                "expected": project.base_language,
            },
        )
