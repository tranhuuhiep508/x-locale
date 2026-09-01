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

BATCH_EVENT_TYPES = frozenset(
    {"import", "excel_import", "translate", "batch", "revert"}
)
UNDOABLE_BATCH_KINDS = frozenset({"import", "excel_import", "translate", "batch"})

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

    if intent == "restore":
        return ClassifiedEvent(EVENT_RESTORED, None, f"Restored previous value of {_quote(key)}")

    if action_val == "create":
        return ClassifiedEvent(EVENT_CREATED, None, f"Created {_quote(key)}")

    deleted_now = _truthy_deleted(after) and not _truthy_deleted(before)
    if action_val == "delete" or deleted_now:
        return ClassifiedEvent(EVENT_DELETED, None, f"Deleted {_quote(key)}")

    if _truthy_deleted(before) and not _truthy_deleted(after):
        return ClassifiedEvent(EVENT_RESTORED, None, f"Restored {_quote(key)}")

    if not _pending(before) and _pending(after):
        return ClassifiedEvent(
            EVENT_PENDING_DELETE, None, f"Marked {_quote(key)} for deletion"
        )

    if _pending(before) and not _pending(after) and not deleted_now:
        return ClassifiedEvent(EVENT_RESTORED, None, f"Restored {_quote(key)}")

    before_status = _status(before)
    after_status = _status(after)
    if before_status == "public" and after_status == "draft":
        return ClassifiedEvent(EVENT_UNPUBLISHED, None, f"Unpublished {_quote(key)}")

    if (before_status != "public" and after_status == "public") or _published_changed(
        before, after
    ):
        return ClassifiedEvent(EVENT_PUBLISHED, None, f"Published {_quote(key)}")

    diffs = _working_diffs(before, after)
    changed = [name for name, flag in diffs.items() if flag]

    if changed == ["key"]:
        old = _key(before)
        new = _key(after)
        return ClassifiedEvent(EVENT_RENAMED, None, f"Renamed {_quote(old)} → {_quote(new)}")

    if set(changed) <= {"source_text", "description"} and diffs["source_text"]:
        return ClassifiedEvent(EVENT_SOURCE, None, f"Updated source of {_quote(key)}")

    if changed == ["module_id"]:
        return ClassifiedEvent(EVENT_MOVED, None, f"Moved {_quote(key)}")

    if changed == ["tags"]:
        return ClassifiedEvent(EVENT_TAGGED, None, f"Tagged {_quote(key)}")

    if changed == ["translations"]:
        locales = _changed_locales(before, after)
        locale = locales[0] if len(locales) == 1 else None
        if locale:
            return ClassifiedEvent(
                EVENT_TRANSLATION, locale, f"Translated {_quote(key)} → {locale}"
            )
        return ClassifiedEvent(EVENT_TRANSLATION, None, f"Updated translations of {_quote(key)}")

    return ClassifiedEvent(EVENT_UPDATED, None, f"Updated {_quote(key)}")


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


def snapshot_key(activity_before: dict | None, activity_after: dict | None) -> str | None:
    key = _key(activity_after) or _key(activity_before)
    return key or None


def batch_card_event_type(batch_kind: str | None) -> str:
    value = _enum_val(batch_kind)
    if value in BATCH_EVENT_TYPES:
        return value
    return "batch"


def batch_card_summary(batch_kind: str | None, children: list[ClassifiedEvent | str], count: int) -> str:
    kind = _enum_val(batch_kind)
    noun = "string" if count == 1 else "strings"
    if kind == "excel_import":
        return f"Imported from Excel · {count} {noun}"
    if kind == "import":
        return f"Imported · {count} {noun}"
    if kind == "translate":
        return f"AI translated {count} {noun}"
    if kind == "revert":
        return f"Restored {count} {noun}"
    types = {
        item.event_type if isinstance(item, ClassifiedEvent) else item for item in children
    }
    if types == {EVENT_PUBLISHED}:
        return f"Published {count} {noun}"
    if types == {EVENT_UNPUBLISHED}:
        return f"Unpublished {count} {noun}"
    if types == {EVENT_DELETED} or types == {EVENT_PENDING_DELETE}:
        return f"Deleted {count} {noun}"
    if types == {EVENT_RESTORED}:
        return f"Restored {count} {noun}"
    return f"Updated {count} {noun}"
