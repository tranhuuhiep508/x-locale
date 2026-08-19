"""Stage-aware JSON export/import (Excel stays in app.excel)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.helpers import content_hash, export_key
from app.models import Module, Project, StringEntry, TranslationStatus
from app.schemas import ImportDiff, ImportResult
from app.services.strings import apply_translation_values, ensure_translation_rows


def load_export_entries(db: Session, project_id) -> list[StringEntry]:
    return (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.module),
            joinedload(StringEntry.tags),
        )
        .filter(StringEntry.project_id == project_id)
        .order_by(StringEntry.key)
        .all()
    )


def translation_value(
    entry: StringEntry,
    locale: str,
    project: Project,
    stage: str,
) -> str | None:
    """Return value for locale given stage, or None to omit."""
    if locale == project.base_language:
        return entry.source_text

    if stage == "public" and entry.status != TranslationStatus.public:
        return None

    translation = next((t for t in entry.translations if t.locale == locale), None)
    if stage == "public":
        if translation:
            return translation.value
        return ""
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
        if stage == "public" and entry.status != TranslationStatus.public:
            continue
        key = export_key(entry, "flat")
        for locale in locales:
            val = translation_value(entry, locale, project, stage)
            if val is not None:
                result[locale][key] = val
            elif locale == project.base_language:
                result[locale][key] = entry.source_text
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
        if stage == "public" and entry.status != TranslationStatus.public:
            continue
        bucket_key = entry.module.slug if entry.module else None
        if bucket_key:
            if bucket_key not in modules:
                modules[bucket_key] = {loc: {} for loc in locales}
            target = modules[bucket_key]
        else:
            target = unassigned

        for locale in locales:
            val = translation_value(entry, locale, project, stage)
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


def _resolve_prefixed_key(
    db: Session, project: Project, key: str
) -> tuple[UUID | None, str]:
    if "." not in key:
        return None, key
    prefix, rest = key.split(".", 1)
    mod = (
        db.query(Module)
        .filter(Module.project_id == project.id, Module.slug == prefix)
        .first()
    )
    if not mod:
        return None, key
    return mod.id, rest


class _ImportIndex:
    def __init__(self, entries: list[StringEntry]) -> None:
        self.by_export_key: dict[str, StringEntry] = {}
        self.by_module_key: dict[tuple[UUID | None, str], StringEntry] = {}
        for entry in entries:
            self.add(entry)

    def add(self, entry: StringEntry) -> None:
        label = export_key(entry, "flat")
        self.by_export_key[label] = entry
        self.by_module_key[(entry.module_id, entry.key)] = entry
        if entry.module_id is None:
            self.by_export_key[entry.key] = entry

    def lookup(
        self, key: str, *, prefixed: bool, module_id: UUID | None
    ) -> StringEntry | None:
        if prefixed:
            return self.by_export_key.get(key)
        return self.by_module_key.get((module_id, key))


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


def _upsert_imported_string(
    db: Session,
    project: Project,
    index: _ImportIndex,
    key: str,
    values: dict[str, str],
    *,
    dry_run: bool,
    status: TranslationStatus,
    prefixed: bool,
    module_id: UUID | None,
) -> str:
    """Return 'create', 'update', or 'unchanged'."""
    entry = index.lookup(key, prefixed=prefixed, module_id=module_id)
    if entry is None:
        if not dry_run:
            resolved_module_id = module_id
            actual_key = key
            if prefixed:
                resolved_module_id, actual_key = _resolve_prefixed_key(db, project, key)
            source_text = values.get(project.base_language, "") or key
            entry = StringEntry(
                project_id=project.id,
                module_id=resolved_module_id,
                key=actual_key,
                source_text=source_text,
                status=status,
            )
            db.add(entry)
            db.flush()
            ensure_translation_rows(db, entry, project)
            apply_translation_values(
                db,
                entry,
                {loc: val for loc, val in values.items() if loc != project.base_language},
            )
            index.add(entry)
        return "create"

    if not _values_changed(entry, project, values):
        return "unchanged"

    if not dry_run:
        if project.base_language in values:
            entry.source_text = values[project.base_language]
        apply_translation_values(
            db,
            entry,
            {loc: val for loc, val in values.items() if loc != project.base_language},
        )
    return "update"


def _import_locale_maps(
    db: Session,
    project: Project,
    locale_maps: dict[str, dict[str, str]],
    *,
    dry_run: bool,
    status: TranslationStatus,
    prefixed: bool,
    module_id: UUID | None,
    report_orphans: bool,
    index: _ImportIndex,
) -> tuple[list[str], list[str], set[str], int]:
    create_keys: list[str] = []
    update_keys: list[str] = []
    seen: set[str] = set()
    total = 0
    maps = _known_locale_maps(project, locale_maps)
    for key in _union_keys(maps):
        values = {loc: mapping[key] for loc, mapping in maps.items() if key in mapping}
        if not values:
            continue
        total += 1
        seen.add(key)
        action = _upsert_imported_string(
            db,
            project,
            index,
            key,
            values,
            dry_run=dry_run,
            status=status,
            prefixed=prefixed,
            module_id=module_id,
        )
        if action == "create":
            create_keys.append(key)
        elif action == "update":
            update_keys.append(key)
    orphan_keys: set[str] = set()
    if report_orphans:
        if prefixed:
            orphan_keys = {k for k in index.by_export_key if k not in seen}
        else:
            orphan_keys = {
                k
                for (mid, k) in index.by_module_key
                if mid == module_id and k not in seen
            }
    return create_keys, update_keys, orphan_keys, total


def _result(
    *,
    create_keys: list[str],
    update_keys: list[str],
    orphan_keys: list[str],
    total: int,
    dry_run: bool,
) -> ImportResult:
    diff = ImportDiff(
        create=create_keys,
        update=update_keys,
        orphan=orphan_keys,
        create_count=len(create_keys),
        update_count=len(update_keys),
        orphan_count=len(orphan_keys),
    )
    return ImportResult(
        created=0 if dry_run else len(create_keys),
        updated=0 if dry_run else len(update_keys),
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
) -> ImportResult:
    """CLI / source-locale import: `{ key: source_text }` with optional `module.key` prefixes."""
    return import_locale_payload(
        db,
        project,
        {project.base_language: strings},
        dry_run=dry_run,
        status=status,
        prefixed=True,
        report_orphans=True,
    )


def import_locale_payload(
    db: Session,
    project: Project,
    locale_maps: dict[str, dict[str, str]],
    *,
    dry_run: bool,
    status: TranslationStatus = TranslationStatus.draft,
    prefixed: bool = True,
    module_id: UUID | None = None,
    report_orphans: bool = True,
) -> ImportResult:
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.module), joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id)
        .all()
    )
    index = _ImportIndex(entries)
    create_keys, update_keys, orphan_keys, total = _import_locale_maps(
        db,
        project,
        locale_maps,
        dry_run=dry_run,
        status=status,
        prefixed=prefixed,
        module_id=module_id,
        report_orphans=report_orphans,
        index=index,
    )
    return _result(
        create_keys=create_keys,
        update_keys=update_keys,
        orphan_keys=sorted(orphan_keys),
        total=total,
        dry_run=dry_run,
    )


def import_modular_payload(
    db: Session,
    project: Project,
    modules: dict[str, dict[str, dict[str, str]]],
    unassigned: dict[str, dict[str, str]] | None,
    *,
    dry_run: bool,
    status: TranslationStatus = TranslationStatus.draft,
) -> ImportResult:
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.module), joinedload(StringEntry.translations))
        .filter(StringEntry.project_id == project.id)
        .all()
    )
    index = _ImportIndex(entries)
    create_keys: list[str] = []
    update_keys: list[str] = []
    orphan_keys: set[str] = set()
    total = 0

    for slug, locale_maps in modules.items():
        if not isinstance(locale_maps, dict):
            continue
        mod = _get_or_create_module(db, project, slug, dry_run=dry_run)
        created, updated, orphans, count = _import_locale_maps(
            db,
            project,
            locale_maps,
            dry_run=dry_run,
            status=status,
            prefixed=False,
            module_id=mod.id if mod else None,
            report_orphans=True,
            index=index,
        )
        create_keys.extend(f"{slug}.{k}" for k in created)
        update_keys.extend(f"{slug}.{k}" for k in updated)
        orphan_keys.update(f"{slug}.{k}" for k in orphans)
        total += count

    if unassigned and _is_locale_maps(unassigned):
        created, updated, orphans, count = _import_locale_maps(
            db,
            project,
            unassigned,
            dry_run=dry_run,
            status=status,
            prefixed=False,
            module_id=None,
            report_orphans=True,
            index=index,
        )
        create_keys.extend(created)
        update_keys.extend(updated)
        orphan_keys.update(orphans)
        total += count

    return _result(
        create_keys=create_keys,
        update_keys=update_keys,
        orphan_keys=sorted(orphan_keys),
        total=total,
        dry_run=dry_run,
    )


def import_json_data(
    db: Session,
    project: Project,
    data: Any,
    *,
    dry_run: bool,
    locale: str | None = None,
    status: TranslationStatus = TranslationStatus.draft,
) -> ImportResult:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="JSON import must be an object")

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
            )

    strings = data.get("strings")
    if _is_str_map(strings):
        return import_flat_strings(db, project, strings, dry_run=dry_run, status=status)

    if _is_locale_maps(data) and set(data).issubset(project_locales(project)):
        # Exported `{ locale: { key: value } }` — import every locale in the file.
        return import_locale_payload(
            db,
            project,
            data,
            dry_run=dry_run,
            status=status,
            prefixed=True,
            report_orphans=True,
        )

    if _is_str_map(data):
        target = locale or project.base_language
        if target not in project_locales(project):
            raise HTTPException(status_code=400, detail=f"Unknown locale '{target}'")
        return import_locale_payload(
            db,
            project,
            {target: data},
            dry_run=dry_run,
            status=status,
            prefixed=True,
            report_orphans=target == project.base_language,
        )

    raise HTTPException(status_code=400, detail="Unrecognized JSON import shape")
