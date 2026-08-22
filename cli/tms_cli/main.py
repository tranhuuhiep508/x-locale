from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import typer
import yaml
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="TMS CLI — sync translations with your TMS server")
console = Console()

CONFIG_DIR = Path(".tms")
CONFIG_FILE = CONFIG_DIR / "config.yaml"

DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_OUTPUT_DIR = "./locales"
DEFAULT_BASE_LANGUAGE = "en"
DEFAULT_LAYOUT = "flat"
DEFAULT_STAGE = "draft"
UNASSIGNED_SLUG = "_unassigned"
_KEY_LIST_LIMIT = 100


@dataclass
class PulledFileReport:
    path: Path
    keys: list[str] = field(default_factory=list)
    new_keys: list[str] = field(default_factory=list)
    updated_keys: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ChangeItem:
    """One created/updated/orphaned key in a sync report."""

    key: str
    extra: str = ""


# ── Config helpers ─────────────────────────────────────────────────────────────


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        raise typer.Exit("No config found. Run `tms init` first.")
    with CONFIG_FILE.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_config(config: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        yaml.safe_dump(config, f, sort_keys=False)


def _merge_overrides(config: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """Return a shallow copy of *config* with non-None overrides applied."""
    merged = dict(config)
    for key, value in overrides.items():
        if value is not None:
            merged[key] = value
    return merged


# ── HTTP client ────────────────────────────────────────────────────────────────


def api_client(config: dict[str, Any]) -> httpx.Client:
    """Build an httpx.Client with X-API-Key header auth and /api base path."""
    return httpx.Client(
        base_url=config["api_url"].rstrip("/"),
        headers={"X-API-Key": config["api_key"]},
        timeout=60.0,
    )


# ── JSON / file helpers ────────────────────────────────────────────────────────

# Prettier 3+ (trailingComma: "all") and some editors emit trailing commas in JSON.
_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def load_json_file(path: Path) -> Any:
    """Load JSON from *path*, tolerating trailing commas from common formatters."""
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(_TRAILING_COMMA_RE.sub(r"\1", text))
    except json.JSONDecodeError as exc:
        raise typer.Exit(
            f"Invalid JSON in {path}: {exc.msg} (line {exc.lineno}, column {exc.colno})"
        ) from exc


def _parse_api_error(response: httpx.Response) -> str:
    """Extract a human-readable message from a FastAPI error response."""
    try:
        body = response.json()
    except json.JSONDecodeError:
        text = response.text.strip()
        return text or f"HTTP {response.status_code}"
    detail = body.get("detail")
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail:
            if isinstance(item, dict):
                loc = ".".join(str(part) for part in item.get("loc", ()))
                msg = item.get("msg", "")
                parts.append(f"{loc}: {msg}" if loc else msg)
            else:
                parts.append(str(item))
        return "; ".join(parts) if parts else f"HTTP {response.status_code}"
    if detail is not None:
        return str(detail)
    return response.text.strip() or f"HTTP {response.status_code}"


def _http_error(action: str, exc: httpx.HTTPStatusError) -> typer.Exit:
    detail = _parse_api_error(exc.response)
    return typer.Exit(f"{action} failed ({exc.response.status_code}): {detail}")


def _connection_error(action: str, exc: httpx.RequestError) -> typer.Exit:
    return typer.Exit(f"{action} failed: cannot reach server ({exc})")


def scoped_key(module_slug: str, key: str) -> str:
    """Label a modular string as ``module/key`` (folder + JSON key)."""
    return f"{module_slug}/{key}"


def change_items(keys: list[str]) -> list[ChangeItem]:
    return [ChangeItem(key=key) for key in sorted(keys)]


def file_module_locale(path: Path, output_dir: Path) -> tuple[str | None, str]:
    """Return ``(module_or_none, locale)`` from a pulled locale file path."""
    rel = path.relative_to(output_dir) if path.is_relative_to(output_dir) else Path(path.name)
    locale = Path(rel.name).stem
    module = rel.parts[0] if len(rel.parts) > 1 else None
    return module, locale


def group_pull_changes(
    reports: list[PulledFileReport],
    *,
    output_dir: Path,
    attr: str,
) -> list[ChangeItem]:
    """Group pull diffs by ``module/key`` (same identity as push), with locales."""
    locales_by_key: dict[str, list[str]] = {}
    for report in reports:
        module, locale = file_module_locale(report.path, output_dir)
        for key in getattr(report, attr):
            ident = scoped_key(module, key) if module else key
            seen = locales_by_key.setdefault(ident, [])
            if locale not in seen:
                seen.append(locale)
    return [
        ChangeItem(key=ident, extra=", ".join(locales))
        for ident, locales in sorted(locales_by_key.items())
    ]


def _print_report_header(command: str, details: list[str]) -> None:
    suffix = f"  [dim]{' · '.join(details)}[/dim]" if details else ""
    console.print(f"\n[bold]{command}[/bold]{suffix}")


def _print_counts(rows: list[tuple[str, int]]) -> None:
    if not rows:
        return
    width = max(len(label) for label, _ in rows)
    console.print()
    for label, count in rows:
        if label in {"Created", "Updated"} and count:
            style = "green" if label == "Created" else "cyan"
        elif label == "Orphaned" and count:
            style = "yellow"
        elif count == 0:
            style = "dim"
        else:
            style = ""
        line = f"  {label:<{width}}  {count:>4}"
        console.print(f"[{style}]{line}[/]" if style else line)


def _print_change_section(
    title: str,
    items: list[ChangeItem],
    *,
    style: str = "",
    hint: str = "",
) -> None:
    if not items:
        return
    heading = f"{title} ({len(items)})"
    console.print()
    if style:
        console.print(f"[{style}]{heading}[/]")
    else:
        console.print(heading)
    if hint:
        console.print(f"[dim]{hint}[/dim]")
    shown = items[:_KEY_LIST_LIMIT]
    key_width = max(len(item.key) for item in shown)
    for item in shown:
        if item.extra:
            console.print(f"    {item.key:<{key_width}}  [dim]{item.extra}[/dim]")
        else:
            console.print(f"    {item.key}")
    if len(items) > _KEY_LIST_LIMIT:
        console.print(f"    … and {len(items) - _KEY_LIST_LIMIT} more")


def _print_phase(name: str) -> None:
    console.print()
    console.rule(f"[bold]{name}[/bold]", align="left")


def build_modular_push_body(
    modules: dict[str, dict[str, str]],
    base_language: str,
) -> dict[str, dict[str, dict[str, dict[str, str]]]]:
    """Build ``{ modules: { slug: { locale: { key: value } } } }`` for CLI push."""
    return {
        "modules": {
            slug: {base_language: strings} for slug, strings in modules.items()
        }
    }


def _diff_locale_maps(
    old: dict[str, str], new: dict[str, str]
) -> tuple[list[str], list[str]]:
    added = sorted(set(new) - set(old))
    updated = sorted(k for k in set(new) & set(old) if old[k] != new[k])
    return added, updated


def parse_locale_json(data: dict[str, Any]) -> dict[str, str]:
    """Validate that all values are strings and return the same dict typed."""
    strings: dict[str, str] = {}
    for key, value in data.items():
        if not isinstance(value, str):
            raise typer.Exit(
                f"Locale JSON requires string values; got {type(value).__name__} for key {key!r}"
            )
        strings[key] = value
    return strings


def locale_json_from_strings(strings: dict[str, str]) -> dict[str, str]:
    """Return a sorted copy of *strings* suitable for writing to disk."""
    return dict(sorted(strings.items()))


def default_source_file(config: dict[str, Any]) -> Path:
    output_dir = Path(config.get("output_dir", DEFAULT_OUTPUT_DIR))
    base_language = config.get("base_language", DEFAULT_BASE_LANGUAGE)
    return output_dir / f"{base_language}.json"


def resolve_push_source(config: dict[str, Any], source_file: Path | None) -> Path:
    """Resolve and validate the source file path for a flat-layout push."""
    base_language = config.get("base_language", DEFAULT_BASE_LANGUAGE)
    default_path = default_source_file(config)
    path = default_path if source_file is None else source_file

    if path.is_dir():
        raise typer.Exit(
            f"Expected a JSON file, got directory '{path}'. "
            f"Run `tms push` without arguments to push {default_path}"
        )

    if path.suffix.lower() != ".json":
        raise typer.Exit(f"Expected a JSON file, got '{path}'")

    if path.stem != base_language:
        raise typer.Exit(
            f"Cannot push translation file '{path.name}'. "
            f"Push only accepts the base language file ({base_language}.json). "
            f"Run `tms push` without arguments to use {default_path}"
        )

    if not path.exists():
        raise typer.Exit(f"File not found: {path}")

    return path


def scan_modular_base(output_dir: Path, base_language: str) -> dict[str, dict[str, str]]:
    """Scan *output_dir* for ``{module}/{base_language}.json`` files.

    Returns ``{module_slug: {key: value}}`` for every module directory that
    contains a base-language file.  Directories whose names start with ``_``
    or ``.`` are skipped (e.g. ``_unassigned``, ``.tms``).
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


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if isinstance(v, str)}


def collect_modular_local_keys(
    output_dir: Path, base_language: str
) -> dict[str, str]:
    """Local base-language strings keyed as ``module/key`` (includes ``_unassigned``)."""
    result: dict[str, str] = {}
    for slug, strings in scan_modular_base(output_dir, base_language).items():
        for key, value in strings.items():
            result[scoped_key(slug, key)] = value
    for key, value in load_unassigned_base(output_dir, base_language).items():
        result[scoped_key(UNASSIGNED_SLUG, key)] = value
    return result


def collect_modular_remote_keys(
    export: dict[str, Any], base_language: str
) -> dict[str, str]:
    """Remote base-language strings keyed as ``module/key`` from a modular export."""
    result: dict[str, str] = {}
    modules = export.get("modules") or {}
    if isinstance(modules, dict):
        for slug, locale_map in modules.items():
            if not isinstance(locale_map, dict):
                continue
            for key, value in _string_map(locale_map.get(base_language)).items():
                result[scoped_key(str(slug), key)] = value
    unassigned = export.get("unassigned") or {}
    if isinstance(unassigned, dict):
        for key, value in _string_map(unassigned.get(base_language)).items():
            result[scoped_key(UNASSIGNED_SLUG, key)] = value
    return result


def modular_export_locales(export: dict[str, Any]) -> list[str]:
    manifest = export.get("manifest") or {}
    if isinstance(manifest, dict):
        locales = manifest.get("locales")
        if isinstance(locales, list) and locales:
            return [str(lc) for lc in locales]
    seen: list[str] = []
    modules = export.get("modules") or {}
    buckets: list[Any] = [modules] if isinstance(modules, dict) else []
    if isinstance(export.get("unassigned"), dict):
        buckets.append({"_": export["unassigned"]})
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        for locale_map in bucket.values():
            if not isinstance(locale_map, dict):
                continue
            for locale in locale_map:
                if locale not in seen:
                    seen.append(str(locale))
    return seen


def count_modular_untranslated(
    export: dict[str, Any],
    *,
    base_language: str,
    target_locales: list[str],
) -> dict[str, int]:
    counts = {lc: 0 for lc in target_locales}
    buckets: list[dict[str, Any]] = []
    modules = export.get("modules") or {}
    if isinstance(modules, dict):
        buckets.extend(v for v in modules.values() if isinstance(v, dict))
    unassigned = export.get("unassigned")
    if isinstance(unassigned, dict):
        buckets.append(unassigned)
    for locale_map in buckets:
        base_map = _string_map(locale_map.get(base_language))
        for locale in target_locales:
            target_map = _string_map(locale_map.get(locale))
            counts[locale] += sum(
                1 for key in base_map if not target_map.get(key, "").strip()
            )
    return counts


def _write_locale_file(path: Path, strings: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(locale_json_from_strings(strings), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_locale_file_reported(path: Path, strings: dict[str, str]) -> PulledFileReport:
    old_strings: dict[str, str] = {}
    if path.exists():
        existing = load_json_file(path)
        if isinstance(existing, dict):
            old_strings = {k: v for k, v in existing.items() if isinstance(v, str)}

    new_keys, updated_keys = _diff_locale_maps(old_strings, strings)
    _write_locale_file(path, strings)
    return PulledFileReport(
        path=path,
        keys=sorted(strings),
        new_keys=new_keys,
        updated_keys=updated_keys,
    )


def _print_pull_report(
    reports: list[PulledFileReport],
    *,
    output_dir: Path,
    layout: str,
    stage: str,
    manifest_written: Path | None = None,
) -> None:
    if not reports:
        console.print("[yellow]No locale files written.[/yellow]")
        return

    created = group_pull_changes(reports, output_dir=output_dir, attr="new_keys")
    updated = group_pull_changes(reports, output_dir=output_dir, attr="updated_keys")

    details = [layout, stage, f"{len(reports)} files"]
    _print_report_header("Pull", details)
    _print_counts(
        [
            ("Created", len(created)),
            ("Updated", len(updated)),
            ("Files", len(reports)),
        ]
    )
    _print_change_section(
        "Created",
        created,
        style="green",
        hint="New keys in local files.",
    )
    _print_change_section(
        "Updated",
        updated,
        style="cyan",
        hint="Values changed in local files.",
    )

    if not created and not updated:
        console.print("\n[green]Local files are already up to date.[/green]")
    footer = f"Wrote {len(reports)} files to {output_dir}"
    if manifest_written is not None:
        footer += f"  ·  manifest {manifest_written.name}"
    console.print(f"\n[dim]{footer}[/dim]")


def _print_push_report(
    *,
    result: dict[str, Any],
    local_key_count: int,
    orphans: list[str],
    details: list[str],
    dry_run: bool,
) -> None:
    diff = result.get("diff") or {}
    created = change_items(diff.get("create", []))
    updated = change_items(diff.get("update", []))
    orphan_items = change_items(orphans)
    unchanged_count = max(0, local_key_count - len(created) - len(updated))

    _print_report_header("Push", details)
    counts: list[tuple[str, int]] = [
        ("Created", len(created)),
        ("Updated", len(updated)),
        ("Unchanged", unchanged_count),
    ]
    if orphan_items:
        counts.append(("Orphaned", len(orphan_items)))
    _print_counts(counts)
    _print_change_section(
        "Created",
        created,
        style="green",
        hint="New strings on TMS.",
    )
    _print_change_section(
        "Updated",
        updated,
        style="cyan",
        hint="Base-language text changed on TMS.",
    )
    _print_change_section(
        "Orphaned",
        orphan_items,
        style="yellow",
        hint="On TMS, missing locally — not deleted.",
    )

    if dry_run:
        console.print("\n[dim]Dry run — no changes were saved.[/dim]")
    elif not created and not updated and not orphan_items:
        console.print("\n[green]Everything is already up to date.[/green]")


# ── Core logic (shared between commands) ──────────────────────────────────────


def _do_push(config: dict[str, Any], *, dry_run: bool = False) -> None:
    project_id = config.get("project_id")
    if not project_id:
        raise typer.Exit("project_id missing from config. Run `tms init` first.")

    output_dir = Path(config.get("output_dir", DEFAULT_OUTPUT_DIR))
    base_language = config.get("base_language", DEFAULT_BASE_LANGUAGE)
    layout = config.get("layout", DEFAULT_LAYOUT)

    pushed_module_slugs: set[str] | None = None
    if layout == "modular":
        modules = scan_modular_base(output_dir, base_language)
        if not modules:
            raise typer.Exit(
                f"No module directories with {base_language}.json found in {output_dir}. "
                "Create at least one module directory or switch to flat layout."
            )
        payload: dict[str, Any] = build_modular_push_body(modules, base_language)
        local_key_count = sum(len(strings) for strings in modules.values())
        details = [layout, f"{len(modules)} modules", base_language]
        pushed_module_slugs = set(modules.keys())
    else:
        source_path = resolve_push_source(config, None)
        raw = load_json_file(source_path)
        if not isinstance(raw, dict):
            raise typer.Exit("Locale JSON must be a top-level object")
        strings = parse_locale_json(raw)
        payload = {"strings": strings}
        local_key_count = len(strings)
        details = [layout, str(source_path)]

    if dry_run:
        details = ["dry run", *details]

    with api_client(config) as client:
        try:
            resp = client.post(
                f"/api/projects/{project_id}/strings/import",
                json=payload,
                params={"dry_run": dry_run},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _http_error("Push", exc) from exc
        except httpx.RequestError as exc:
            raise _connection_error("Push", exc) from exc

    result = resp.json()
    diff = result.get("diff") or {}
    all_orphans: list[str] = diff.get("orphan", [])

    # For modular layout: only report orphans for modules we actually pushed
    if pushed_module_slugs is not None:
        orphans = [
            k
            for k in all_orphans
            if any(k == mod or k.startswith(f"{mod}/") for mod in pushed_module_slugs)
        ]
    else:
        orphans = all_orphans

    _print_push_report(
        result=result,
        local_key_count=local_key_count,
        orphans=orphans,
        details=details,
        dry_run=dry_run,
    )


def _do_pull(config: dict[str, Any]) -> None:
    project_id = config.get("project_id")
    if not project_id:
        raise typer.Exit("project_id missing from config. Run `tms init` first.")

    output_dir = Path(config.get("output_dir", DEFAULT_OUTPUT_DIR))
    layout = config.get("layout", DEFAULT_LAYOUT)
    stage = config.get("stage", DEFAULT_STAGE)
    allowed_locales: list[str] | None = config.get("locales") or None
    write_manifest: bool = bool(config.get("manifest", False))

    with api_client(config) as client:
        try:
            resp = client.get(
                f"/api/projects/{project_id}/export",
                params={"layout": layout, "stage": stage},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _http_error("Pull", exc) from exc
        except httpx.RequestError as exc:
            raise _connection_error("Pull", exc) from exc

    data = resp.json()
    output_dir.mkdir(parents=True, exist_ok=True)
    reports: list[PulledFileReport] = []
    manifest_written: Path | None = None

    if layout == "modular":
        modules = data.get("modules", {})
        unassigned = data.get("unassigned", {})
        manifest = data.get("manifest", {})

        for module_slug, locale_map in modules.items():
            module_dir = output_dir / module_slug
            module_dir.mkdir(parents=True, exist_ok=True)
            for locale, strings in locale_map.items():
                if allowed_locales and locale not in allowed_locales:
                    continue
                target = module_dir / f"{locale}.json"
                reports.append(_write_locale_file_reported(target, strings))

        has_unassigned = any(strings for strings in unassigned.values())
        if has_unassigned:
            unassigned_dir = output_dir / "_unassigned"
            unassigned_dir.mkdir(parents=True, exist_ok=True)
            for locale, strings in unassigned.items():
                if not strings:
                    continue
                if allowed_locales and locale not in allowed_locales:
                    continue
                target = unassigned_dir / f"{locale}.json"
                reports.append(_write_locale_file_reported(target, strings))

        if write_manifest and manifest:
            manifest_written = output_dir / "manifest.json"
            manifest_written.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    else:
        for locale, strings in data.items():
            if allowed_locales and locale not in allowed_locales:
                continue
            target = output_dir / f"{locale}.json"
            reports.append(_write_locale_file_reported(target, strings))

    _print_pull_report(
        reports,
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        manifest_written=manifest_written,
    )


# ── CLI commands ───────────────────────────────────────────────────────────────


@app.command()
def init(
    api_key: str = typer.Option(..., "-k", "--api-key", help="Project API key (tms_…)"),
    api_url: str = typer.Option(DEFAULT_API_URL, "-u", "--api-url", help="TMS server base URL"),
    output_dir: str = typer.Option(DEFAULT_OUTPUT_DIR, "-o", "--output-dir", help="Directory for locale files"),
    base_language: str = typer.Option(
        DEFAULT_BASE_LANGUAGE, "--base-language", help="Base/source language code override"
    ),
    layout: str = typer.Option(DEFAULT_LAYOUT, "--layout", help="File layout: flat or modular"),
    stage: str = typer.Option(DEFAULT_STAGE, "--stage", help="Default pull stage: draft or public"),
) -> None:
    """Initialise TMS config by discovering the project linked to the API key."""
    tmp_config: dict[str, Any] = {"api_url": api_url, "api_key": api_key}
    with api_client(tmp_config) as client:
        try:
            resp = client.get("/api/bootstrap")
            resp.raise_for_status()
            project = resp.json()
        except httpx.HTTPStatusError as exc:
            raise _http_error("Bootstrap", exc) from exc
        except httpx.RequestError as exc:
            raise _connection_error("Bootstrap", exc) from exc

    project_id = str(project["id"])
    project_base = project.get("base_language") or base_language
    target_languages: list[str] = project.get("target_languages") or []
    locales = [project_base, *[lc for lc in target_languages if lc != project_base]]
    effective_layout = layout or (project.get("layout") or DEFAULT_LAYOUT)

    config: dict[str, Any] = {
        "api_url": api_url,
        "project_id": project_id,
        "api_key": api_key,
        "output_dir": output_dir,
        "layout": effective_layout,
        "stage": stage,
        "base_language": project_base,
        "locales": locales,
        "manifest": True,
    }
    save_config(config)

    console.print(
        f"[green]Initialized[/green] project=[bold]{project['name']}[/bold] ({project_id})"
    )
    console.print(
        f"  Base: {project_base}  ·  Locales: {', '.join(locales)}"
        f"  ·  Layout: {effective_layout}  ·  Stage: {stage}"
    )
    console.print(f"Config saved to [bold]{CONFIG_FILE}[/bold]")


@app.command()
def push(
    output_dir: str | None = typer.Option(None, "--output-dir", help="Override output directory"),
    layout: str | None = typer.Option(None, "--layout", help="Override layout (flat|modular)"),
    stage: str | None = typer.Option(None, "--stage", help="Override stage (draft|public)"),
    locales: str | None = typer.Option(None, "--locales", help="Comma-separated locale list"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview changes without applying"),
) -> None:
    """Push base-language source strings to TMS.

    Flat layout:    reads  {output_dir}/{base_language}.json
    Modular layout: scans  {output_dir}/*/{base_language}.json
    """
    config = _merge_overrides(
        load_config(),
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        locales=locales.split(",") if locales else None,
    )
    _do_push(config, dry_run=dry_run)


@app.command()
def pull(
    output_dir: str | None = typer.Option(None, "--output-dir", help="Override output directory"),
    layout: str | None = typer.Option(None, "--layout", help="Override layout (flat|modular)"),
    stage: str | None = typer.Option(None, "--stage", help="Override stage (draft|public)"),
    locales: str | None = typer.Option(None, "--locales", help="Comma-separated locale list"),
) -> None:
    """Pull translations from TMS to local JSON files.

    Flat layout:    writes {output_dir}/{locale}.json
    Modular layout: writes {output_dir}/{module}/{locale}.json
                    and optionally {output_dir}/manifest.json
    """
    config = _merge_overrides(
        load_config(),
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        locales=locales.split(",") if locales else None,
    )
    _do_pull(config)


@app.command()
def sync(
    output_dir: str | None = typer.Option(None, "--output-dir", help="Override output directory"),
    layout: str | None = typer.Option(None, "--layout", help="Override layout (flat|modular)"),
    stage: str | None = typer.Option(None, "--stage", help="Override stage (draft|public)"),
    locales: str | None = typer.Option(None, "--locales", help="Comma-separated locale list"),
) -> None:
    """Push base-language strings then pull all translations (push + pull)."""
    config = _merge_overrides(
        load_config(),
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        locales=locales.split(",") if locales else None,
    )
    _print_report_header(
        "Sync",
        [
            str(config.get("layout", DEFAULT_LAYOUT)),
            str(config.get("stage", DEFAULT_STAGE)),
        ],
    )
    _print_phase("Push")
    _do_push(config)
    _print_phase("Pull")
    _do_pull(config)


@app.command()
def status(
    output_dir: str | None = typer.Option(None, "--output-dir", help="Override output directory"),
    layout: str | None = typer.Option(None, "--layout", help="Override layout (flat|modular)"),
    stage: str | None = typer.Option(None, "--stage", help="Override stage (draft|public)"),
    locales: str | None = typer.Option(None, "--locales", help="Comma-separated locale list"),
) -> None:
    """Show diff between local files and TMS (missing keys, orphans, untranslated)."""
    config = _merge_overrides(
        load_config(),
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        locales=locales.split(",") if locales else None,
    )

    project_id = config.get("project_id")
    if not project_id:
        raise typer.Exit("project_id missing from config. Run `tms init` first.")

    out = Path(config.get("output_dir", DEFAULT_OUTPUT_DIR))
    base_language = config.get("base_language", DEFAULT_BASE_LANGUAGE)
    eff_layout = config.get("layout", DEFAULT_LAYOUT)
    eff_stage = config.get("stage", DEFAULT_STAGE)
    allowed_locales: list[str] | None = config.get("locales") or None

    with api_client(config) as client:
        try:
            resp = client.get(
                f"/api/projects/{project_id}/export",
                params={"layout": eff_layout, "stage": eff_stage},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise _http_error("Status fetch", exc) from exc
        except httpx.RequestError as exc:
            raise _connection_error("Status fetch", exc) from exc

    export = resp.json()

    if eff_layout == "modular":
        remote_base = collect_modular_remote_keys(export, base_language)
        local_base = collect_modular_local_keys(out, base_language)
        locales_to_check = allowed_locales or modular_export_locales(export)
        target_locales = [lc for lc in locales_to_check if lc != base_language]
        untranslated = count_modular_untranslated(
            export,
            base_language=base_language,
            target_locales=target_locales,
        )
    else:
        remote: dict[str, dict[str, str]] = export if isinstance(export, dict) else {}
        remote_base = _string_map(remote.get(base_language))
        local_base = {}
        src = out / f"{base_language}.json"
        if src.exists():
            raw = load_json_file(src)
            if isinstance(raw, dict):
                local_base = {k: v for k, v in raw.items() if isinstance(v, str)}
        locales_to_check = allowed_locales or list(remote.keys())
        target_locales = [lc for lc in locales_to_check if lc != base_language]
        untranslated = {}
        for locale in target_locales:
            locale_map = _string_map(remote.get(locale))
            untranslated[locale] = sum(
                1 for k in remote_base if not locale_map.get(k, "").strip()
            )

    remote_keys = set(remote_base)
    local_keys = set(local_base)
    missing = sorted(remote_keys - local_keys)
    orphan = sorted(local_keys - remote_keys)

    console.print(
        f"\n[bold]TMS Status[/bold]  project={project_id}"
        f"  layout={eff_layout}  stage={eff_stage}\n"
    )

    summary = Table(show_header=True)
    summary.add_column("Category", style="bold")
    summary.add_column("Count", justify="right")
    summary.add_row("Remote keys (base)", str(len(remote_keys)))
    summary.add_row("Local keys (base)", str(len(local_keys)))
    summary.add_row("[red]Missing locally[/red]", str(len(missing)))
    summary.add_row("[yellow]Orphaned locally[/yellow]", str(len(orphan)))
    for locale, count in untranslated.items():
        color = "red" if count > 0 else "green"
        summary.add_row(f"[{color}]Untranslated ({locale})[/{color}]", str(count))
    console.print(summary)

    if missing:
        console.print(f"\n[red]Missing locally ({len(missing)}) — run `tms pull` to add:[/red]")
        for key in missing[:20]:
            console.print(f"  {key}")
        if len(missing) > 20:
            console.print(f"  … and {len(missing) - 20} more")

    if orphan:
        console.print(
            f"\n[yellow]Orphaned locally ({len(orphan)}) — run `tms push` to add to TMS:[/yellow]"
        )
        for key in orphan[:20]:
            console.print(f"  {key}")
        if len(orphan) > 20:
            console.print(f"  … and {len(orphan) - 20} more")


if __name__ == "__main__":
    app()
