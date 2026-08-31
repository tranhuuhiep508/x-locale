"""Excel import/export via openpyxl."""

from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook, load_workbook
from sqlalchemy.orm import Session

from app.models import Module, Project, StringEntry, Tag, Translation, TranslationStatus
from app.schemas import ImportDiff, ImportResult
from app.services.strings import promote_string, restore_string


def build_workbook(
    project: Project,
    entries: list[StringEntry],
    stage: str,
    locale: str | None = None,
) -> bytes:
    wb = Workbook()
    # Remove default sheet
    default = wb.active
    wb.remove(default)

    locales = [project.base_language, *project.target_languages]
    if locale:
        if locale not in locales:
            raise ValueError(f"Unknown locale '{locale}'")
        locales = [locale]
    by_module: dict[str | None, list[StringEntry]] = {}
    for e in entries:
        if stage == "public":
            slug = e.published_module.slug if e.published_module else None
        else:
            slug = e.module.slug if e.module else None
        by_module.setdefault(slug, []).append(e)

    # Module sheets
    for slug in sorted(k for k in by_module if k is not None):
        _write_sheet(wb, slug, by_module[slug], locales, project, stage)

    # Unassigned
    if None in by_module or not by_module:
        _write_sheet(wb, "_unassigned", by_module.get(None, []), locales, project, stage)

    # Meta sheet (hidden)
    meta = wb.create_sheet("_meta")
    meta.append(["key", "value"])
    meta.append(["project_id", str(project.id)])
    meta.append(["project_slug", project.slug])
    meta.append(["base_language", project.base_language])
    meta.append(["stage", stage])
    meta.append(["target_languages", ",".join(project.target_languages)])
    meta.sheet_state = "hidden"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _write_sheet(
    wb: Workbook,
    name: str,
    entries: list[StringEntry],
    locales: list[str],
    project: Project,
    stage: str,
) -> None:
    ws = wb.create_sheet(name[:31])  # Excel sheet name limit
    headers = ["key", "description", "tags", *locales]
    ws.append(headers)

    def _row_key(entry: StringEntry) -> str:
        if stage == "public":
            return entry.published_key or entry.key
        return entry.key

    for entry in sorted(entries, key=_row_key):
        if entry.deleted_at is not None:
            continue
        if stage == "public":
            if entry.status != TranslationStatus.public:
                continue
            row_key = entry.published_key or entry.key
            source = (
                entry.published_source_text
                if entry.published_source_text is not None
                else entry.source_text
            )
        else:
            if entry.pending_delete:
                continue
            row_key = entry.key
            source = entry.source_text
        tags = ",".join(t.name for t in (entry.tags or []))
        row: list[Any] = [row_key, entry.description or "", tags]
        for locale in locales:
            if locale == project.base_language:
                row.append(source)
            else:
                t = next((x for x in entry.translations if x.locale == locale), None)
                if stage == "public":
                    if t is not None and t.published_value is not None:
                        row.append(t.published_value)
                    else:
                        row.append("")
                else:
                    row.append(t.value if t else "")
        ws.append(row)


