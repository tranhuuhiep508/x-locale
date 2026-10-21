"""Stage-aware JSON export/import (Excel stays in app.excel)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from app.helpers import content_hash, export_key, reject_nul, validate_module_slug
from app.models import Module, Project, StringEntry, Tag, Translation, TranslationStatus
from app.schemas import ImportResult, SyncStateOut
from app.services.catalog import owned_module, require_module_in_project
from app.services.import_bulk import ImportRow, import_rows
from app.services.key_policy import ambiguous_key

CLI_UNASSIGNED = "_unassigned"


def load_export_entries(db: Session, project_id) -> list[StringEntry]:
    return (
        db.query(StringEntry)
        .options(
            joinedload(StringEntry.translations),
            joinedload(StringEntry.module),
            joinedload(StringEntry.published_module),
            selectinload(StringEntry.tags),
        )
        .filter(StringEntry.project_id == project_id)
        .order_by(StringEntry.key)
        .all()
    )


@dataclass(slots=True)
class _ExportSlug:
    slug: str


@dataclass(slots=True)
class _ExportTranslation:
    locale: str
    value: str
    published_value: str | None


@dataclass(slots=True)
class _ExportRow:
    """Columns the JSON export builders read. Not an ORM instance."""

    key: str
    source_text: str
    status: TranslationStatus
    published_key: str | None
    published_source_text: str | None
    pending_delete: bool
    deleted_at: Any
    module: _ExportSlug | None
    published_module: _ExportSlug | None
    translations: list[_ExportTranslation]


def load_export_rows(db: Session, project_id, locales: list[str]) -> list[_ExportRow]:
    """Load export content in one statement so concurrent publishes cannot mix snapshots.

    ``locales`` are the target locales whose translation rows are needed.
    Pass an empty list to skip translations (sync-state, base-locale export).
    """
    module = aliased(Module)
    published_module = aliased(Module)
    statement = (
        select(
            StringEntry.id,
            StringEntry.key,
            StringEntry.source_text,
            StringEntry.status,
            StringEntry.published_key,
            StringEntry.published_source_text,
            StringEntry.pending_delete,
            StringEntry.deleted_at,
            module.slug.label("module_slug"),
            published_module.slug.label("published_module_slug"),
        )
        .select_from(StringEntry)
        .outerjoin(
            module,
            (module.id == StringEntry.module_id) & (module.project_id == project_id),
        )
        .outerjoin(
            published_module,
            (published_module.id == StringEntry.published_module_id)
            & (published_module.project_id == project_id),
        )
        .where(StringEntry.project_id == project_id)
        .order_by(StringEntry.key)
    )
    if locales:
        statement = statement.add_columns(
            Translation.locale,
            Translation.value,
            Translation.published_value,
        ).outerjoin(
            Translation,
            (Translation.string_id == StringEntry.id) & Translation.locale.in_(locales),
        )

    rows: dict[Any, _ExportRow] = {}
    for row in db.execute(statement):
        if row.id not in rows:
            status = row.status
            if not isinstance(status, TranslationStatus):
                status = TranslationStatus(status)
            rows[row.id] = _ExportRow(
                key=row.key,
                source_text=row.source_text,
                status=status,
                published_key=row.published_key,
                published_source_text=row.published_source_text,
                pending_delete=bool(row.pending_delete),
                deleted_at=row.deleted_at,
                module=_ExportSlug(row.module_slug) if row.module_slug is not None else None,
                published_module=(
                    _ExportSlug(row.published_module_slug)
                    if row.published_module_slug is not None
                    else None
                ),
                translations=[],
            )
        if locales and row.locale is not None:
            rows[row.id].translations.append(
                _ExportTranslation(
                    locale=row.locale,
                    value=row.value or "",
                    published_value=row.published_value,
                )
            )
    return list(rows.values())


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
    # Existing projects may also include their base language in the target list.
    return list(dict.fromkeys([project.base_language, *project.target_languages]))


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


def check_export_keys(project: Project, entries, stage: str, *, modular: bool) -> None:
    seen = set()
    for entry in entries:
        if entry.deleted_at is not None:
            continue
        if stage == "public":
            if entry.status != TranslationStatus.public:
                continue
            module = entry.published_module
        else:
            if entry.pending_delete:
                continue
            module = entry.module
        module = _scoped_export_module(project.id, module) if modular else None
        identity = (module.slug if module else None, export_key(entry, published=stage == "public"))
        if identity in seen:
            raise ambiguous_key(identity[1], export=True)
        seen.add(identity)


def build_flat_export(
    project: Project,
    entries: list[StringEntry],
    stage: str,
    locale: str | None = None,
) -> dict[str, dict[str, str]]:
    check_export_keys(project, entries, stage, modular=False)
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


def _scoped_export_module(project_id, module: Module | _ExportSlug | None):
    """Keep a module slug only when it belongs to this project.

    JSON export rows carry a slug already loaded for the project. ORM modules
    still need the same ownership check as string serialization.
    """
    if isinstance(module, Module):
        return owned_module(project_id, module)
    return module


def build_modular_export(
    project: Project,
    entries: list[StringEntry],
    stage: str,
    locale: str | None = None,
) -> dict[str, Any]:
    check_export_keys(project, entries, stage, modular=True)
    locales = resolve_export_locales(project, locale)
    modules: dict[str, dict[str, dict[str, str]]] = {}
    unassigned: dict[str, dict[str, str]] = {loc: {} for loc in locales}

    for entry in entries:
        if entry.deleted_at is not None:
            continue
        if stage == "public":
            if entry.status != TranslationStatus.public:
                continue
            module = _scoped_export_module(project.id, entry.published_module)
            key = entry.published_key or entry.key
        else:
            if entry.pending_delete:
                continue
            module = _scoped_export_module(project.id, entry.module)
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
    if layout == "flat":
        # Working identities are also needed for pending deletes and tombstones.
        seen_live = set()
        for entry in entries:
            if entry.deleted_at is None:
                if entry.key in seen_live:
                    raise ambiguous_key(entry.key, export=True)
                seen_live.add(entry.key)
        check_export_keys(project, entries, stage, modular=False)
    pending_remove: list[str] = []
    tombstones: list[str] = []
    seen_pending: set[str] = set()
    seen_tombstones: set[str] = set()
    scoped_keys = project.allow_duplicate_keys and layout == "modular"
    live_keys = {
        _cli_identity(entry, layout) if scoped_keys else entry.key
        for entry in entries if entry.deleted_at is None
    }
    for entry in entries:
        label = _cli_identity(entry, layout, published=False)
        if entry.deleted_at is not None:
            identity = label if scoped_keys else entry.key
            if identity not in live_keys and label not in seen_tombstones:
                tombstones.append(label)
                seen_tombstones.add(label)
        elif entry.pending_delete:
            if label not in seen_pending:
                pending_remove.append(label)
                seen_pending.add(label)
    return SyncStateOut(
        allow_duplicate_keys=project.allow_duplicate_keys,
        stage=stage,
        layout=layout,
        base_language=project.base_language,
        locales=project_locales(project),
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
    return require_module_in_project(db, project.id, module_id)


def resolve_json_import_tags(
    db: Session, project: Project, tag_ids: list[UUID] | None
) -> list[Tag]:
    """Validate optional JSON import tags. Unknown ids are rejected."""
    if not tag_ids:
        return []
    unique_ids = list(dict.fromkeys(tag_ids))
    tags = db.query(Tag).filter(Tag.project_id == project.id, Tag.id.in_(unique_ids)).all()
    if len(tags) != len(unique_ids):
        raise HTTPException(status_code=400, detail="Unknown tag")
    by_id = {tag.id: tag for tag in tags}
    return [by_id[tid] for tid in unique_ids]


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
    partial: bool = False,
    reject_deleted: bool = False,
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
        partial=partial,
        reject_deleted=reject_deleted,
    )


def _json_rows(project, locale_maps, *, module=None, scoped=False, label=None, tags=()):
    if not isinstance(locale_maps, dict) or any(
        not _is_str_map(mapping) for mapping in locale_maps.values()
    ):
        field = (
            f"Module '{label}'"
            if label is not None
            else "Unassigned strings"
            if scoped
            else "Locale maps"
        )
        raise HTTPException(
            400, f"{field} must map locale codes to objects containing string keys and values"
        )
    for locale, mapping in locale_maps.items():
        reject_nul(locale, field="locale")
        for key, value in mapping.items():
            reject_nul(key, field="key", key=key)
            reject_nul(value, field=f"translation value ({locale})", key=key)
    maps = _known_locale_maps(project, locale_maps)
    return [
        ImportRow(
            key=key,
            values={locale: mapping[key] for locale, mapping in maps.items() if key in mapping},
            module=module,
            scoped=scoped,
            label=f"{label}/{key}" if label is not None else None,
            tag_ids=tuple(tag.id for tag in tags),
        )
        for key in _union_keys(maps)
    ]


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
    partial: bool = False,
    reject_deleted: bool = False,
) -> ImportResult:
    return import_rows(
        db,
        project,
        _json_rows(
            project, locale_maps, module=module_id, scoped=module_id is not None, tags=tags or ()
        ),
        groups=[(module_id, None, module_id is not None)],
        dry_run=dry_run,
        status=status,
        report_orphans=report_orphans,
        partial=partial,
        reject_deleted=reject_deleted,
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
    report_orphans: bool = True,
    partial: bool = False,
    reject_deleted: bool = False,
) -> ImportResult:
    rows, groups = [], []
    for slug, maps in modules.items():
        reject_nul(slug, field="module slug")
        try:
            module = validate_module_slug(slug)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        groups.append((module, slug, True))
        rows.extend(
            _json_rows(project, maps, module=module, scoped=True, label=slug, tags=tags or ())
        )
    if unassigned is not None:
        groups.append((None, None, True))
        rows.extend(_json_rows(project, unassigned, scoped=True, tags=tags or ()))
    return import_rows(
        db,
        project,
        rows,
        groups=groups,
        dry_run=dry_run,
        status=status,
        report_orphans=report_orphans,
        partial=partial,
        reject_deleted=reject_deleted,
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
    partial: bool = False,
    reject_deleted: bool = False,
) -> ImportResult:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="JSON import must be an object")

    target_module_id = resolve_json_import_module(db, project, module_id)
    tags = resolve_json_import_tags(db, project, tag_ids)

    modules = data.get("modules")
    if isinstance(modules, dict) and (modules or "unassigned" in data):
        # Modular export: { modules: { slug: { locale: { key: value } } }, unassigned: {...} }
        orphans = False if partial else True if report_orphans is None else report_orphans
        return import_modular_payload(
            db,
            project,
            modules,
            data.get("unassigned"),
            dry_run=dry_run,
            status=status,
            tags=tags,
            report_orphans=orphans,
            partial=partial,
            reject_deleted=reject_deleted,
        )

    strings = data.get("strings")
    if _is_str_map(strings):
        orphans = False if partial else True if report_orphans is None else report_orphans
        return import_flat_strings(
            db,
            project,
            strings,
            dry_run=dry_run,
            status=status,
            module_id=target_module_id,
            tags=tags,
            report_orphans=orphans,
            partial=partial,
            reject_deleted=reject_deleted,
        )

    if _is_locale_maps(data) and set(data).issubset(project_locales(project)):
        # Exported `{ locale: { key: value } }` — import every locale in the file.
        orphans = False if partial else True if report_orphans is None else report_orphans
        return import_locale_payload(
            db,
            project,
            data,
            dry_run=dry_run,
            status=status,
            module_id=target_module_id,
            tags=tags,
            report_orphans=orphans,
            partial=partial,
            reject_deleted=reject_deleted,
        )

    if _is_str_map(data):
        target = locale or project.base_language
        if target not in project_locales(project):
            raise HTTPException(status_code=400, detail=f"Unknown locale '{target}'")
        orphans = (
            False
            if partial
            else report_orphans
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
            partial=partial,
            reject_deleted=reject_deleted,
        )

    if any(not isinstance(value, str) for value in data.values()):
        raise HTTPException(
            status_code=400,
            detail=(
                "JSON import values must be strings (nested objects and arrays are not supported)"
            ),
        )

    raise HTTPException(status_code=400, detail="Unrecognized JSON import shape")
