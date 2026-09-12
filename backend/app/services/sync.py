"""Stage-aware JSON export/import (Excel stays in app.excel)."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from app.helpers import content_hash, export_key
from app.models import Module, Project, StringEntry, Tag, TranslationStatus
from app.schemas import ImportDiff, ImportDiffItem, ImportKeyLists, ImportResult, SyncStateOut
from app.services.strings import (
    apply_translation_values,
    ensure_translation_rows,
    promote_string,
    restore_string,
)

CLI_UNASSIGNED = "_unassigned"
IMPORT_DIFF_SAMPLE = 100


def load_export_entries(db: Session, project_id) -> list[StringEntry]:
    return (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.module),
            joinedload(StringEntry.published_module),
        )
        .filter(StringEntry.project_id == project_id)
        .order_by(StringEntry.key)
        .all()
    )


def load_sync_state_entries(db: Session, project_id) -> list[StringEntry]:
    """Pending-remove / tombstone labels only — skip translations and tags."""
    return (
        db.query(StringEntry)
        .options(joinedload(StringEntry.module))
        .filter(StringEntry.project_id == project_id)
        .all()
    )


def translation_value(
    entry: StringEntry,
    locale: str,
    project: Project,
    stage: str,
    by_locale: dict[str, Any] | None = None,
) -> str | None:
    """Return value for locale given stage, or None to omit."""
    if locale == project.base_language:
        if stage == "public":
            if entry.published_source_text is not None:
                return entry.published_source_text
            return entry.source_text
        return entry.source_text

    translations = by_locale if by_locale is not None else {t.locale: t for t in entry.translations}
    if stage == "public":
        if entry.status != TranslationStatus.public:
            return None
        translation = translations.get(locale)
        if translation is not None and translation.published_value is not None:
            return translation.published_value
        return ""

    translation = translations.get(locale)
    if translation and translation.value.strip():
        return translation.value
    return None


def project_locales(project: Project) -> list[str]:
    return [project.base_language, *project.target_languages]


def resolve_export_locales(project: Project, locale: str | None) -> list[str]:
    locales = project_locales(project)
    if not locale:
        return locales
    if locale not in locales:
        raise HTTPException(status_code=400, detail=f"Unknown locale '{locale}'")
    return [locale]


def normalize_export_stage(stage: str) -> str:
    """UI 'all' means every string; same contents as API stage=draft."""
    return "draft" if stage == "all" else stage


def build_flat_export(
    project: Project,
    entries: list[StringEntry],
    stage: str,
    locale: str | None = None,
) -> dict[str, dict[str, str]]:
    locales = resolve_export_locales(project, locale)
    result: dict[str, dict[str, str]] = {loc: {} for loc in locales}
    for entry in entries:
        if entry.deleted_at is not None:
            continue
        if stage == "public":
            if entry.status != TranslationStatus.public:
                continue
        elif entry.pending_delete:
            continue
        key = export_key(entry, published=stage == "public")
        by_locale = {t.locale: t for t in entry.translations}
        for locale in locales:
            val = translation_value(entry, locale, project, stage, by_locale)
            if val is not None:
                result[locale][key] = val
            elif locale == project.base_language:
                result[locale][key] = (
                    entry.published_source_text
                    if stage == "public" and entry.published_source_text is not None
                    else entry.source_text
                )
    return result


def build_modular_export(
    project: Project,
    entries: list[StringEntry],
    stage: str,
    locale: str | None = None,
) -> dict[str, Any]:
    locales = resolve_export_locales(project, locale)
    modules: dict[str, dict[str, dict[str, str]]] = {}
    unassigned: dict[str, dict[str, str]] = {loc: {} for loc in locales}

    for entry in entries:
        if entry.deleted_at is not None:
            continue
        if stage == "public":
            if entry.status != TranslationStatus.public:
                continue
            module = entry.published_module
            key = entry.published_key or entry.key
        else:
            if entry.pending_delete:
                continue
            module = entry.module
            key = entry.key
        bucket_key = module.slug if module else None
        if bucket_key:
            if bucket_key not in modules:
                modules[bucket_key] = {loc: {} for loc in locales}
            target = modules[bucket_key]
        else:
            target = unassigned

        by_locale = {t.locale: t for t in entry.translations}
        for locale in locales:
            val = translation_value(entry, locale, project, stage, by_locale)
            if val is not None:
                target[locale][key] = val
            elif locale == project.base_language:
                target[locale][key] = (
                    entry.published_source_text
                    if stage == "public" and entry.published_source_text is not None
                    else entry.source_text
                )

    module_list = sorted(modules.keys())
    manifest = {
        "modules": module_list,
        "locales": locales,
        "base_language": project.base_language,
        "content_hash": content_hash({"modules": modules, "unassigned": unassigned}),
    }
    return {"modules": modules, "unassigned": unassigned, "manifest": manifest}


def _cli_identity(entry: StringEntry, layout: str, *, published: bool = False) -> str:
    """Key label matching CLI status identity (modular ``module/key``, flat export key)."""
    if layout == "flat":
        return export_key(entry, published=published)
    if published:
        module = entry.published_module
        key = entry.published_key or entry.key
    else:
        module = entry.module
        key = entry.key
    if module:
        return f"{module.slug}/{key}"
    return f"{CLI_UNASSIGNED}/{key}"


def build_sync_state(
    project: Project,
    entries: list[StringEntry],
    layout: str,
    stage: str,
) -> SyncStateOut:
    pending_remove: list[str] = []
    tombstones: list[str] = []
    seen_pending: set[str] = set()
    seen_tombstones: set[str] = set()
    for entry in entries:
        label = _cli_identity(entry, layout, published=False)
        if entry.deleted_at is not None:
            if label not in seen_tombstones:
                tombstones.append(label)
                seen_tombstones.add(label)
        elif entry.pending_delete:
            if label not in seen_pending:
                pending_remove.append(label)
                seen_pending.add(label)
    return SyncStateOut(
        stage=stage,
        layout=layout,
        base_language=project.base_language,
        exported=[],
        pending_remove=sorted(pending_remove),
        tombstones=sorted(tombstones),
    )


def _layout_value(project: Project) -> str:
    layout = project.layout
    return layout.value if hasattr(layout, "value") else str(layout)


def _is_str_map(value: Any) -> bool:
    return isinstance(value, dict) and all(isinstance(v, str) for v in value.values())


def _is_locale_maps(value: Any) -> bool:
    return isinstance(value, dict) and bool(value) and all(_is_str_map(v) for v in value.values())


def _union_keys(locale_maps: dict[str, dict[str, str]]) -> list[str]:
    seen: set[str] = set()
    keys: list[str] = []
    for mapping in locale_maps.values():
        for key in mapping:
            if key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


def _known_locale_maps(
    project: Project, locale_maps: dict[str, dict[str, str]]
) -> dict[str, dict[str, str]]:
    allowed = set(project_locales(project))
    return {loc: mapping for loc, mapping in locale_maps.items() if loc in allowed}


def _get_or_create_module(
    db: Session, project: Project, slug: str, *, dry_run: bool
) -> Module | None:
    mod = (
        db.query(Module)
        .filter(Module.project_id == project.id, Module.slug == slug)
        .first()
    )
    if mod or dry_run:
        return mod
    mod = Module(
        project_id=project.id,
        slug=slug,
        name=slug.replace("-", " ").replace("_", " ").title(),
    )
    db.add(mod)
    db.flush()
    return mod


def resolve_json_import_module(
    db: Session, project: Project, module_id: UUID | None
) -> UUID | None:
    """Validate optional JSON import module. Flat projects cannot assign a module."""
    if module_id is None:
        return None
    if _layout_value(project) != "modular":
        raise HTTPException(
            status_code=400,
            detail="Flat projects do not assign modules on JSON import",
        )
    mod = (
        db.query(Module)
        .filter(Module.project_id == project.id, Module.id == module_id)
        .first()
    )
    if not mod:
        raise HTTPException(status_code=400, detail="Unknown module")
    return mod.id


def resolve_json_import_tags(
    db: Session, project: Project, tag_ids: list[UUID] | None
) -> list[Tag]:
    """Validate optional JSON import tags. Unknown ids are rejected."""
    if not tag_ids:
        return []
    unique_ids = list(dict.fromkeys(tag_ids))
    tags = (
        db.query(Tag)
        .filter(Tag.project_id == project.id, Tag.id.in_(unique_ids))
        .all()
    )
    if len(tags) != len(unique_ids):
        raise HTTPException(status_code=400, detail="Unknown tag")
    by_id = {tag.id: tag for tag in tags}
    return [by_id[tid] for tid in unique_ids]


def _tags_would_change(entry: StringEntry, tags: list[Tag]) -> bool:
    if not tags:
        return False
    existing = {tag.id for tag in (entry.tags or [])}
    return any(tag.id not in existing for tag in tags)


def _apply_import_tags(entry: StringEntry, tags: list[Tag]) -> bool:
    if not tags:
        return False
    existing = {tag.id for tag in (entry.tags or [])}
    changed = False
    for tag in tags:
        if tag.id not in existing:
            entry.tags.append(tag)
            existing.add(tag.id)
            changed = True
    return changed


class _ImportIndex:
    def __init__(self, entries: list[StringEntry]) -> None:
        self.by_module_key: dict[tuple[UUID | None, str], StringEntry] = {}
        self.deleted_by_module_key: dict[tuple[UUID | None, str], StringEntry] = {}
        self.by_key: dict[str, StringEntry] = {}
        self.deleted_by_key: dict[str, StringEntry] = {}
        for entry in entries:
            self.add(entry)

    def add(self, entry: StringEntry) -> None:
        dest_module = self.deleted_by_module_key if entry.deleted_at else self.by_module_key
        dest_key = self.deleted_by_key if entry.deleted_at else self.by_key
        dest_module[(entry.module_id, entry.key)] = entry
        existing = dest_key.get(entry.key)
        if existing is None or entry.module_id is None:
            dest_key[entry.key] = entry

    def lookup(self, key: str, *, module_id: UUID | None) -> StringEntry | None:
        live = self.by_module_key.get((module_id, key))
        if live is not None:
            return live
        deleted = self.deleted_by_module_key.get((module_id, key))
        if deleted is not None:
            return deleted
        if module_id is None:
            return self.by_key.get(key) or self.deleted_by_key.get(key)
        return None


def _values_changed(entry: StringEntry, project: Project, values: dict[str, str]) -> bool:
    if project.base_language in values and entry.source_text != values[project.base_language]:
        return True
    by_locale = {t.locale: t.value for t in entry.translations}
    for locale, value in values.items():
        if locale == project.base_language:
            continue
        if by_locale.get(locale, "") != value:
            return True
    return False


def _preview_source_text(
    project: Project,
    key: str,
    values: dict[str, str],
    entry: StringEntry | None = None,
) -> str:
    if project.base_language in values:
        text = values[project.base_language]
        if text:
            return text
    if entry is not None:
        return entry.source_text
    return key


def _upsert_imported_string(
    db: Session,
    project: Project,
    index: _ImportIndex,
    key: str,
    values: dict[str, str],
    *,
    dry_run: bool,
    status: TranslationStatus,
    module_id: UUID | None,
    tags: list[Tag],
) -> tuple[str, StringEntry | None]:
    """Return ('create'|'update'|'unchanged', entry_or_none)."""
    entry = index.lookup(key, module_id=module_id)
    if entry is None:
        if not dry_run:
            source_text = values.get(project.base_language, "") or key
            entry = StringEntry(
                id=uuid4(),
                project_id=project.id,
                module_id=module_id,
                key=key,
                source_text=source_text,
                status=status,
            )
            db.add(entry)
            ensure_translation_rows(db, entry, project)
            apply_translation_values(
                db,
                entry,
                {loc: val for loc, val in values.items() if loc != project.base_language},
            )
            if status == TranslationStatus.public:
                promote_string(entry)
            _apply_import_tags(entry, tags)
            index.add(entry)
        return "create", entry

    revived = bool(entry.deleted_at)
    values_changed = revived or _values_changed(entry, project, values)
    tags_changed = _tags_would_change(entry, tags)
    if not values_changed and not tags_changed:
        return "unchanged", entry

    if not dry_run:
        restore_string(entry)
        if project.base_language in values:
            entry.source_text = values[project.base_language]
        apply_translation_values(
            db,
            entry,
            {loc: val for loc, val in values.items() if loc != project.base_language},
        )
        _apply_import_tags(entry, tags)
    return "update", entry


def _import_locale_maps(
    db: Session,
    project: Project,
    locale_maps: dict[str, dict[str, str]],
    *,
    dry_run: bool,
    status: TranslationStatus,
    module_id: UUID | None,
    report_orphans: bool,
    index: _ImportIndex,
    tags: list[Tag],
) -> tuple[list[ImportDiffItem], list[ImportDiffItem], list[ImportDiffItem], list[str], int]:
    create_items: list[ImportDiffItem] = []
    update_items: list[ImportDiffItem] = []
    noop_keys: list[str] = []
    seen: set[str] = set()
    total = 0
    maps = _known_locale_maps(project, locale_maps)
    for key in _union_keys(maps):
        values = {loc: mapping[key] for loc, mapping in maps.items() if key in mapping}
        if not values:
            continue
        total += 1
        seen.add(key)
        action, entry = _upsert_imported_string(
            db,
            project,
            index,
            key,
            values,
            dry_run=dry_run,
            status=status,
            module_id=module_id,
            tags=tags,
        )
        if action == "create":
            create_items.append(
                ImportDiffItem(
                    key=key,
                    source_text=_preview_source_text(project, key, values, entry),
                )
            )
        elif action == "update":
            update_items.append(
                ImportDiffItem(
                    key=key,
                    source_text=_preview_source_text(project, key, values, entry),
                )
            )
        else:
            noop_keys.append(key)
    orphan_items: list[ImportDiffItem] = []
    if report_orphans:
        seen_orphan: set[str] = set()
        for (mid, k), entry in index.by_module_key.items():
            if k in seen or k in seen_orphan:
                continue
            if module_id is not None and mid != module_id:
                continue
            seen_orphan.add(k)
            orphan_items.append(ImportDiffItem(key=k, source_text=entry.source_text))
        orphan_items.sort(key=lambda item: item.key)
    return create_items, update_items, orphan_items, noop_keys, total


def _scope_items(slug: str, items: list[ImportDiffItem]) -> list[ImportDiffItem]:
    return [
        ImportDiffItem(key=f"{slug}/{item.key}", source_text=item.source_text)
        for item in items
    ]


def _result(
    *,
    create_items: list[ImportDiffItem],
    update_items: list[ImportDiffItem],
    orphan_items: list[ImportDiffItem],
    total: int,
    dry_run: bool,
    noop_keys: list[str] | None = None,
    full_diff: bool = False,
) -> ImportResult:
    unchanged = noop_keys or []
    keys = None
    if full_diff:
        keys = ImportKeyLists(
            create=[item.key for item in create_items],
            update=[item.key for item in update_items],
            noop=unchanged,
        )
    diff = ImportDiff(
        create=create_items[:IMPORT_DIFF_SAMPLE],
        update=update_items[:IMPORT_DIFF_SAMPLE],
        orphan=orphan_items[:IMPORT_DIFF_SAMPLE],
        create_count=len(create_items),
        update_count=len(update_items),
        orphan_count=len(orphan_items),
        noop_count=len(unchanged) if full_diff else 0,
        keys=keys,
    )
    return ImportResult(
        created=0 if dry_run else len(create_items),
        updated=0 if dry_run else len(update_items),
        total=total,
        dry_run=dry_run,
        diff=diff,
    )


def import_flat_strings(
    db: Session,
    project: Project,
    strings: dict[str, str],
    *,
    dry_run: bool,
    status: TranslationStatus = TranslationStatus.draft,
    module_id: UUID | None = None,
    tags: list[Tag] | None = None,
    report_orphans: bool = True,
    full_diff: bool = False,
) -> ImportResult:
    """CLI / source-locale import: `{ key: source_text }` stored as-is."""
    return import_locale_payload(
        db,
        project,
        {project.base_language: strings},
        dry_run=dry_run,
        status=status,
        module_id=module_id,
        tags=tags,
        report_orphans=report_orphans,
        full_diff=full_diff,
    )


def import_locale_payload(
    db: Session,
    project: Project,
    locale_maps: dict[str, dict[str, str]],
    *,
    dry_run: bool,
    status: TranslationStatus = TranslationStatus.draft,
    module_id: UUID | None = None,
    tags: list[Tag] | None = None,
    report_orphans: bool = True,
    full_diff: bool = False,
) -> ImportResult:
    entries = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.module),
            joinedload(StringEntry.translations),
            selectinload(StringEntry.tags),
        )
        .filter(StringEntry.project_id == project.id)
        .all()
    )
    index = _ImportIndex(entries)
    create_items, update_items, orphan_items, noop_keys, total = _import_locale_maps(
        db,
        project,
        locale_maps,
        dry_run=dry_run,
        status=status,
        module_id=module_id,
        report_orphans=report_orphans,
        index=index,
        tags=tags or [],
    )
    return _result(
        create_items=create_items,
        update_items=update_items,
        orphan_items=orphan_items,
        noop_keys=noop_keys,
        total=total,
        dry_run=dry_run,
        full_diff=full_diff,
    )


def import_modular_payload(
    db: Session,
    project: Project,
    modules: dict[str, dict[str, dict[str, str]]],
    unassigned: dict[str, dict[str, str]] | None,
    *,
    dry_run: bool,
    status: TranslationStatus = TranslationStatus.draft,
    tags: list[Tag] | None = None,
    full_diff: bool = False,
) -> ImportResult:
    entries = (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.module),
            joinedload(StringEntry.translations),
            selectinload(StringEntry.tags),
        )
        .filter(StringEntry.project_id == project.id)
        .all()
    )
    import_tags = tags or []
    index = _ImportIndex(entries)
    create_items: list[ImportDiffItem] = []
    update_items: list[ImportDiffItem] = []
    orphan_items: list[ImportDiffItem] = []
    noop_keys: list[str] = []
    total = 0

    for slug, locale_maps in modules.items():
        if not isinstance(locale_maps, dict):
            continue
        mod = _get_or_create_module(db, project, slug, dry_run=dry_run)
        created, updated, orphans, unchanged, count = _import_locale_maps(
            db,
            project,
            locale_maps,
            dry_run=dry_run,
            status=status,
            module_id=mod.id if mod else None,
            report_orphans=True,
            index=index,
            tags=import_tags,
        )
        create_items.extend(_scope_items(slug, created))
        update_items.extend(_scope_items(slug, updated))
        orphan_items.extend(_scope_items(slug, orphans))
        noop_keys.extend(f"{slug}/{k}" for k in unchanged)
        total += count

    if unassigned and _is_locale_maps(unassigned):
        created, updated, orphans, unchanged, count = _import_locale_maps(
            db,
            project,
            unassigned,
            dry_run=dry_run,
            status=status,
            module_id=None,
            report_orphans=True,
            index=index,
            tags=import_tags,
        )
        create_items.extend(created)
        update_items.extend(updated)
        orphan_items.extend(orphans)
        noop_keys.extend(unchanged)
        total += count

    orphan_items.sort(key=lambda item: item.key)
    return _result(
        create_items=create_items,
        update_items=update_items,
        orphan_items=orphan_items,
        noop_keys=noop_keys,
        total=total,
        dry_run=dry_run,
        full_diff=full_diff,
    )


def import_json_data(
    db: Session,
    project: Project,
    data: Any,
    *,
    dry_run: bool,
    locale: str | None = None,
    status: TranslationStatus = TranslationStatus.draft,
    module_id: UUID | None = None,
    tag_ids: list[UUID] | None = None,
    report_orphans: bool | None = None,
    full_diff: bool = False,
) -> ImportResult:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="JSON import must be an object")

    target_module_id = resolve_json_import_module(db, project, module_id)
    tags = resolve_json_import_tags(db, project, tag_ids)

    modules = data.get("modules")
    if isinstance(modules, dict) and modules and all(
        isinstance(v, dict) and (not v or _is_locale_maps(v) or _is_str_map(v))
        for v in modules.values()
    ):
        # Modular export: { modules: { slug: { locale: { key: value } } }, unassigned: {...} }
        if any(_is_locale_maps(v) or not v for v in modules.values()):
            unassigned = data.get("unassigned")
            return import_modular_payload(
                db,
                project,
                modules,
                unassigned if isinstance(unassigned, dict) else None,
                dry_run=dry_run,
                status=status,
                tags=tags,
                full_diff=full_diff,
            )

    strings = data.get("strings")
    if _is_str_map(strings):
        return import_flat_strings(
            db,
            project,
            strings,
            dry_run=dry_run,
            status=status,
            module_id=target_module_id,
            tags=tags,
            report_orphans=True if report_orphans is None else report_orphans,
            full_diff=full_diff,
        )

    if _is_locale_maps(data) and set(data).issubset(project_locales(project)):
        # Exported `{ locale: { key: value } }` — import every locale in the file.
        return import_locale_payload(
            db,
            project,
            data,
            dry_run=dry_run,
            status=status,
            module_id=target_module_id,
            tags=tags,
            report_orphans=True if report_orphans is None else report_orphans,
            full_diff=full_diff,
        )

    if _is_str_map(data):
        target = locale or project.base_language
        if target not in project_locales(project):
            raise HTTPException(status_code=400, detail=f"Unknown locale '{target}'")
        orphans = (
            report_orphans
            if report_orphans is not None
            else target == project.base_language
        )
        return import_locale_payload(
            db,
            project,
            {target: data},
            dry_run=dry_run,
            status=status,
            module_id=target_module_id,
            tags=tags,
            report_orphans=orphans,
            full_diff=full_diff,
        )

    if any(not isinstance(value, str) for value in data.values()):
        raise HTTPException(
            status_code=400,
            detail=(
                "JSON import values must be strings "
                "(nested objects and arrays are not supported)"
            ),
        )

    raise HTTPException(status_code=400, detail="Unrecognized JSON import shape")
