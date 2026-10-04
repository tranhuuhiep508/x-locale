"""Strings CRUD with filtering, pagination, and translation upsert."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.auth import ProjectAccess
from app.database import DbSession
from app.models import TranslationStatus
from app.schemas import (
    StringCreate,
    StringListOut,
    StringOut,
    StringUpdate,
    TranslationUpdate,
    UpdatedWithinDays,
)
from app.services import strings as strings_service

router = APIRouter(prefix="/projects/{project_id}", tags=["strings"])


@router.get("/strings", response_model=StringListOut)
def list_strings(
    project: ProjectAccess,
    db: DbSession,
    module: Annotated[uuid.UUID | None, Query(alias="module")] = None,
    unassigned_module: Annotated[bool | None, Query()] = None,
    tag: Annotated[uuid.UUID | None, Query()] = None,
    untagged: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    missing_locale: Annotated[str | None, Query()] = None,
    missing_any: Annotated[bool | None, Query()] = None,
    complete_locale: Annotated[str | None, Query()] = None,
    status: Annotated[TranslationStatus | None, Query()] = None,
    pending_delete: Annotated[bool | None, Query()] = None,
    never_published: Annotated[bool | None, Query()] = None,
    has_unpublished_changes: Annotated[bool | None, Query()] = None,
    deleted: Annotated[bool | None, Query()] = None,
    max_confidence: Annotated[int | None, Query(ge=0, le=100)] = None,
    batch_id: Annotated[uuid.UUID | None, Query()] = None,
    updated_within_days: Annotated[UpdatedWithinDays | None, Query()] = None,
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> StringListOut:
    return strings_service.list_strings(
        db,
        project,
        module=module,
        unassigned_module=unassigned_module,
        tag=tag,
        untagged=untagged,
        q=q,
        missing_locale=missing_locale,
        missing_any=missing_any,
        complete_locale=complete_locale,
        status=status,
        pending_delete=pending_delete,
        never_published=never_published,
        has_unpublished_changes=has_unpublished_changes,
        deleted=deleted,
        max_confidence=max_confidence,
        batch_id=batch_id,
        updated_within_days=updated_within_days,
        since=since,
        until=until,
        page=page,
        page_size=page_size,
    )


@router.post("/strings", response_model=StringOut, status_code=201)
def create_string(
    payload: StringCreate,
    project: ProjectAccess,
    db: DbSession,
) -> StringOut:
    return strings_service.create_string(db, project, payload)


@router.get("/strings/{string_id}", response_model=StringOut)
def get_string_endpoint(
    string_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> StringOut:
    return strings_service.serialize_string(
        strings_service.get_string(db, project.id, string_id)
    )


@router.patch("/strings/{string_id}", response_model=StringOut)
def update_string(
    string_id: uuid.UUID,
    payload: StringUpdate,
    project: ProjectAccess,
    db: DbSession,
) -> StringOut:
    return strings_service.update_string(db, project, string_id, payload)


@router.put(
    "/strings/{string_id}/translations/{locale}",
    response_model=StringOut,
)
def upsert_translation(
    string_id: uuid.UUID,
    locale: str,
    payload: TranslationUpdate,
    project: ProjectAccess,
    db: DbSession,
) -> StringOut:
    return strings_service.upsert_translation(db, project, string_id, locale, payload)


@router.delete("/strings/{string_id}", status_code=204)
def delete_string(
    string_id: uuid.UUID,
    project: ProjectAccess,
    db: DbSession,
) -> None:
    strings_service.delete_string(db, project, string_id)
