"""Excel import/export via openpyxl."""

from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook, load_workbook
from sqlalchemy.orm import Session

from app.helpers import (
    ensure_max_length,
    key_preview,
    reject_nul,
    validate_locale_code,
    validate_module_slug,
)
from app.limits import KEY_MAX_LENGTH, TAG_NAME_MAX_LENGTH
from app.models import (
    Project,
    ProjectLayout,
    StringEntry,
    TranslationStatus,
)
from app.schemas import ImportResult
from app.services.catalog import owned_module
from app.services.import_bulk import ImportRow, import_rows
from app.services.sync import check_export_keys

UNASSIGNED_SHEET = "_unassigned"
FLAT_SHEET = "strings"

DEMO_IMPORT_ROWS: dict[str, list[tuple[str, str]]] = {
    "auth": [("auth.email", "Địa chỉ email"), ("auth.sign_in", "Đăng nhập")],
    "common": [("common.save", "Lưu"), ("common.cancel", "Hủy")],
    UNASSIGNED_SHEET: [("hello", "Xin chào")],
}


def _layout_value(project: Project) -> str:
    layout = project.layout
    return layout.value if hasattr(layout, "value") else str(layout)


def _is_modular(project: Project) -> bool:
    return _layout_value(project) == ProjectLayout.modular.value


def _export_locales(project: Project, locale: str | None) -> list[str]:
    locales = [project.base_language, *project.target_languages]
    if not locale:
        return locales
    if locale not in locales:
        raise ValueError(f"Unknown locale '{locale}'")
    return [locale]


def build_workbook(
    project: Project,
    entries: list[StringEntry],
    stage: str,
    locale: str | None = None,
) -> bytes:
    wb = Workbook()
    default = wb.active
    wb.remove(default)

    locales = _export_locales(project, locale)
    check_export_keys(project, entries, stage, modular=_is_modular(project))
    if _is_modular(project):
        by_module: dict[str | None, list[StringEntry]] = {}
        for e in entries:
            module = e.published_module if stage == "public" else e.module
            owned = owned_module(project.id, module)
            slug = owned.slug if owned else None
            by_module.setdefault(slug, []).append(e)
        for slug in sorted(k for k in by_module if k is not None):
            _write_sheet(wb, slug, by_module[slug], locales, project, stage)
        if None in by_module or not by_module:
            _write_sheet(wb, UNASSIGNED_SHEET, by_module.get(None, []), locales, project, stage)
    else:
        _write_sheet(wb, FLAT_SHEET, entries, locales, project, stage)

    _write_meta_sheet(wb, project, stage)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_template_workbook(project: Project) -> bytes:
    """Demo workbook matching the project's layout so users can see the import format."""
    wb = Workbook()
    default = wb.active
    wb.remove(default)
    locales = [project.base_language, *project.target_languages]
    if _is_modular(project):
        for slug, rows in DEMO_IMPORT_ROWS.items():
            _write_template_sheet(wb, slug, rows, locales, project.base_language)
    else:
        flat_rows = [row for rows in DEMO_IMPORT_ROWS.values() for row in rows]
        _write_template_sheet(wb, FLAT_SHEET, flat_rows, locales, project.base_language)
    _write_meta_sheet(wb, project, "draft")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _write_meta_sheet(wb: Workbook, project: Project, stage: str) -> None:
    meta = wb.create_sheet("_meta")
    meta.append(["key", "value"])
    meta.append(["project_id", str(project.id)])
    meta.append(["project_slug", project.slug])
    meta.append(["base_language", project.base_language])
    meta.append(["stage", stage])
    meta.append(["target_languages", ",".join(project.target_languages)])
    meta.append(["layout", _layout_value(project)])
    meta.sheet_state = "hidden"


def _write_template_sheet(
    wb: Workbook,
    name: str,
    rows: list[tuple[str, str]],
    locales: list[str],
    base_language: str,
) -> None:
    ws = wb.create_sheet(name[:31])
    ws.append(["key", "description", "tags", *locales])
    for key, source in rows:
        row: list[Any] = [key, "", ""]
        for locale in locales:
            row.append(source if locale == base_language else "")
        ws.append(row)


DANGEROUS_PREFIXES = ("=", "+", "-", "@")


def _sanitize_cell_value(val: Any) -> Any:
    if val is None:
        return ""
    s = str(val)
    if s.startswith(DANGEROUS_PREFIXES):
        return f"'{s}"
    return s