def import_workbook(
    db: Session,
    project: Project,
    raw: bytes,
    *,
    dry_run: bool = False,
    status: TranslationStatus = TranslationStatus.draft,
) -> ImportResult:
    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)

    # Validate meta if present
    if "_meta" in wb.sheetnames:
        meta_ws = wb["_meta"]
        meta = {row[0]: row[1] for row in meta_ws.iter_rows(min_row=2, values_only=True) if row[0]}
        if meta.get("project_id") and str(meta["project_id"]) != str(project.id):
            # Soft warning — allow if slug matches; hard fail otherwise
            if meta.get("project_slug") and meta["project_slug"] != project.slug:
                raise ValueError(
                    f"Workbook belongs to project {meta.get('project_slug')}, not {project.slug}"
                )

    create_keys: list[str] = []
    update_keys: list[str] = []
    created = 0
    updated = 0
    total = 0

    for sheet_name in wb.sheetnames:
        if sheet_name == "_meta":
            continue
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        headers = [str(h).strip() if h else "" for h in rows[0]]
        try:
            key_idx = headers.index("key")
        except ValueError:
            continue
        desc_idx = headers.index("description") if "description" in headers else None
        tags_idx = headers.index("tags") if "tags" in headers else None

        module_id = None
        if sheet_name != "_unassigned":
            mod = (
                db.query(Module)
                .filter(Module.project_id == project.id, Module.slug == sheet_name)
                .first()
            )
            if not mod and not dry_run:
                mod = Module(
                    project_id=project.id,
                    slug=sheet_name,
                    name=sheet_name.replace("-", " ").replace("_", " ").title(),
                )
                db.add(mod)
                db.flush()
            module_id = mod.id if mod else None

        locale_cols = {
            h: i
            for i, h in enumerate(headers)
            if h and h not in ("key", "description", "tags")
        }

        for row in rows[1:]:
            if not row or row[key_idx] is None:
                continue
            key = str(row[key_idx]).strip()
            if not key:
                continue
            total += 1
            description = str(row[desc_idx]).strip() if desc_idx is not None and row[desc_idx] else None
            tag_names = []
            if tags_idx is not None and row[tags_idx]:
                tag_names = [t.strip() for t in str(row[tags_idx]).split(",") if t.strip()]

            source_text = ""
            if project.base_language in locale_cols:
                val = row[locale_cols[project.base_language]]
                source_text = str(val) if val is not None else ""
            if not source_text:
                source_text = key  # fallback

            revived = False
            entry = (
                db.query(StringEntry)
                .filter(
                    StringEntry.project_id == project.id,
                    StringEntry.module_id == module_id,
                    StringEntry.key == key,
                    StringEntry.deleted_at.is_(None),
                )
                .first()
            )
            if entry is None:
                entry = (
                    db.query(StringEntry)
                    .filter(
                        StringEntry.project_id == project.id,
                        StringEntry.module_id == module_id,
                        StringEntry.key == key,
                    )
                    .first()
                )
                if entry is not None:
                    revived = True
                    if not dry_run:
                        restore_string(entry)

            label = f"{sheet_name}.{key}" if sheet_name != "_unassigned" else key
            created_this_row = False
            if entry:
                if revived or entry.source_text != source_text or (
                    description and entry.description != description
                ):
                    update_keys.append(label)
                    if not dry_run:
                        entry.source_text = source_text
                        if description is not None:
                            entry.description = description
                        updated += 1
            else:
                create_keys.append(label)
                created_this_row = True
                if not dry_run:
                    entry = StringEntry(
                        project_id=project.id,
                        module_id=module_id,
                        key=key,
                        source_text=source_text,
                        description=description,
                        status=TranslationStatus.draft,
                    )
                    db.add(entry)
                    db.flush()
                    created += 1

            if dry_run or entry is None:
                continue

            # Tags
            if tag_names:
                tags = []
                for tname in tag_names:
                    tag = (
                        db.query(Tag)
                        .filter(Tag.project_id == project.id, Tag.name == tname)
                        .first()
                    )
                    if not tag:
                        tag = Tag(project_id=project.id, name=tname)
                        db.add(tag)
                        db.flush()
                    tags.append(tag)
                entry.tags = tags

            # Translations
            for locale, idx in locale_cols.items():
                if locale == project.base_language:
                    continue
                val = row[idx]
                value = str(val) if val is not None else ""
                t = next((x for x in entry.translations if x.locale == locale), None)
                if t is None:
                    t = Translation(
                        string_id=entry.id,
                        locale=locale,
                        value=value,
                    )
                    db.add(t)
                    entry.translations.append(t)
                else:
                    if value != t.value:
                        t.value = value

            if created_this_row and status == TranslationStatus.public:
                promote_string(entry)

    diff = ImportDiff(
        create=create_keys,
        update=update_keys,
        orphan=[],
        create_count=len(create_keys),
        update_count=len(update_keys),
        orphan_count=0,
    )
    return ImportResult(
        created=0 if dry_run else created,
        updated=0 if dry_run else updated,
        total=total,
        dry_run=dry_run,
        diff=diff,
    )
