"""Read-only editor projections and atomic reviewed content writes."""

from __future__ import annotations

import hashlib
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Module, Project, Tag, TranslationStatus
from app.schemas import (
    EditorPreviewOut,
    EditorProposal,
    EditorSaveRequest,
    StringCreate,
    StringOut,
    StringUpdate,
    TagOut,
    TranslationOut,
)
from app.services import strings
from app.services.catalog import require_module_in_project
from app.services.key_policy import key_owner
from app.services.write_transactions import run_write

_PREVIEW_ID = UUID(int=0)


def _review_state(entry: StringOut | None) -> dict | None:
    if entry is None:
        return None
    data = entry.model_dump(
        mode="json",
        exclude={
            "id",
            "created_at",
            "created_by_type",
            "created_by_label",
            "updated_at",
            "updated_by_type",
            "updated_by_label",
            "has_unpublished_changes",
        },
    )
    data["translations"] = [
        item.model_dump(mode="json", exclude={"id", "updated_at"})
        for item in sorted(entry.translations, key=lambda item: item.locale)
    ]
    data["tags"] = sorted(data["tags"], key=lambda tag: tag["id"])
    return data


def _preview(
    db: Session, project: Project, proposal: EditorProposal, *, locked: bool
) -> EditorPreviewOut:
    values = proposal.values
    strings.validate_locales(project, values.translations)
    if proposal.mode == "update":
        entry = (
            strings._locked_editor_entry(db, project.id, proposal.string_id)
            if locked
            else strings.get_string(db, project.id, proposal.string_id)
        )
        strings._check_editor_expected(entry, StringUpdate(**values.model_dump(exclude_unset=True)))
        current = strings.serialize_string(entry)
        projected = current.model_copy(deep=True)
    else:
        current = None
        projected = StringOut(
            id=_PREVIEW_ID,
            key=values.key,
            source_text=values.source_text,
            description=values.description,
            status=TranslationStatus.draft,
        )
    changes = values.model_dump(exclude_unset=True, exclude={"expected"})
    for field in ("key", "source_text"):
        if changes.get(field) is not None:
            setattr(projected, field, changes[field])
    if not projected.key or not projected.source_text:
        raise HTTPException(422, detail="Key and source text are required")
    if "description" in changes:
        projected.description = changes["description"] or None
    if "module_id" in changes:
        projected.module_id = require_module_in_project(db, project.id, values.module_id)
        module = db.get(Module, projected.module_id) if projected.module_id else None
        projected.module_slug = module.slug if module else None
    if changes.get("tag_ids") is not None:
        tags = db.query(Tag).filter(Tag.project_id == project.id, Tag.id.in_(values.tag_ids)).all()
        if {tag.id for tag in tags} != set(values.tag_ids):
            raise HTTPException(400, detail="Unknown tag")
        projected.tags = [
            TagOut(id=tag.id, name=tag.name, color=tag.color, string_count=0)
            for tag in sorted(tags, key=lambda tag: (tag.name, str(tag.id)))
        ]
    if key_owner(
        db, project.id, projected.key, projected.module_id, exclude=current.id if current else None
    ):
        raise HTTPException(409, detail=f"String '{projected.key}' already exists")
    by_locale = {item.locale: item for item in projected.translations}
    # Missing configured locales export empty; materialize them only in this DTO.
    for locale in project.target_languages:
        if locale != project.base_language and locale not in by_locale:
            by_locale[locale] = TranslationOut(
                id=_PREVIEW_ID,
                locale=locale,
                value="",
                confidence=None,
                published_value=None,
                updated_at=None,
            )
    for locale, value in (values.translations or {}).items():
        translation = by_locale[locale]
        if translation.value != value:
            translation.confidence = None
        translation.value = value
    for locale, score in (values.translation_scores or {}).items():
        if locale in by_locale:
            by_locale[locale].confidence = score
    projected.translations = sorted(by_locale.values(), key=lambda item: item.locale)
    projected.has_unpublished_changes = strings.has_unpublished_changes(projected)
    normalized = proposal.model_dump(mode="json", exclude_unset=True)
    if normalized["values"].get("tag_ids") is not None:
        normalized["values"]["tag_ids"] = sorted(normalized["values"]["tag_ids"])
    expected = normalized["values"].get("expected", {})
    if expected.get("tag_ids") is not None:
        expected["tag_ids"] = sorted(expected["tag_ids"])
    payload = {
        "project": str(project.id),
        "settings": [
            project.base_language,
            sorted(project.target_languages),
            project.layout.value,
            project.allow_duplicate_keys,
        ],
        "proposal": normalized,
        "current": _review_state(current),
        "proposed": _review_state(projected),
    }
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return EditorPreviewOut(entry=projected, fingerprint=fingerprint)


def preview_editor(db: Session, project: Project, proposal: EditorProposal) -> EditorPreviewOut:
    with db.no_autoflush:
        return _preview(db, project, proposal, locked=False)


def save_editor(db: Session, project: Project, payload: EditorSaveRequest) -> StringOut:
    def write() -> UUID:
        publish = payload.action == "publish"
        if publish:
            strings.lock_publication(db, project.id)
        db.refresh(project, with_for_update={"read": True})
        with db.no_autoflush:
            review = _preview(db, project, payload.proposal, locked=True)
            if publish:
                if not strings.fingerprints_match(review.fingerprint, payload.fingerprint):
                    raise HTTPException(409, detail={"code": strings.PUBLISH_FINGERPRINT_MISMATCH})
                if review.entry.pending_delete or review.entry.deleted_at:
                    raise HTTPException(
                        409, detail="Use the separate removal or restoration action"
                    )
                if not strings.is_publishable_entry(review.entry):
                    raise HTTPException(409, detail={"code": "nothing_to_publish"})
            else:
                db.info.setdefault("activity", {})["intent"] = "save_draft"
            proposal = payload.proposal
            if proposal.mode == "create":
                entry = strings._create_string(
                    db, project, StringCreate(**proposal.values.model_dump())
                )
            else:
                strings._update_string(
                    db,
                    project,
                    proposal.string_id,
                    StringUpdate(**proposal.values.model_dump(exclude_unset=True)),
                )
                entry = strings.get_string(db, project.id, proposal.string_id)
            if publish:
                strings.promote_string(entry)
        db.flush()
        if publish:
            strings.guard_published_keys(db, project)
        return entry.id

    string_id = run_write(db, project.id, "save_editor", write)
    return strings.serialize_string(strings.get_string(db, project.id, string_id))
