"""Project CRUD, serialization, and API keys."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import generate_api_key, membership_for
from app.config import settings
from app.helpers import ensure_unique_slug, slugify, validate_locale_code
from app.models import ApiKey, MemberRole, Project, ProjectMember, StringEntry, User
from app.schemas import (
    ApiKeyCreate,
    ApiKeyCreated,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)
from app.services.import_lock import acquire_import_lock
from app.services.key_policy import duplicate_key_details
from app.services.members import lock_project, role_name


def project_out(
    project: Project,
    string_count: int,
    role: str | None = None,
    *,
    can_change_base_language: bool = False,
) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        translation_context=project.translation_context,
        slug=project.slug,
        base_language=project.base_language,
        target_languages=project.target_languages or [],
        layout=project.layout,
        allow_duplicate_keys=project.allow_duplicate_keys,
        string_count=string_count,
        can_change_base_language=can_change_base_language,
        created_at=project.created_at,
        updated_at=project.updated_at,
        role=role,  # type: ignore[arg-type]
    )


def count_strings(db: Session, project_id: uuid.UUID) -> int:
    return (
        db.query(func.count(StringEntry.id))
        .filter(StringEntry.project_id == project_id, StringEntry.deleted_at.is_(None))
        .scalar()
        or 0
    )


def count_strings_by_project(
    db: Session, project_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not project_ids:
        return {}
    rows = (
        db.query(StringEntry.project_id, func.count(StringEntry.id))
        .filter(
            StringEntry.deleted_at.is_(None),
            StringEntry.project_id.in_(project_ids),
        )
        .group_by(StringEntry.project_id)
        .all()
    )
    return {project_id: n for project_id, n in rows}


def to_project_out(
    db: Session,
    project: Project,
    counts: dict[uuid.UUID, int] | None = None,
    role: str | None = None,
) -> ProjectOut:
    if counts is not None:
        n = counts.get(project.id, 0)
    else:
        n = count_strings(db, project.id)
    # List responses omit this detail-only capability; avoid a query per project.
    can_change_base_language = counts is None and n == 0 and (
        db.query(StringEntry.id).filter(StringEntry.project_id == project.id).first() is None
    )
    return project_out(project, n, role, can_change_base_language=can_change_base_language)


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def list_projects(db: Session, user: User) -> list[ProjectOut]:
    rows = (
        db.query(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .filter(ProjectMember.user_id == user.id)
        .order_by(Project.name)
        .all()
    )
    counts = count_strings_by_project(db, [project.id for project, _role in rows])
    return [to_project_out(db, project, counts, role_name(role)) for project, role in rows]


def _validated_locales(base: str, targets: list[str]) -> tuple[str, list[str]]:
    base_lang = validate_locale_code(base)
    seen: set[str] = set()
    target_langs: list[str] = []
    for loc in targets:
        code = validate_locale_code(loc)
        if code == base_lang or code in seen:
            continue
        seen.add(code)
        target_langs.append(code)
    return base_lang, target_langs


def create_project(db: Session, payload: ProjectCreate, user: User) -> ProjectOut:
    slug = payload.slug or slugify(payload.name)
    slug = ensure_unique_slug(db, slug)
    base = payload.base_language or settings.default_base_language
    try:
        base_lang, target_langs = _validated_locales(base, payload.target_languages)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    project = Project(
        name=payload.name,
        translation_context=payload.translation_context,
        slug=slug,
        base_language=base_lang,
        target_languages=target_langs,
        layout=payload.layout,
        allow_duplicate_keys=payload.allow_duplicate_keys,
        created_by=user.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=MemberRole.admin))
    db.commit()
    db.refresh(project)
    return to_project_out(db, project, role=MemberRole.admin.value)


def update_project(
    db: Session,
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    role: str | None = None,
) -> ProjectOut:
    project = get_project(db, project_id)
    base_language = None
    if payload.base_language is not None:
        try:
            base_language = validate_locale_code(payload.base_language)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.allow_duplicate_keys is not None or payload.base_language is not None:
        # Authorization may have waited for another settings update after loading the project.
        db.refresh(project)
        if (
            payload.allow_duplicate_keys is not None
            and payload.allow_duplicate_keys != project.allow_duplicate_keys
        ) or (
            payload.base_language is not None
            and base_language != project.base_language
        ):
            # Fail fast before upgrading the project lock: imports lock strings before audit FKs.
            acquire_import_lock(db, project_id)
            (
                db.query(Project)
                .filter(Project.id == project_id)
                .with_for_update()
                .populate_existing()
                .first()
            )
    if payload.base_language is not None and base_language != project.base_language:
        # Include tombstones: restoring one must not relabel its source or snapshot.
        if db.query(StringEntry.id).filter(StringEntry.project_id == project_id).first():
            raise HTTPException(
                409,
                detail={
                    "code": "base_language_has_strings",
                    "message": (
                        "Base language cannot be changed after strings have been added "
                        "(including deleted strings). Create a new project with the desired "
                        "base language instead. Target languages can still be changed."
                    ),
                },
            )
    if payload.allow_duplicate_keys is False and project.allow_duplicate_keys:
        conflicts = duplicate_key_details(db, project_id)
        if conflicts:
            raise HTTPException(
                409,
                detail={
                    "code": "duplicate_keys_exist",
                    "message": "Resolve duplicate keys across modules before disabling this setting.",
                    "conflicts": conflicts,
                },
            )
    if payload.allow_duplicate_keys is not None:
        project.allow_duplicate_keys = payload.allow_duplicate_keys
    if payload.name is not None:
        project.name = payload.name
    if payload.base_language is not None or payload.target_languages is not None:
        base = payload.base_language if payload.base_language is not None else project.base_language
        targets = (
            payload.target_languages
            if payload.target_languages is not None
            else (project.target_languages or [])
        )
        try:
            base_lang, target_langs = _validated_locales(base, targets)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        project.base_language = base_lang
        project.target_languages = target_langs
    if payload.layout is not None:
        project.layout = payload.layout
    if "translation_context" in payload.model_fields_set:
        project.translation_context = payload.translation_context
    db.commit()
    db.refresh(project)
    return to_project_out(db, project, role=role)


def delete_project(db: Session, project: Project, confirm_slug: str | None) -> None:
    if confirm_slug != project.slug:
        raise HTTPException(
            status_code=400, detail="confirm_slug must exactly match the project slug"
        )
    lock_project(db, project.id)
    db.delete(project)
    db.commit()


def list_api_keys(db: Session, project_id: uuid.UUID) -> list[ApiKey]:
    get_project(db, project_id)
    return (
        db.query(ApiKey)
        .filter(ApiKey.project_id == project_id, ApiKey.revoked_at.is_(None))
        .order_by(ApiKey.created_at.desc())
        .all()
    )


def create_api_key(
    db: Session,
    project_id: uuid.UUID,
    payload: ApiKeyCreate,
    user: User,
) -> ApiKeyCreated:
    lock_project(db, project_id)
    # Authorization may have preceded a concurrent removal. Recheck while
    # holding the same lock as removal, before rotating or inserting any key.
    if membership_for(db, project_id, user.id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project = get_project(db, project_id)
    now = datetime.now(UTC)
    previous = (
        db.query(ApiKey)
        .filter(
            ApiKey.project_id == project.id,
            ApiKey.created_by == user.id,
            ApiKey.revoked_at.is_(None),
        )
        .all()
    )
    for old in previous:
        old.revoked_at = now
    raw, prefix, key_hash = generate_api_key()
    api_key = ApiKey(
        project_id=project.id,
        name=payload.name,
        key_prefix=prefix,
        key_hash=key_hash,
        created_by=user.id,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return ApiKeyCreated(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        created_by=api_key.created_by,
        created_at=api_key.created_at,
        last_used_at=api_key.last_used_at,
        revoked_at=api_key.revoked_at,
        key=raw,
    )


OWN_KEY_ONLY = "You can only revoke API keys you created"


def revoke_api_key(
    db: Session,
    project_id: uuid.UUID,
    key_id: uuid.UUID,
    user: User,
) -> None:
    lock_project(db, project_id)
    member = membership_for(db, project_id, user.id)
    if member is None:
        raise HTTPException(status_code=404, detail="Project not found")
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.id == key_id, ApiKey.project_id == project_id)
        .first()
    )
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    if member.role != MemberRole.admin and api_key.created_by != user.id:
        raise HTTPException(status_code=403, detail=OWN_KEY_ONLY)
    api_key.revoked_at = datetime.now(UTC)
    db.commit()
