"""JSON and locale-file helpers (flat and modular layouts)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from x_locale_cli.console import console
from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import (
    DEFAULT_BASE_LANGUAGE,
    UNASSIGNED_SLUG,
    Config,
    Layout,
    PulledFileReport,
    Stage,
)

# Prettier 3+ (trailingComma: "all") and some editors emit trailing commas in JSON.
_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def load_json_file(path: Path) -> Any:
    """Load JSON from *path*, tolerating trailing commas from common formatters."""
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(_TRAILING_COMMA_RE.sub(r"\1", text))
    except json.JSONDecodeError as exc:
        raise XLocaleError(
            f"Invalid JSON in {path}: {exc.msg} (line {exc.lineno}, column {exc.colno})"
        ) from exc


def parse_locale_json(data: dict[str, Any]) -> dict[str, str]:
    """Validate that all values are strings and return the same dict typed."""
    strings: dict[str, str] = {}
    for key, value in data.items():
        if not isinstance(value, str):
            raise XLocaleError(
                f"Locale JSON requires string values; got {type(value).__name__} for key {key!r}"
            )
        strings[key] = value
    return strings


def locale_json_from_strings(strings: dict[str, str]) -> dict[str, str]:
    """Return a sorted copy of *strings* suitable for writing to disk."""
    return dict(sorted(strings.items()))


def scoped_key(module_slug: str, key: str) -> str:
    """Label a modular string as ``module/key`` (folder + JSON key)."""
    return f"{module_slug}/{key}"


def string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if isinstance(v, str)}


def diff_locale_maps(
    old: dict[str, str], new: dict[str, str]
) -> tuple[list[str], list[str], list[str]]:
    added = sorted(set(new) - set(old))
    updated = sorted(k for k in set(new) & set(old) if old[k] != new[k])
    removed = sorted(set(old) - set(new))
    return added, updated, removed


def default_source_file(config: Config) -> Path:
    return config.output_path / f"{config.base_language}.json"


def resolve_push_source(config: Config, source_file: Path | None) -> Path:
    """Resolve and validate the source file path for a flat-layout push."""
    base_language = config.base_language or DEFAULT_BASE_LANGUAGE
    default_path = default_source_file(config)
    path = default_path if source_file is None else source_file

    if path.is_dir():
        raise XLocaleError(
            f"Expected a JSON file, got directory '{path}'. "
            f"Run `locale push` without arguments to push {default_path}"
        )

    if path.suffix.lower() != ".json":
        raise XLocaleError(f"Expected a JSON file, got '{path}'")

    if path.stem != base_language:
        raise XLocaleError(
            f"Cannot push translation file '{path.name}'. "
            f"Push only accepts the base language file ({base_language}.json). "
            f"Run `locale push` without arguments to use {default_path}"
        )

    if not path.exists():
        raise XLocaleError(f"File not found: {path}")

    return path


def scan_modular_base(output_dir: Path, base_language: str) -> dict[str, dict[str, str]]:
    """Scan *output_dir* for ``{module}/{base_language}.json`` files.

    Returns ``{module_slug: {key: value}}`` for every module directory that
    contains a base-language file. Directories whose names start with ``_``
    or ``.`` are skipped (e.g. ``_unassigned``, ``.x-locale``).
    """
    modules: dict[str, dict[str, str]] = {}
    if not output_dir.is_dir():
        return modules
    for subdir in sorted(output_dir.iterdir()):
        if not subdir.is_dir():
            continue
        if subdir.name.startswith("_") or subdir.name.startswith("."):
            continue
        base_file = subdir / f"{base_language}.json"
        if not base_file.exists():
            continue
        data = load_json_file(base_file)
        if not isinstance(data, dict):
            console.print(f"[yellow]Warning:[/yellow] {base_file} is not a JSON object — skipping")
            continue
        modules[subdir.name] = parse_locale_json(data)
    return modules


def load_unassigned_base(output_dir: Path, base_language: str) -> dict[str, str]:
    """Load ``_unassigned/{base_language}.json`` if present."""
    path = output_dir / UNASSIGNED_SLUG / f"{base_language}.json"
    if not path.exists():
        return {}
    data = load_json_file(path)
    if not isinstance(data, dict):
        console.print(f"[yellow]Warning:[/yellow] {path} is not a JSON object — skipping")
        return {}
    return parse_locale_json(data)


def collect_modular_local_keys(output_dir: Path, base_language: str) -> dict[str, str]:
    """Local base-language strings keyed as ``module/key`` (includes ``_unassigned``)."""
    result: dict[str, str] = {}
    for slug, strings in scan_modular_base(output_dir, base_language).items():
        for key, value in strings.items():
            result[scoped_key(slug, key)] = value
    for key, value in load_unassigned_base(output_dir, base_language).items():
        result[scoped_key(UNASSIGNED_SLUG, key)] = value
    return result


def collect_modular_remote_keys(export: dict[str, Any], base_language: str) -> dict[str, str]:
    """Remote base-language strings keyed as ``module/key`` from a modular export."""
    result: dict[str, str] = {}
    modules = export.get("modules") or {}
    if isinstance(modules, dict):
        for slug, locale_map in modules.items():
            if not isinstance(locale_map, dict):
                continue
            for key, value in string_map(locale_map.get(base_language)).items():
                result[scoped_key(str(slug), key)] = value
    unassigned = export.get("unassigned") or {}
    if isinstance(unassigned, dict):
        for key, value in string_map(unassigned.get(base_language)).items():
            result[scoped_key(UNASSIGNED_SLUG, key)] = value
    return result


def build_modular_push_body(
    modules: dict[str, dict[str, str]],
    base_language: str,
) -> dict[str, dict[str, dict[str, dict[str, str]]]]:
    """Build ``{ modules: { slug: { locale: { key: value } } } }`` for CLI push."""
    return {"modules": {slug: {base_language: strings} for slug, strings in modules.items()}}


def resolve_under_output(output_dir: Path, *parts: str) -> Path:
    """Resolve a file path and ensure it stays under output_dir."""
    for part in parts:
        if not part or part in (".", "..") or "/" in part or "\\" in part:
            raise XLocaleError(f"Unsafe path segment: {part!r}")
    root = output_dir.resolve()
    target = (root.joinpath(*parts)).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise XLocaleError(f"Refusing to write outside {root}: {target}") from exc
    return target


def write_locale_file(path: Path, strings: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(locale_json_from_strings(strings), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_old_string_map(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        existing = load_json_file(path)
    except XLocaleError:
        return {}
    if not isinstance(existing, dict):
        return {}
    return {k: v for k, v in existing.items() if isinstance(v, str)}


def write_locale_file_reported(path: Path, strings: dict[str, str]) -> PulledFileReport:
    old_strings = _read_old_string_map(path)
    new_keys, updated_keys, removed_keys = diff_locale_maps(old_strings, strings)
    write_locale_file(path, strings)
    return PulledFileReport(
        path=path,
        keys=sorted(strings),
        new_keys=new_keys,
        updated_keys=updated_keys,
        removed_keys=removed_keys,
        written=True,
    )


def _union_modular_export_locales(export: dict[str, Any]) -> list[str]:
    locales: set[str] = set()
    modules = export.get("modules")
    if isinstance(modules, dict):
        for locale_map in modules.values():
            if isinstance(locale_map, dict):
                locales.update(str(k) for k in locale_map)
    unassigned = export.get("unassigned")
    if isinstance(unassigned, dict):
        locales.update(str(k) for k in unassigned)
    manifest = export.get("manifest")
    if isinstance(manifest, dict):
        raw = manifest.get("locales")
        if isinstance(raw, list):
            locales.update(str(x) for x in raw)
    return sorted(locales)


def pull_scope_locales(config: Config, export: Any) -> list[str]:
    """Locale codes in scope ``S`` for this pull (writes and prunes).

    When ``locales`` is set, ``S`` is that list even if a code is absent from
    the export (so a removed project locale is pruned). When omitted, ``S`` is
    the locales present in the export.
    """
    allowed = config.locale_filter
    if allowed:
        return list(allowed)
    if config.layout is Layout.modular:
        if not isinstance(export, dict):
            return []
        return _union_modular_export_locales(export)
    if not isinstance(export, dict):
        return []
    return sorted(k for k, v in export.items() if isinstance(v, dict))


def _try_resolve_under_output(output_dir: Path, *parts: str) -> Path | None:
    """Resolve a path under *output_dir*, or ``None`` when it is unsafe to touch."""
    try:
        return resolve_under_output(output_dir, *parts)
    except XLocaleError:
        return None


def _owned_locale_paths(output_root: Path, layout: Layout, scope: list[str]) -> list[Path]:
    """CLI-owned locale JSON paths currently subject to prune for scope ``S``."""
    paths: list[Path] = []
    for locale in scope:
        if layout is Layout.flat:
            target = _try_resolve_under_output(output_root, f"{locale}.json")
            if target is not None:
                paths.append(target)
            continue
        unassigned = _try_resolve_under_output(output_root, UNASSIGNED_SLUG, f"{locale}.json")
        if unassigned is not None:
            paths.append(unassigned)
        if not output_root.is_dir():
            continue
        for child in sorted(output_root.iterdir()):
            if not child.is_dir() or child.is_symlink():
                continue
            if child.name.startswith(".") or child.name.startswith("_"):
                continue
            target = _try_resolve_under_output(output_root, child.name, f"{locale}.json")
            if target is not None:
                paths.append(target)
    return paths


def _prune_empty_module_dirs(output_root: Path) -> None:
    if not output_root.is_dir():
        return
    for child in sorted(output_root.iterdir()):
        if not child.is_dir() or child.is_symlink():
            continue
        if child.name.startswith("."):
            continue
        try:
            if not any(child.iterdir()):
                child.rmdir()
        except OSError:
            continue


@dataclass
class PullApplyResult:
    reports: list[PulledFileReport]
    pruned_reports: list[PulledFileReport]
    expected_paths: set[Path]
    deleted_paths: list[Path]
    manifest_written: Path | None
    manifest_deleted: bool
    base_locale_touched: bool


def apply_pull_export(
    config: Config,
    export: Any,
    *,
    output_root: Path,
    write_manifest: bool,
) -> PullApplyResult:
    """Write export payload to disk and prune in-scope owned files not in the payload."""
    scope = pull_scope_locales(config, export)
    reports: list[PulledFileReport] = []
    expected: set[Path] = set()
    base = config.base_language
    base_touched = False

    if config.layout is Layout.modular:
        if not isinstance(export, dict):
            export = {}
        modules = export.get("modules") if isinstance(export.get("modules"), dict) else {}
        unassigned = export.get("unassigned") if isinstance(export.get("unassigned"), dict) else {}
        manifest = export.get("manifest") if isinstance(export.get("manifest"), dict) else {}

        for module_slug, locale_map in modules.items():
            slug = str(module_slug)
            if not isinstance(locale_map, dict):
                continue
            for locale in scope:
                if locale not in locale_map:
                    continue
                strings = string_map(locale_map.get(locale))
                target = resolve_under_output(output_root, slug, f"{locale}.json")
                target.parent.mkdir(parents=True, exist_ok=True)
                reports.append(write_locale_file_reported(target, strings))
                expected.add(target.resolve())
                if locale == base:
                    base_touched = True

        in_scope_unassigned: dict[str, dict[str, str]] = {}
        if isinstance(unassigned, dict):
            for locale in scope:
                if locale not in unassigned:
                    continue
                in_scope_unassigned[locale] = string_map(unassigned.get(locale))
        has_unassigned_keys = any(strings for strings in in_scope_unassigned.values())
        if has_unassigned_keys:
            for locale, strings in in_scope_unassigned.items():
                target = resolve_under_output(output_root, UNASSIGNED_SLUG, f"{locale}.json")
                target.parent.mkdir(parents=True, exist_ok=True)
                reports.append(write_locale_file_reported(target, strings))
                expected.add(target.resolve())
                if locale == base:
                    base_touched = True

        manifest_written: Path | None = None
        manifest_deleted = False
        manifest_path = resolve_under_output(output_root, "manifest.json")
        if write_manifest and manifest:
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            manifest_written = manifest_path
            expected.add(manifest_path.resolve())
        elif manifest_path.exists():
            manifest_path.unlink()
            manifest_deleted = True
    else:
        if not isinstance(export, dict):
            export = {}
        manifest_written = None
        manifest_deleted = False
        for locale in scope:
            raw = export.get(locale)
            if not isinstance(raw, dict):
                continue
            strings = string_map(raw)
            target = resolve_under_output(output_root, f"{locale}.json")
            reports.append(write_locale_file_reported(target, strings))
            expected.add(target.resolve())
            if locale == base:
                base_touched = True

    deleted: list[Path] = []
    pruned_reports: list[PulledFileReport] = []
    for path in _owned_locale_paths(output_root, config.layout, scope):
        resolved = path.resolve()
        if resolved in expected:
            continue
        if not path.exists():
            continue
        old_strings = _read_old_string_map(path)
        pruned_reports.append(
            PulledFileReport(
                path=path,
                keys=sorted(old_strings),
                removed_keys=sorted(old_strings),
                written=False,
            )
        )
        path.unlink()
        deleted.append(path)
        if path.stem == base:
            base_touched = True

    if config.layout is Layout.modular:
        _prune_empty_module_dirs(output_root)
        unassigned_dir = output_root / UNASSIGNED_SLUG
        if unassigned_dir.is_dir() and not any(unassigned_dir.iterdir()):
            try:
                unassigned_dir.rmdir()
            except OSError:
                pass

    return PullApplyResult(
        reports=reports,
        pruned_reports=pruned_reports,
        expected_paths=expected,
        deleted_paths=deleted,
        manifest_written=manifest_written if config.layout is Layout.modular else None,
        manifest_deleted=manifest_deleted if config.layout is Layout.modular else False,
        base_locale_touched=base_touched,
    )


def _pushable_module_slug(slug: str) -> bool:
    return not slug.startswith("_") and not slug.startswith(".") and slug != UNASSIGNED_SLUG


def _expected_base_locale_paths(config: Config, export: Any, output_root: Path) -> set[Path]:
    scope = pull_scope_locales(config, export)
    base = config.base_language
    if base not in scope:
        return set()
    expected: set[Path] = set()
    if config.layout is Layout.flat:
        if isinstance(export, dict) and isinstance(export.get(base), dict):
            expected.add(resolve_under_output(output_root, f"{base}.json").resolve())
        return expected

    if not isinstance(export, dict):
        return expected
    modules = export.get("modules") if isinstance(export.get("modules"), dict) else {}
    for module_slug, locale_map in modules.items():
        slug = str(module_slug)
        if config.stage is Stage.draft and not _pushable_module_slug(slug):
            continue
        if not isinstance(locale_map, dict) or base not in locale_map:
            continue
        expected.add(resolve_under_output(output_root, slug, f"{base}.json").resolve())

    if config.stage is Stage.public:
        unassigned = export.get("unassigned") if isinstance(export.get("unassigned"), dict) else {}
        base_map = string_map(unassigned.get(base))
        if base_map:
            expected.add(
                resolve_under_output(output_root, UNASSIGNED_SLUG, f"{base}.json").resolve()
            )
    return expected


def _owned_pushable_base_paths(
    config: Config, output_root: Path, scope: list[str]
) -> list[Path]:
    base = config.base_language
    if base not in scope:
        return []
    if config.layout is Layout.flat:
        return [resolve_under_output(output_root, f"{base}.json")]
    paths: list[Path] = []
    if not output_root.is_dir():
        return paths
    for child in sorted(output_root.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith(".") or child.name.startswith("_") or child.is_symlink():
            continue
        target = _try_resolve_under_output(output_root, child.name, f"{base}.json")
        if target is not None:
            paths.append(target)
    return paths


def pull_will_touch_base_locale(config: Config, export: Any, output_root: Path) -> bool:
    """True when pull will rewrite or prune push-relevant base-language files."""
    scope = pull_scope_locales(config, export)
    base = config.base_language
    if base not in scope:
        return False
    expected = _expected_base_locale_paths(config, export, output_root)
    if expected:
        return True
    for path in _owned_pushable_base_paths(config, output_root, scope):
        if path.exists() and path.resolve() not in expected:
            return True
    return False


def file_module_locale(path: Path, output_dir: Path) -> tuple[str | None, str]:
    """Return ``(module_or_none, locale)`` from a pulled locale file path."""
    root = output_dir.resolve()
    target = path.resolve()
    rel = target.relative_to(root) if target.is_relative_to(root) else Path(target.name)
    locale = Path(rel.name).stem
    module = rel.parts[0] if len(rel.parts) > 1 else None
    return module, locale
