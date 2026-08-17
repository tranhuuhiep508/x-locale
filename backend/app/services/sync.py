"""Stage-aware JSON export/import (Excel stays in app.excel)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.helpers import content_hash, export_key
from app.models import Module, Project, StringEntry, Translation, TranslationStatus
from app.schemas import ImportDiff, ImportResult


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


def build_flat_export(
    project: Project, entries: list[StringEntry], stage: str
) -> dict[str, dict[str, str]]:
    locales = [project.base_language, *project.target_languages]
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
    project: Project, entries: list[StringEntry], stage: str
) -> dict[str, Any]:
    locales = [project.base_language, *project.target_languages]
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


def import_flat_strings(
    db: Session,
    project: Project,
    strings: dict[str, str],
    *,
    dry_run: bool,
) -> ImportResult:
    create_keys: list[str] = []
    update_keys: list[str] = []
    all_entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.module))
        .filter(StringEntry.project_id == project.id)
        .all()
    )
    by_export_key: dict[str, StringEntry] = {}
    for entry in all_entries:
        by_export_key[export_key(entry, "flat")] = entry
        if entry.module_id is None:
            by_export_key[entry.key] = entry

    for key, source_text in strings.items():
        entry = by_export_key.get(key)
        if entry:
            if entry.source_text != source_text:
                update_keys.append(key)
                if not dry_run:
                    entry.source_text = source_text
        else:
            create_keys.append(key)
            if not dry_run:
                module_id = None
                actual_key = key
                if "." in key:
                    prefix, rest = key.split(".", 1)
                    mod = (
                        db.query(Module)
                        .filter(Module.project_id == project.id, Module.slug == prefix)
                        .first()
                    )
                    if mod:
                        module_id = mod.id
                        actual_key = rest
                entry = StringEntry(
                    project_id=project.id,
                    module_id=module_id,
                    key=actual_key,
                    source_text=source_text,
                )
                db.add(entry)
                db.flush()
                for locale in project.target_languages:
                    db.add(
                        Translation(
                            string_id=entry.id,
                            locale=locale,
                            value="",
                        )
                    )

    orphan_keys = [k for k in by_export_key if k not in strings]
    diff = ImportDiff(
        create=create_keys,
        update=update_keys,
        orphan=orphan_keys,
        create_count=len(create_keys),
        update_count=len(update_keys),
        orphan_count=len(orphan_keys),
    )
    if dry_run:
        return ImportResult(
            created=0,
            updated=0,
            total=len(strings),
            dry_run=True,
            diff=diff,
        )
    return ImportResult(
        created=len(create_keys),
        updated=len(update_keys),
        total=len(strings),
        dry_run=False,
        diff=diff,
    )
