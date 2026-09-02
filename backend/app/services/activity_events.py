"""Classify activity snapshots into product event types and human summaries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

EVENT_CREATED = "string.created"
EVENT_RENAMED = "string.renamed"
EVENT_SOURCE = "string.source_updated"
EVENT_MOVED = "string.moved"
EVENT_TAGGED = "string.tagged"
EVENT_UPDATED = "string.updated"
EVENT_TRANSLATION = "translation.updated"
EVENT_PUBLISHED = "string.published"
EVENT_UNPUBLISHED = "string.unpublished"
EVENT_PENDING_DELETE = "string.pending_delete"
EVENT_DELETED = "string.deleted"
EVENT_RESTORED = "string.restored"
EVENT_DISCARDED = "string.discarded"

BATCH_EVENT_TYPES = frozenset(
    {"import", "excel_import", "translate", "batch", "revert"}
)
UNDOABLE_BATCH_KINDS = frozenset({"import", "excel_import", "translate", "batch"})
HISTORY_UNRESTORABLE_EVENT_TYPES = frozenset(
    {EVENT_PUBLISHED, EVENT_UNPUBLISHED, EVENT_PENDING_DELETE, EVENT_DELETED}
)

PUBLISHED_FIELDS = (
    "published_key",
    "published_source_text",
    "published_module_id",
    "published_at",
)


@dataclass(frozen=True)
class ClassifiedEvent:
    event_type: str
    locale: str | None
    summary: str


@dataclass(frozen=True)
class ChangedField:
    field: str
    before: str | None = None
    after: str | None = None
    locale: str | None = None


def _enum_val(val: Any) -> str | None:
    if val is None:
        return None
    if hasattr(val, "value"):
        return str(val.value)
    return str(val)


def _status(snap: dict[str, Any] | None) -> str:
    if not snap:
        return ""
    return _enum_val(snap.get("status")) or ""


def _key(snap: dict[str, Any] | None) -> str:
    if not snap:
        return ""
    return str(snap.get("key") or "")


def _quote(key: str) -> str:
    return f"'{key}'" if key else "item"


def translations_map(raw: Any) -> dict[str, str]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        out: dict[str, str] = {}
        for locale, value in raw.items():
            if isinstance(value, dict):
                out[str(locale)] = value.get("value", "") or ""
            else:
                out[str(locale)] = value or ""
        return out
    if isinstance(raw, list):
        return {
            str(item.get("locale")): item.get("value", "") or ""
            for item in raw
            if isinstance(item, dict) and item.get("locale")
        }
    return {}


def _truthy_deleted(snap: dict[str, Any] | None) -> bool:
    if not snap:
        return False
    return bool(snap.get("deleted_at"))


def _pending(snap: dict[str, Any] | None) -> bool:
    if not snap:
        return False
    return bool(snap.get("pending_delete"))


def _published_changed(before: dict[str, Any] | None, after: dict[str, Any] | None) -> bool:
    left = before or {}
    right = after or {}
    for field in PUBLISHED_FIELDS:
        if left.get(field) != right.get(field):
            return True
    return translations_map(left.get("published_translations")) != translations_map(
        right.get("published_translations")
    )


def _working_diffs(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> dict[str, bool]:
    left = before or {}
    right = after or {}
    trans_before = translations_map(left.get("translations"))
    trans_after = translations_map(right.get("translations"))
    return {
        "key": left.get("key") != right.get("key"),
        "source_text": left.get("source_text") != right.get("source_text"),
        "description": left.get("description") != right.get("description"),
        "module_id": left.get("module_id") != right.get("module_id"),
        "tags": (left.get("tag_ids") or []) != (right.get("tag_ids") or []),
        "translations": trans_before != trans_after,
    }


def _changed_locales(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[str]:
    left = translations_map((before or {}).get("translations"))
    right = translations_map((after or {}).get("translations"))
    locales = sorted(set(left) | set(right))
    return [locale for locale in locales if left.get(locale, "") != right.get(locale, "")]


def _clip(value: Any, limit: int = 48) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _quoted_text(value: Any) -> str:
    return f"“{_clip(value)}”"


def _changed_part_names(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[str]:
    diffs = _working_diffs(before, after)
    names: list[str] = []
    if diffs["key"]:
        names.append("key")
    if diffs["source_text"]:
        names.append("source")
    if diffs["description"]:
        names.append("description")
    if diffs["module_id"]:
        names.append("module")
    if diffs["tags"]:
        names.append("tags")
    names.extend(_changed_locales(before, after))
    return names


def _parts_suffix(before: dict[str, Any] | None, after: dict[str, Any] | None) -> str:
    parts = _changed_part_names(before, after)
    if not parts:
        return ""
    return f" ({', '.join(parts)})"


def _source_change_summary(
    key: str, before: dict[str, Any] | None, after: dict[str, Any] | None
) -> str:
    old = (before or {}).get("source_text") or ""
    new = (after or {}).get("source_text") or ""
    if old and new:
        return f"Changed source of {_quote(key)} from {_quoted_text(old)} to {_quoted_text(new)}"
    if new and not old:
        return f"Set source of {_quote(key)} to {_quoted_text(new)}"
    if old and not new:
        return f"Cleared source of {_quote(key)} (was {_quoted_text(old)})"
    return f"Updated source of {_quote(key)}"


def _translation_change_summary(
    key: str, locale: str, before: dict[str, Any] | None, after: dict[str, Any] | None
) -> str:
    old = translations_map((before or {}).get("translations")).get(locale, "")
    new = translations_map((after or {}).get("translations")).get(locale, "")
    if old and new:
        return (
            f"Changed {locale} of {_quote(key)} from {_quoted_text(old)} to {_quoted_text(new)}"
        )
    if new and not old:
        return f"Set {locale} of {_quote(key)} to {_quoted_text(new)}"
    if old and not new:
        return f"Cleared {locale} of {_quote(key)} (was {_quoted_text(old)})"
    return f"Updated {locale} of {_quote(key)}"


def classify_event(
    *,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    batch_kind: str | None = None,
    intent: str | None = None,
) -> ClassifiedEvent:
    """Return event_type, locale, and a human summary for one activity row."""
    del batch_kind
    action_val = _enum_val(action) or "update"
    key = _key(after) or _key(before)
    quoted = _quote(key)

    if intent == "discard":
        suffix = _parts_suffix(before, after)
        return ClassifiedEvent(
            EVENT_DISCARDED,
            None,
            (
                f"Discarded unpublished changes on {quoted} and reset it to the "
                f"last published snapshot{suffix}"
            ),
        )

    if intent == "restore":
        return ClassifiedEvent(
            EVENT_RESTORED,
            None,
            f"Restored a previous working-copy version of {quoted}",
        )

    if action_val == "create":
        source = (after or {}).get("source_text") or ""
        if source:
            return ClassifiedEvent(
                EVENT_CREATED,
                None,
                f"Added string {quoted} with source {_quoted_text(source)}",
            )
        return ClassifiedEvent(EVENT_CREATED, None, f"Added string {quoted}")

    deleted_now = _truthy_deleted(after) and not _truthy_deleted(before)
    if action_val == "delete" or deleted_now:
        return ClassifiedEvent(
            EVENT_DELETED,
            None,
            f"Deleted string {quoted} from the catalog",
        )

    if _truthy_deleted(before) and not _truthy_deleted(after):
        return ClassifiedEvent(
            EVENT_RESTORED,
            None,
            f"Restored deleted string {quoted} back into the catalog",
        )

    if not _pending(before) and _pending(after):
        return ClassifiedEvent(
            EVENT_PENDING_DELETE,
            None,
            (
                f"Marked {quoted} for deletion; public export keeps the last snapshot "
                "until this removal is published"
            ),
        )

    if _pending(before) and not _pending(after) and not deleted_now:
        return ClassifiedEvent(
            EVENT_RESTORED,
            None,
            f"Canceled the pending deletion of {quoted}",
        )

    before_status = _status(before)
    after_status = _status(after)
    if before_status == "public" and after_status == "draft":
        return ClassifiedEvent(
            EVENT_UNPUBLISHED,
            None,
            f"Unpublished {quoted}, removing it from public export",
        )

    if (before_status != "public" and after_status == "public") or _published_changed(
        before, after
    ):
        return ClassifiedEvent(
            EVENT_PUBLISHED,
            None,
            f"Published {quoted}, making the current draft live for public export",
        )

    diffs = _working_diffs(before, after)
    changed = [name for name, flag in diffs.items() if flag]

    if changed == ["key"]:
        old = _key(before)
        new = _key(after)
        return ClassifiedEvent(
            EVENT_RENAMED,
            None,
            f"Renamed string {_quote(old)} to {_quote(new)}",
        )

    if set(changed) <= {"source_text", "description"} and diffs["source_text"]:
        return ClassifiedEvent(
            EVENT_SOURCE, None, _source_change_summary(key, before, after)
        )

    if changed == ["module_id"]:
        return ClassifiedEvent(
            EVENT_MOVED,
            None,
            f"Moved {quoted} to a different module",
        )

    if changed == ["tags"]:
        return ClassifiedEvent(EVENT_TAGGED, None, f"Changed tags on {quoted}")

    if changed == ["translations"]:
        locales = _changed_locales(before, after)
        locale = locales[0] if len(locales) == 1 else None
        if locale:
            return ClassifiedEvent(
                EVENT_TRANSLATION,
                locale,
                _translation_change_summary(key, locale, before, after),
            )
        listed = ", ".join(locales)
        return ClassifiedEvent(
            EVENT_TRANSLATION,
            None,
            f"Updated translations of {quoted} ({listed})",
        )

    suffix = _parts_suffix(before, after)
    return ClassifiedEvent(EVENT_UPDATED, None, f"Updated {quoted}{suffix}")


def _fmt(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) if value else None
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def human_changed(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    *,
    action: str | None = None,
) -> list[ChangedField]:
    """Working-copy diffs suitable for the UI. Skips published_* and ids."""
    action_val = _enum_val(action) or "update"
    left = before or {}
    right = after or {}
    rows: list[ChangedField] = []

    def add(field: str, old: Any, new: Any) -> None:
        old_s = _fmt(old)
        new_s = _fmt(new)
        if action_val == "update" and old_s == new_s:
            return
        if action_val == "create" and new_s is None:
            return
        rows.append(ChangedField(field=field, before=old_s, after=new_s))

    add("key", left.get("key"), right.get("key"))
    add("source_text", left.get("source_text"), right.get("source_text"))
    add("description", left.get("description"), right.get("description"))
    add("status", left.get("status"), right.get("status"))
    add("tags", left.get("tag_ids") or [], right.get("tag_ids") or [])

    trans_left = translations_map(left.get("translations"))
    trans_right = translations_map(right.get("translations"))
    for locale in sorted(set(trans_left) | set(trans_right)):
        old_s = _fmt(trans_left.get(locale, ""))
        new_s = _fmt(trans_right.get(locale, ""))
        if action_val == "update" and old_s == new_s:
            continue
        if action_val == "create" and new_s is None:
            continue
        rows.append(
            ChangedField(field="translation", locale=locale, before=old_s, after=new_s)
        )
    return rows


def is_history_restorable(event_type: str | None, action: str | None = None) -> bool:
    """History restore writes working-copy text/metadata, not publish or delete lifecycle."""
    action_val = _enum_val(action) or "update"
    if action_val == "delete":
        return False
    return (event_type or "") not in HISTORY_UNRESTORABLE_EVENT_TYPES


def snapshot_key(activity_before: dict | None, activity_after: dict | None) -> str | None:
    key = _key(activity_after) or _key(activity_before)
    return key or None


def _child_event_types(children: list[ClassifiedEvent | str] | None) -> set[str]:
    return {
        item.event_type if isinstance(item, ClassifiedEvent) else item
        for item in (children or [])
    }


def batch_card_event_type(
    batch_kind: str | None, children: list[ClassifiedEvent | str] | None = None
) -> str:
    types = _child_event_types(children)
    if types == {EVENT_DISCARDED}:
        return EVENT_DISCARDED
    if types == {EVENT_RESTORED} and (_enum_val(batch_kind) or "") == "batch":
        return EVENT_RESTORED
    value = _enum_val(batch_kind)
    if value in BATCH_EVENT_TYPES:
        return value
    return "batch"


def batch_card_summary(
    batch_kind: str | None, children: list[ClassifiedEvent | str], count: int
) -> str:
    kind = _enum_val(batch_kind)
    noun = "string" if count == 1 else "strings"
    if kind == "excel_import":
        return f"Imported {count} {noun} from Excel into the catalog"
    if kind == "import":
        return f"Imported {count} {noun} into the catalog"
    if kind == "translate":
        return f"Filled missing translations on {count} {noun} with AI"
    if kind == "revert":
        return f"Undid a batch and restored {count} {noun} to their earlier working copies"
    types = _child_event_types(children)
    if types == {EVENT_PUBLISHED}:
        return f"Published {count} {noun}, making their current drafts live for public export"
    if types == {EVENT_UNPUBLISHED}:
        return f"Unpublished {count} {noun}, removing them from public export"
    if types == {EVENT_DELETED} or types == {EVENT_PENDING_DELETE}:
        return f"Deleted {count} {noun} from the catalog"
    if types == {EVENT_DISCARDED}:
        return (
            f"Discarded unpublished changes on {count} {noun} and reset them "
            "to the last published snapshot"
        )
    if types == {EVENT_RESTORED}:
        return f"Restored {count} {noun} to an earlier working copy"
    return f"Updated {count} {noun}"