def _desanitize_cell_value(val: Any) -> str:
    if val is None:
        return ""
    s = str(val)
    if s.startswith("'") and len(s) > 1 and s[1] in DANGEROUS_PREFIXES:
        return s[1:]
    return s


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
        tags = ",".join(
            tag.name for tag in sorted(entry.tags or [], key=lambda tag: (tag.name, str(tag.id)))
        )
        row: list[Any] = [
            _sanitize_cell_value(row_key),
            _sanitize_cell_value(entry.description),
            _sanitize_cell_value(tags),
        ]
        for locale in locales:
            if locale == project.base_language:
                row.append(_sanitize_cell_value(source))
            else:
                t = next((x for x in entry.translations if x.locale == locale), None)
                if stage == "public":
                    if t is not None and t.published_value is not None:
                        row.append(_sanitize_cell_value(t.published_value))
                    else:
                        row.append("")
                else:
                    row.append(_sanitize_cell_value(t.value if t else ""))
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
    rows, groups = [], []
    try:
        if "_meta" in wb.sheetnames:
            meta = {
                row[0]: row[1]
                for row in wb["_meta"].iter_rows(min_row=2, values_only=True)
                if row[0]
            }
            if meta.get("project_id") and str(meta["project_id"]) != str(project.id):
                if meta.get("project_slug") and meta["project_slug"] != project.slug:
                    raise ValueError(
                        f"Workbook belongs to project {meta.get('project_slug')}, not {project.slug}"
                    )
        modular = _is_modular(project)
        for sheet_name in wb.sheetnames:
            if sheet_name == "_meta":
                continue
            iterator = wb[sheet_name].iter_rows(values_only=True)
            first = next(iterator, None)
            if first is None:
                continue
            headers = [str(value).strip() if value else "" for value in first]
            if "key" not in headers:
                continue
            key_idx = headers.index("key")
            desc_idx = headers.index("description") if "description" in headers else None
            tags_idx = headers.index("tags") if "tags" in headers else None
            module = None
            if modular and sheet_name != UNASSIGNED_SHEET:
                reject_nul(sheet_name, field="module slug", context=f"Sheet {sheet_name!r}: ")
                try:
                    module = validate_module_slug(sheet_name)
                except ValueError as exc:
                    raise ValueError(f"Invalid sheet name {sheet_name!r}: {exc}") from exc
            groups.append((module, None, modular))
            locales = {}
            for index, header in enumerate(headers):
                if not header or header in {"key", "description", "tags"}:
                    continue
                reject_nul(header, field="locale", context=f"Sheet {sheet_name!r}: ")
                try:
                    locales[validate_locale_code(header)] = index
                except ValueError as exc:
                    raise ValueError(f"Invalid locale column {header!r}: {exc}") from exc
            for number, row in enumerate(iterator, start=2):
                if not row or row[key_idx] is None:
                    continue
                key = _desanitize_cell_value(row[key_idx]).strip()
                if not key:
                    continue
                context = f"Sheet {sheet_name!r} row {number}: "
                reject_nul(key, field="key", key=key, context=context)
                if len(key) > KEY_MAX_LENGTH:
                    raise ValueError(
                        f"{context}key {key_preview(key)} must be at most {KEY_MAX_LENGTH} characters"
                    )
                description = (
                    _desanitize_cell_value(row[desc_idx]).strip()
                    if desc_idx is not None and row[desc_idx]
                    else None
                ) or None
                names = ()
                if tags_idx is not None and row[tags_idx]:
                    names = tuple(
                        ensure_max_length(
                            _desanitize_cell_value(value.strip()),
                            field="tag name",
                            limit=TAG_NAME_MAX_LENGTH,
                        )
                        for value in str(row[tags_idx]).split(",")
                        if value.strip()
                    )
                values = {
                    locale: _desanitize_cell_value(row[index]) for locale, index in locales.items()
                }
                label = f"{sheet_name}/{key}" if modular and sheet_name != UNASSIGNED_SHEET else key
                rows.append(
                    ImportRow(
                        key=key,
                        values=values,
                        module=module,
                        scoped=modular,
                        label=label,
                        excel=True,
                        description=description,
                        tag_names=names,
                        context=context,
                    )
                )
        return import_rows(
            db, project, rows, groups=groups, dry_run=dry_run, status=status, report_orphans=False
        )
    finally:
        wb.close()
