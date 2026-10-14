"""Shared import planning and chunked Core persistence for JSON and Excel."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import String, any_, bindparam, delete, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from app.activity import STRING_FIELDS, _actor_from_session, _jsonify
from app.helpers import key_preview, reject_nul, require_locale_code
from app.limits import KEY_MAX_LENGTH
from app.models import (
    Activity,
    Module,
    Project,
    StringEntry,
    StringTag,
    Tag,
    Translation,
    TranslationStatus,
)
from app.schemas import ImportDiff, ImportDiffItem, ImportResult
from app.services.activity_bulk import insert_rows, update_rows
from app.services.activity_events import classify_event
from app.services.job_progress import report_progress

IMPORT_DIFF_SAMPLE = 100
# Strings and translations, tag links, activities.
WRITE_STEPS = 3


@dataclass(slots=True)
class ImportRow:
    key: str
    values: dict[str, str]
    module: uuid.UUID | str | None = None
    scoped: bool = False
    label: str | None = None
    excel: bool = False
    description: str | None = None
    tag_ids: tuple[uuid.UUID, ...] = ()
    tag_names: tuple[str, ...] = ()
    context: str = ""


@dataclass
class _Catalog:
    entries: dict[uuid.UUID, dict]
    translations: dict[uuid.UUID, dict[str, dict]]
    links: dict[uuid.UUID, set[uuid.UUID]]
    modules: dict[uuid.UUID, dict]
    tags: dict[uuid.UUID, dict]
    live: dict[str, dict] = field(default_factory=dict)
    tombs: dict[tuple[uuid.UUID | None, str], dict] = field(default_factory=dict)
    tomb_keys: dict[str, dict] = field(default_factory=dict)


def _load_catalog(db: Session, project_id: uuid.UUID, keys: list[str] | None) -> _Catalog:
    scope = StringEntry.project_id == project_id
    if keys is not None:
        scope &= StringEntry.key == any_(bindparam("import_keys", keys, type_=ARRAY(String)))
    entries = {
        row["id"]: dict(row)
        for row in db.execute(select(StringEntry.__table__).where(scope)).mappings()
    }
    translations: dict[uuid.UUID, dict[str, dict]] = {}
    for row in db.execute(select(Translation.__table__).join(StringEntry).where(scope)).mappings():
        translations.setdefault(row["string_id"], {})[row["locale"]] = dict(row)
    links: dict[uuid.UUID, set[uuid.UUID]] = {}
    for row in db.execute(select(StringTag.__table__).join(StringEntry).where(scope)).mappings():
        links.setdefault(row["string_id"], set()).add(row["tag_id"])
    modules = {
        row["id"]: dict(row)
        for row in db.execute(
            select(Module.__table__).where(Module.project_id == project_id)
        ).mappings()
    }
    tags = {
        row["id"]: dict(row)
        for row in db.execute(select(Tag.__table__).where(Tag.project_id == project_id)).mappings()
    }
    catalog = _Catalog(entries, translations, links, modules, tags)
    for entry in entries.values():
        if entry["deleted_at"] is None:
            catalog.live[entry["key"]] = entry
        else:
            catalog.tombs.setdefault((entry["module_id"], entry["key"]), entry)
            if entry["key"] not in catalog.tomb_keys or entry["module_id"] is None:
                catalog.tomb_keys[entry["key"]] = entry
    return catalog


def _lookup(catalog: _Catalog, key: str, module_id: uuid.UUID | None) -> dict | None:
    live = catalog.live.get(key)
    if module_id is None:
        return live or catalog.tombs.get((None, key)) or catalog.tomb_keys.get(key)
    if live is not None and live["module_id"] == module_id:
        return live
    return catalog.tombs.get((module_id, key))


def _module_label(catalog: _Catalog, module_id: uuid.UUID | None) -> str:
    return catalog.modules.get(module_id, {}).get("slug", "unassigned")


def _module_ids(catalog: _Catalog) -> dict[str, uuid.UUID]:
    return {row["slug"]: mid for mid, row in catalog.modules.items()}


def _validate(catalog: _Catalog, rows: list[ImportRow], *, reject_deleted: bool) -> None:
    modules = _module_ids(catalog)
    owners: dict[str, uuid.UUID | str | None] = {}
    pending, tombstones = set(), set()
    for row in rows:
        reject_nul(row.key, field="key", key=row.key, context=row.context)
        if len(row.key) > KEY_MAX_LENGTH:
            raise HTTPException(
                400,
                f"{row.context}key {key_preview(row.key)} must be at most {KEY_MAX_LENGTH} characters",
            )
        reject_nul(row.description, field="description", key=row.key, context=row.context)
        for locale, value in row.values.items():
            reject_nul(locale, field="locale", key=row.key, context=row.context)
            require_locale_code(locale)
            reject_nul(
                value, field=f"translation value ({locale})", key=row.key, context=row.context
            )
        for name in row.tag_names:
            reject_nul(name, field="tag name", key=row.key, context=row.context)
        if any(tid not in catalog.tags for tid in row.tag_ids):
            raise HTTPException(400, "Unknown tag")
    if reject_deleted:
        wanted = {row.key for row in rows}
        modular = any(row.scoped for row in rows)
        for entry in catalog.entries.values():
            if entry["key"] not in wanted:
                continue
            label = (
                entry["key"]
                if not modular
                else f"{_module_label(catalog, entry['module_id']) if entry['module_id'] else '_unassigned'}/{entry['key']}"
            )
            if entry["deleted_at"] is not None and entry["key"] not in catalog.live:
                tombstones.add(label)
            elif entry["deleted_at"] is None and entry["pending_delete"]:
                pending.add(label)
        if pending or tombstones:
            raise HTTPException(
                409,
                detail={
                    "code": "push_deleted_keys",
                    "message": "Push includes keys removed on x-locale. Restore them in x-locale or remove them from local source files before pushing.",
                    "pending_remove": sorted(pending),
                    "tombstones": sorted(tombstones),
                },
            )
    for row in rows:
        mid = modules.get(row.module) if isinstance(row.module, str) else row.module
        live = catalog.live.get(row.key)
        if row.scoped:
            owner = mid if mid is not None else row.module
            if row.key in owners and owners[row.key] != owner:
                raise HTTPException(409, f"String '{row.key}' appears in more than one module")
            owners[row.key] = owner
            if live is not None and (
                live["module_id"] != mid or isinstance(row.module, str) and mid is None
            ):
                raise HTTPException(
                    409,
                    f"String '{row.key}' already exists in module '{_module_label(catalog, live['module_id'])}'",
                )


def _create_references(
    db: Session,
    project: Project,
    catalog: _Catalog,
    rows: list[ImportRow],
    groups: list[tuple[uuid.UUID | str | None, str | None]],
    dry_run: bool,
) -> dict[str, uuid.UUID]:
    modules = _module_ids(catalog)
    slugs = {ref for ref, _ in groups if isinstance(ref, str)} | {
        row.module for row in rows if isinstance(row.module, str)
    }
    new_modules = [
        {
            "id": uuid.uuid4(),
            "project_id": project.id,
            "slug": slug,
            "name": slug.replace("-", " ").replace("_", " ").title(),
            "position": 0,
        }
        for slug in sorted(slugs - modules.keys())
    ]
    tags = {row["name"]: tid for tid, row in catalog.tags.items()}
    names = {name for row in rows for name in row.tag_names}
    new_tags = [
        {"id": uuid.uuid4(), "project_id": project.id, "name": name, "color": "#64748b"}
        for name in sorted(names - tags.keys())
    ]
    if dry_run:
        catalog.modules.update({row["id"]: row for row in new_modules})
        catalog.tags.update({row["id"]: row for row in new_tags})
    else:
        if new_modules:
            insert_rows(db, Module.__table__, new_modules, ignore_conflicts=True)
            catalog.modules = {
                row["id"]: dict(row)
                for row in db.execute(
                    select(Module.__table__).where(Module.project_id == project.id)
                ).mappings()
            }
        if new_tags:
            insert_rows(db, Tag.__table__, new_tags, ignore_conflicts=True)
            catalog.tags = {
                row["id"]: dict(row)
                for row in db.execute(
                    select(Tag.__table__).where(Tag.project_id == project.id)
                ).mappings()
            }
    return _module_ids(catalog)


def _snapshot(catalog: _Catalog, entry: dict) -> dict[str, Any]:
    sid = entry["id"]
    translations = catalog.translations.get(sid, {})
    tids = sorted(catalog.links.get(sid, ()), key=str)
    return {
        "id": str(sid),
        "project_id": str(entry["project_id"]),
        **{name: _jsonify(entry.get(name)) for name in STRING_FIELDS},
        "tag_ids": [str(tid) for tid in tids],
        "tag_names": [catalog.tags[tid]["name"] for tid in tids],
        "translations": {loc: row["value"] or "" for loc, row in translations.items()},
        "published_translations": {
            loc: row["published_value"] for loc, row in translations.items()
        },
    }


def _needs_publication(catalog: _Catalog, entry: dict) -> bool:
    return (
        entry["status"] != TranslationStatus.public
        or entry["published_at"] is None
        or entry["pending_delete"]
        or any(
            entry[f"published_{name}"] != entry[name]
            for name in ("key", "module_id", "source_text")
        )
        or any(
            translation["published_value"] != (translation["value"] or "")
            for translation in catalog.translations.get(entry["id"], {}).values()
        )
    )


def import_rows(
    db: Session,
    project: Project,
    rows: list[ImportRow],
    *,
    groups: list[tuple[uuid.UUID | str | None, str | None]],
    dry_run: bool,
    status: TranslationStatus = TranslationStatus.draft,
    partial: bool = False,
    report_orphans: bool = True,
    reject_deleted: bool = False,
) -> ImportResult:
    catalog = _load_catalog(
        db, project.id, list(dict.fromkeys(row.key for row in rows)) if partial else None
    )
    report_progress(db, "validating")
    _validate(catalog, rows, reject_deleted=reject_deleted)
    modules = _create_references(db, project, catalog, rows, groups, dry_run)
    tag_names = {row["name"]: tid for tid, row in catalog.tags.items()}
    actor_type, actor_id, actor_label, batch_id, batch_kind = _actor_from_session(db)
    now = datetime.now(UTC)
    before: dict[uuid.UUID, dict | None] = {}
    original_fields: dict[uuid.UUID, dict] = {}
    original_links: dict[uuid.UUID, set[uuid.UUID]] = {}
    new_ids: set[uuid.UUID] = set()
    changed_ids: set[uuid.UUID] = set()
    dirty_translations: dict[uuid.UUID, dict] = {}
    published_translations: dict[uuid.UUID, dict] = {}
    new_translation_ids: set[uuid.UUID] = set()
    create_items, update_items = [], []
    creates = updates = 0
    seen: dict[uuid.UUID | str | None, set[str]] = {}

    for row in rows:
        seen.setdefault(row.module, set()).add(row.key)
        mid = modules[row.module] if isinstance(row.module, str) else row.module
        entry = _lookup(catalog, row.key, mid)
        live = catalog.live.get(row.key)
        if live is not None and (entry is None or entry["id"] != live["id"]):
            raise HTTPException(409, f"String '{row.key}' already exists")
        source = row.values.get(project.base_language, entry["source_text"] if entry else row.key)
        old_trans = catalog.translations.get(entry["id"], {}) if entry else {}
        tids = {tag_names[name] for name in row.tag_names} if row.excel else set(row.tag_ids)
        old_links = catalog.links.get(entry["id"], set()) if entry else set()
        tags_changed = bool(tids) and (tids != old_links if row.excel else not tids <= old_links)
        values_changed = (
            entry is None
            or entry["deleted_at"] is not None
            or source != entry["source_text"]
            or any(
                old_trans.get(loc, {}).get("value", "") != value
                for loc, value in row.values.items()
                if loc != project.base_language
            )
        )
        described = (
            row.excel
            and row.description is not None
            and (entry is None or entry["description"] != row.description)
        )
        diff_changed = (
            (
                entry is not None
                and (entry["deleted_at"] is not None or source != entry["source_text"] or described)
            )
            if row.excel
            else values_changed
            or tags_changed
            or status == TranslationStatus.public
            and _needs_publication(catalog, entry)
        )
        item = ImportDiffItem(
            key=row.label if row.label is not None else row.key, source_text=source
        )
        if entry is None:
            creates += 1
            if len(create_items) < IMPORT_DIFF_SAMPLE:
                create_items.append(item)
        elif diff_changed:
            updates += 1
            if len(update_items) < IMPORT_DIFF_SAMPLE:
                update_items.append(item)
        if dry_run or not row.excel and entry is not None and not diff_changed:
            continue
        if entry is None:
            sid = uuid.uuid4()
            entry = {
                "id": sid,
                "project_id": project.id,
                "module_id": mid,
                "key": row.key,
                "source_text": source,
                "description": row.description,
                "status": status,
                "published_key": None,
                "published_module_id": None,
                "published_source_text": None,
                "published_at": None,
                "pending_delete": False,
                "deleted_at": None,
                "created_by_type": actor_type,
                "created_by_id": actor_id,
                "created_by_label": actor_label,
            }
            catalog.entries[sid] = entry
            catalog.live[row.key] = entry
            new_ids.add(sid)
            before[sid] = None
            original_links[sid] = set()
            if not row.excel:
                for locale in project.target_languages:
                    require_locale_code(locale)
                    translation = {
                        "id": uuid.uuid4(),
                        "string_id": sid,
                        "locale": locale,
                        "value": "",
                        "published_value": None,
                        "confidence": None,
                    }
                    catalog.translations.setdefault(sid, {})[locale] = translation
                    dirty_translations[translation["id"]] = translation
                    new_translation_ids.add(translation["id"])
        sid = entry["id"]
        if sid not in before:
            before[sid] = _snapshot(catalog, entry)
            original_fields[sid] = dict(entry)
            original_links[sid] = set(old_links)
        working = catalog.translations.setdefault(sid, {})
        mutated = sid in new_ids or values_changed or described or tags_changed
        if values_changed or described or sid in new_ids:
            entry["source_text"] = source
            if row.description is not None:
                entry["description"] = row.description
        if not row.excel or entry["deleted_at"] is not None:
            if entry["pending_delete"] or entry["deleted_at"] is not None:
                mutated = True
            entry["pending_delete"] = False
            entry["deleted_at"] = None
        if tids:
            catalog.links[sid] = tids if row.excel else old_links | tids
        for locale, value in row.values.items():
            if locale == project.base_language:
                continue
            translation = working.get(locale)
            if translation is None:
                translation = {
                    "id": uuid.uuid4(),
                    "string_id": sid,
                    "locale": locale,
                    "value": value,
                    "published_value": None,
                    "confidence": None,
                }
                working[locale] = translation
                new_translation_ids.add(translation["id"])
                dirty_translations[translation["id"]] = translation
                if before[sid] is not None:
                    before[sid]["translations"][locale] = ""
                    before[sid]["published_translations"][locale] = None
                mutated = True
            elif translation["value"] != value:
                translation.update(value=value, confidence=None)
                dirty_translations[translation["id"]] = translation
                mutated = True
        if mutated:
            changed_ids.add(sid)

    # Publish the final working copy after all repeated rows have been applied.
    if status == TranslationStatus.public:
        for sid in before:
            entry = catalog.entries[sid]
            if not _needs_publication(catalog, entry):
                continue
            entry.update(
                published_key=entry["key"],
                published_module_id=entry["module_id"],
                published_source_text=entry["source_text"],
                published_at=now,
                status=TranslationStatus.public,
                pending_delete=False,
            )
            for translation in catalog.translations.get(sid, {}).values():
                value = translation["value"] or ""
                if translation["published_value"] != value:
                    translation["published_value"] = value
                    if translation["id"] not in new_translation_ids:
                        published_translations[translation["id"]] = {
                            "id": translation["id"],
                            "published_value": value,
                        }
            changed_ids.add(sid)

    for sid in changed_ids:
        catalog.entries[sid].update(
            updated_at=now,
            updated_by_type=actor_type,
            updated_by_id=actor_id,
            updated_by_label=actor_label,
        )

    orphan_items = []
    orphan_count = 0
    if report_orphans and not partial:
        orphans = []
        for ref, label in groups:
            mid = modules[ref] if isinstance(ref, str) else ref
            wanted = seen.get(ref, set())
            for entry in catalog.live.values():
                if entry["key"] not in wanted and (mid is None or entry["module_id"] == mid):
                    key = f"{label}/{entry['key']}" if label is not None else entry["key"]
                    orphans.append((key, entry["source_text"]))
        orphan_count = len(orphans)
        orphan_items = [
            ImportDiffItem(key=key, source_text=source)
            for key, source in sorted(orphans)[:IMPORT_DIFF_SAMPLE]
        ]

    if not dry_run:
        report_progress(db, "writing", 0, WRITE_STEPS)
        insert_rows(
            db, StringEntry.__table__, [catalog.entries[sid] for sid in changed_ids & new_ids]
        )
        update_columns = (
            *STRING_FIELDS,
            "updated_at",
            "updated_by_type",
            "updated_by_id",
            "updated_by_label",
        )
        updates_by_columns: dict[tuple[str, ...], list[dict]] = {}
        for sid in changed_ids - new_ids:
            entry = catalog.entries[sid]
            values = {
                "id": sid,
                **{
                    name: entry[name]
                    for name in update_columns
                    if entry[name] != original_fields[sid][name]
                },
            }
            updates_by_columns.setdefault(tuple(values), []).append(values)
        for updates_for_columns in updates_by_columns.values():
            update_rows(db, StringEntry.__table__, updates_for_columns)
        insert_rows(
            db,
            Translation.__table__,
            [row for tid, row in dirty_translations.items() if tid in new_translation_ids],
        )
        update_rows(
            db,
            Translation.__table__,
            [
                {"id": tid, "value": row["value"], "confidence": row["confidence"]}
                for tid, row in dirty_translations.items()
                if tid not in new_translation_ids
            ],
        )
        update_rows(db, Translation.__table__, list(published_translations.values()))
        report_progress(db, "writing", 1, WRITE_STEPS)
        replaced = [
            sid for sid in changed_ids if not original_links[sid] <= catalog.links.get(sid, set())
        ]
        if replaced:
            db.execute(
                delete(StringTag.__table__).where(
                    StringTag.string_id
                    == any_(
                        bindparam("replaced_tags", replaced, type_=ARRAY(StringTag.string_id.type))
                    )
                )
            )
        inserted_links = [
            {"string_id": sid, "tag_id": tid}
            for sid in changed_ids
            for tid in catalog.links.get(sid, set())
            - (set() if sid in replaced else original_links[sid])
        ]
        insert_rows(db, StringTag.__table__, inserted_links, ignore_conflicts=True)
        report_progress(db, "writing", 2, WRITE_STEPS)
        audit = []
        for sid in changed_ids:
            after = _snapshot(catalog, catalog.entries[sid])
            initial = before[sid]
            if initial == after:
                continue
            action = "create" if initial is None else "update"
            event = classify_event(action=action, before=initial, after=after)
            audit.append(
                {
                    "id": uuid.uuid4(),
                    "project_id": project.id,
                    "actor_type": actor_type,
                    "actor_id": actor_id,
                    "actor_label": actor_label,
                    "action": action,
                    "entity_type": "string",
                    "entity_id": str(sid),
                    "string_id": sid,
                    "locale": event.locale,
                    "before": initial,
                    "after": after,
                    "event_type": event.event_type,
                    "summary": event.summary,
                    "batch_id": batch_id,
                    "batch_kind": batch_kind,
                    "is_revertible": True,
                    "created_at": now,
                }
            )
        insert_rows(db, Activity.__table__, audit)
        report_progress(db, "writing", WRITE_STEPS, WRITE_STEPS)
    return ImportResult(
        created=0 if dry_run else creates,
        updated=0 if dry_run else updates,
        total=len(rows),
        dry_run=dry_run,
        diff=ImportDiff(
            create=create_items,
            update=update_items,
            orphan=orphan_items,
            create_count=creates,
            update_count=updates,
            orphan_count=orphan_count,
        ),
    )
