"""JSON and locale-file helpers (flat and modular layouts)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from x_locale_cli.console import console
from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import (
    DEFAULT_BASE_LANGUAGE,
    UNASSIGNED_SLUG,
    Config,
    PulledFileReport,
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


def write_locale_file(path: Path, strings: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(locale_json_from_strings(strings), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_locale_file_reported(path: Path, strings: dict[str, str]) -> PulledFileReport:
    old_strings: dict[str, str] = {}
    if path.exists():
        existing = load_json_file(path)
        if isinstance(existing, dict):
            old_strings = {k: v for k, v in existing.items() if isinstance(v, str)}

    new_keys, updated_keys, removed_keys = diff_locale_maps(old_strings, strings)
    unchanged = not new_keys and not updated_keys and not removed_keys and path.exists()
    if not unchanged:
        write_locale_file(path, strings)
    return PulledFileReport(
        path=path,
        keys=sorted(strings),
        new_keys=new_keys,
        updated_keys=updated_keys,
        removed_keys=removed_keys,
        written=not unchanged,
    )


def file_module_locale(path: Path, output_dir: Path) -> tuple[str | None, str]:
    """Return ``(module_or_none, locale)`` from a pulled locale file path."""
    rel = path.relative_to(output_dir) if path.is_relative_to(output_dir) else Path(path.name)
    locale = Path(rel.name).stem
    module = rel.parts[0] if len(rel.parts) > 1 else None
    return module, locale
