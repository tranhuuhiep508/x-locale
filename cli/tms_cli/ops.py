"""Push, pull, and status operations shared by CLI commands."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tms_cli.client import api_client, request_json
from tms_cli.config import require_project_id
from tms_cli.errors import TmsError, TmsExit
from tms_cli.io import (
    build_modular_push_body,
    collect_modular_local_keys,
    collect_modular_remote_keys,
    count_modular_untranslated,
    load_json_file,
    modular_export_locales,
    parse_locale_json,
    resolve_push_source,
    scan_modular_base,
    scoped_key,
    string_map,
    write_locale_file_reported,
)
from tms_cli.issues import StatusSnapshot, classify_sync_issues
from tms_cli.models import UNASSIGNED_SLUG, Config, Layout, PulledFileReport
from tms_cli.report import (
    print_pull_report,
    print_push_report,
    print_status,
    print_sync_summary,
)


def _parse_sync_state(payload: Any) -> tuple[list[str], list[str]]:
    if not isinstance(payload, dict):
        return [], []
    pending = payload.get("pending_remove") or []
    tombs = payload.get("tombstones") or []
    pending_remove = [str(k) for k in pending] if isinstance(pending, list) else []
    tombstones = [str(k) for k in tombs] if isinstance(tombs, list) else []
    return pending_remove, tombstones


def _fetch_sync_state(client: Any, project_id: str, config: Config) -> dict[str, Any]:
    result = request_json(
        client,
        "GET",
        f"/api/projects/{project_id}/sync-state",
        action="Sync-state fetch",
        params={"layout": config.layout.value, "stage": config.stage.value},
    )
    return result if isinstance(result, dict) else {}


def _local_and_remote_base(
    config: Config, export: Any
) -> tuple[dict[str, str], dict[str, str], dict[str, int]]:
    out = config.output_path
    base_language = config.base_language
    allowed_locales = config.locale_filter
    if config.layout is Layout.modular:
        remote_base = collect_modular_remote_keys(export, base_language)
        local_base = collect_modular_local_keys(out, base_language)
        locales_to_check = allowed_locales or modular_export_locales(export)
        target_locales = [lc for lc in locales_to_check if lc != base_language]
        untranslated = count_modular_untranslated(
            export,
            base_language=base_language,
            target_locales=target_locales,
        )
        return local_base, remote_base, untranslated

    remote: dict[str, dict[str, str]] = export if isinstance(export, dict) else {}
    remote_base = string_map(remote.get(base_language))
    local_base: dict[str, str] = {}
    src = out / f"{base_language}.json"
    if src.exists():
        raw = load_json_file(src)
        if isinstance(raw, dict):
            local_base = {k: v for k, v in raw.items() if isinstance(v, str)}
    locales_to_check = allowed_locales or list(remote.keys())
    target_locales = [lc for lc in locales_to_check if lc != base_language]
    untranslated = {}
    for locale in target_locales:
        locale_map = string_map(remote.get(locale))
        untranslated[locale] = sum(
            1 for key in remote_base if not locale_map.get(key, "").strip()
        )
    return local_base, remote_base, untranslated


def load_status_snapshot(config: Config) -> StatusSnapshot:
    project_id = require_project_id(config)
    with api_client(config) as client:
        export = request_json(
            client,
            "GET",
            f"/api/projects/{project_id}/export",
            action="Status fetch",
            params={"layout": config.layout.value, "stage": config.stage.value},
        )
        state = _fetch_sync_state(client, project_id, config)

    local_base, remote_base, untranslated = _local_and_remote_base(config, export)
    pending_remove, tombstones = _parse_sync_state(state)
    issues = classify_sync_issues(
        local_base=local_base,
        remote_base=remote_base,
        pending_remove=pending_remove,
        tombstones=tombstones,
    )
    return StatusSnapshot(
        project_id=project_id,
        layout=config.layout.value,
        stage=config.stage.value,
        remote_count=len(remote_base),
        local_count=len(local_base),
        issues=issues,
        untranslated=untranslated,
    )


def _exit_if_blocking(snapshot: StatusSnapshot) -> None:
    if snapshot.issues.has_blocking():
        raise TmsExit(1)


def push_strings(config: Config, *, dry_run: bool = False) -> None:
    project_id = require_project_id(config)
    output_dir = config.output_path
    base_language = config.base_language

    pushed_module_slugs: set[str] | None = None
    pushed_keys: set[str] = set()
    if config.layout is Layout.modular:
        modules = scan_modular_base(output_dir, base_language)
        if not modules:
            raise TmsError(
                f"No module directories with {base_language}.json found in {output_dir}. "
                "Create at least one module directory or switch to flat layout."
            )
        payload: dict[str, Any] = build_modular_push_body(modules, base_language)
        local_key_count = sum(len(strings) for strings in modules.values())
        details = [config.layout.value, f"{len(modules)} modules", base_language]
        pushed_module_slugs = set(modules.keys())
        pushed_keys = {
            scoped_key(slug, key) for slug, strings in modules.items() for key in strings
        }
    else:
        source_path = resolve_push_source(config, None)
        raw = load_json_file(source_path)
        if not isinstance(raw, dict):
            raise TmsError("Locale JSON must be a top-level object")
        strings = parse_locale_json(raw)
        payload = {"strings": strings}
        local_key_count = len(strings)
        details = [config.layout.value, str(source_path)]
        pushed_keys = set(strings)

    if dry_run:
        details = ["dry run", *details]

    with api_client(config) as client:
        result = request_json(
            client,
            "POST",
            f"/api/projects/{project_id}/strings/import",
            action="Push",
            params={"dry_run": dry_run},
            payload=payload,
        )
        state = _fetch_sync_state(client, project_id, config)

    diff = result.get("diff") or {}
    all_orphans: list[str] = diff.get("orphan", [])

    if pushed_module_slugs is not None:
        orphans = [
            key
            for key in all_orphans
            if any(key == mod or key.startswith(f"{mod}/") for mod in pushed_module_slugs)
        ]
    else:
        orphans = all_orphans

    pending_remove, _tombstones = _parse_sync_state(state)
    pending_unchanged = sorted(pushed_keys & set(pending_remove))

    print_push_report(
        result=result,
        local_key_count=local_key_count,
        orphans=orphans,
        details=details,
        dry_run=dry_run,
        pending_remove=pending_unchanged,
    )


def pull_translations(config: Config) -> None:
    project_id = require_project_id(config)
    output_dir = config.output_path
    allowed_locales = config.locale_filter
    write_manifest = config.manifest

    with api_client(config) as client:
        data = request_json(
            client,
            "GET",
            f"/api/projects/{project_id}/export",
            action="Pull",
            params={"layout": config.layout.value, "stage": config.stage.value},
        )
        state = _fetch_sync_state(client, project_id, config)

    pending_remove, tombstones = _parse_sync_state(state)

    output_dir.mkdir(parents=True, exist_ok=True)
    reports: list[PulledFileReport] = []
    manifest_written: Path | None = None

    if config.layout is Layout.modular:
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
                reports.append(write_locale_file_reported(target, strings))

        has_unassigned = any(strings for strings in unassigned.values())
        if has_unassigned:
            unassigned_dir = output_dir / UNASSIGNED_SLUG
            unassigned_dir.mkdir(parents=True, exist_ok=True)
            for locale, strings in unassigned.items():
                if not strings:
                    continue
                if allowed_locales and locale not in allowed_locales:
                    continue
                target = unassigned_dir / f"{locale}.json"
                reports.append(write_locale_file_reported(target, strings))

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
            reports.append(write_locale_file_reported(target, strings))

    print_pull_report(
        reports,
        output_dir=output_dir,
        layout=config.layout.value,
        stage=config.stage.value,
        manifest_written=manifest_written,
        pending_remove=pending_remove,
        tombstones=tombstones,
    )


def show_status(config: Config) -> StatusSnapshot:
    snapshot = load_status_snapshot(config)
    print_status(snapshot)
    _exit_if_blocking(snapshot)
    return snapshot


def finish_sync(config: Config) -> StatusSnapshot:
    snapshot = load_status_snapshot(config)
    print_sync_summary(snapshot)
    _exit_if_blocking(snapshot)
    return snapshot
