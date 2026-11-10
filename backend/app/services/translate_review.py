"""Save or publish reviewed AI-review rows in place.

The Translate missing review sends the exact rows the user reviewed. Review is
read-only; save writes the working copy and, for ``publish``, promotes exactly
those strings in the same transaction as the audit records.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.activity import attach_batch
from app.models import Project, StringEntry
from app.schemas import (
    StringOut,
    TranslateReviewItem,
    TranslateReviewOut,
    TranslateSaveRequest,
    TranslateSaveResult,
)
from app.services import strings
from app.services.translate import check_source_baseline
from app.services.write_transactions import run_write

STALE_TRANSLATION_REVIEW = "stale_translation_review"
STALE_TRANSLATION_VALUE = "stale_translation_value"


def _filled(item: TranslateReviewItem) -> dict[str, str]:
    return {locale: value for locale, value in item.translations.items() if value.strip()}


def _load(
    db: Session, project: Project, items: list[TranslateReviewItem], *, lock: bool
) -> dict[UUID, StringEntry]:
    ids = [item.string_id for item in items]
    if len(set(ids)) != len(ids):
        raise HTTPException(400, detail="Each string can appear only once in a review")
    for item in items:
        strings.validate_locales(project, item.translations)
    if lock:
        strings.lock_strings(db, project.id, ids)
    entries = strings.load_string_entries(db, project.id, ids, refresh=lock)
    return {entry.id: entry for entry in entries if entry.deleted_at is None}


def _check(items: list[TranslateReviewItem], by_id: dict[UUID, StringEntry]) -> None:
    """Reject the whole review when anything it was based on changed."""
    missing = [str(item.string_id) for item in items if item.string_id not in by_id]
    if missing:
        raise HTTPException(
            409,
            detail={
                "code": STALE_TRANSLATION_REVIEW,
                "message": "Some reviewed strings were deleted. Nothing was saved.",
                "string_ids": missing,
            },
        )
    check_source_baseline(items, by_id)
    values = []
    for item in items:
        entry = by_id[item.string_id]
        saved = {t.locale: t.value or "" for t in entry.translations}
        for locale, value in _filled(item).items():
            current = saved.get(locale, "")
            if current.strip() and current != value:
                values.append(
                    {
                        "string_id": str(entry.id),
                        "key": entry.key,
                        "locale": locale,
                        "value": current,
                    }
                )
    if values:
        raise HTTPException(
            409,
            detail={
                "code": STALE_TRANSLATION_VALUE,
                "message": "Some reviewed cells were filled elsewhere. Clear them, then save again.",
                "conflicts": values,
            },
        )


def _reject_pending_delete(
    items: list[TranslateReviewItem], by_id: dict[UUID, StringEntry]
) -> None:
    """Publishing would cancel a queued removal; that has its own action."""
    pending = sorted(
        by_id[item.string_id].key for item in items if by_id[item.string_id].pending_delete
    )
    if pending:
        raise HTTPException(
            409,
            detail={
                "code": "pending_delete_in_review",
                "message": (
                    f"Remove strings pending removal from this review: {', '.join(pending)}. "
                    "Publish removals with the separate removal action."
                ),
                "keys": pending,
            },
        )


def _project(project: Project, entry: StringEntry, item: TranslateReviewItem) -> StringOut:
    projected = strings.serialize_string(entry).model_copy(deep=True)
    by_locale = strings.with_target_cells(project, projected)
    for locale, value in _filled(item).items():
        cell = by_locale[locale]
        if cell.value != value:
            cell.value = value
            cell.confidence = item.scores.get(locale)
    projected.translations = sorted(by_locale.values(), key=lambda t: t.locale)
    projected.has_unpublished_changes = strings.has_unpublished_changes(projected)
    return projected


def _fingerprint(
    project: Project, items: list[TranslateReviewItem], by_id: dict[UUID, StringEntry]
) -> str:
    """Bind membership, reviewed values, and the full current public baseline of each string."""
    reviewed = sorted(
        (
            {
                "id": str(item.string_id),
                "source": item.expected_source_text,
                "translations": sorted(_filled(item).items()),
                "scores": sorted(item.scores.items()),
            }
            for item in items
        ),
        key=lambda row: row["id"],
    )
    entries = list(by_id.values())
    return strings.hash_review(
        {
            "project": str(project.id),
            "settings": strings.review_settings(project),
            "reviewed": reviewed,
            "baseline": strings.compute_publish_fingerprint(entries, include_unchanged=True),
        }
    )


def review_translations(
    db: Session, project: Project, items: list[TranslateReviewItem]
) -> TranslateReviewOut:
    with db.no_autoflush:
        by_id = _load(db, project, items, lock=False)
        _check(items, by_id)
        _reject_pending_delete(items, by_id)
        projected = [_project(project, by_id[item.string_id], item) for item in items]
    projected.sort(key=lambda entry: (entry.key, str(entry.id)))
    return TranslateReviewOut(items=projected, fingerprint=_fingerprint(project, items, by_id))


def save_reviewed_translations(
    db: Session, project: Project, payload: TranslateSaveRequest
) -> TranslateSaveResult:
    publish = payload.action == "publish"
    if publish and not payload.fingerprint:
        raise HTTPException(400, detail={"code": strings.PUBLISH_FINGERPRINT_REQUIRED})

    def write() -> TranslateSaveResult:
        if publish:
            strings.lock_publication(db, project.id)
        db.refresh(project, with_for_update={"read": True})
        items = payload.items
        with db.no_autoflush:
            by_id = _load(db, project, items, lock=True)
            _check(items, by_id)
            if publish:
                current = _fingerprint(project, items, by_id)
                if not strings.fingerprints_match(current, payload.fingerprint or ""):
                    raise HTTPException(409, detail={"code": strings.PUBLISH_FINGERPRINT_MISMATCH})
                _reject_pending_delete(items, by_id)
        batch_id = uuid4()
        attach_batch(db, batch_id, "translate")
        if not publish:
            db.info["activity"]["intent"] = "save_draft"
        translated = 0
        for item in items:
            entry = by_id[item.string_id]
            saved = {t.locale: t.value or "" for t in entry.translations}
            fills = {
                locale: value
                for locale, value in _filled(item).items()
                if saved.get(locale, "") != value
            }
            strings.apply_translation_values(
                db, entry, fills, {locale: item.scores.get(locale) for locale in fills}
            )
            translated += len(fills)
        published = 0
        if publish:
            for item in items:
                entry = by_id[item.string_id]
                if strings.is_publishable_entry(entry):
                    strings.promote_string(entry)
                    published += 1
        db.flush()
        if published:
            strings.guard_published_keys(db, project)
        return TranslateSaveResult(
            action=payload.action,
            translated_count=translated,
            string_count=len(items),
            published_count=published,
            batch_id=batch_id,
        )

    return run_write(db, project.id, f"translate_save_{payload.action}", write)
