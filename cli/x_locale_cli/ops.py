"""Push, pull, and status operations shared by CLI commands."""

from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from x_locale_cli.client import api_client, request_json
from x_locale_cli.config import require_project_id
from x_locale_cli.errors import XLocaleError, XLocaleExit
from x_locale_cli.io import (
    build_modular_push_body,
    collect_modular_local_keys,
    collect_modular_remote_keys,
    load_json_file,
    parse_locale_json,
    resolve_push_source,
    resolve_under_output,
    scan_modular_base,
    string_map,
    write_locale_file_reported,
)
from x_locale_cli.issues import StatusSnapshot, classify_sync_issues
from x_locale_cli.models import UNASSIGNED_SLUG, Config, Layout, PullResult, PulledFileReport
from x_locale_cli.report import (
    print_pull_report,
    print_push_report,
    print_status,
    print_sync_summary,
)


@contextmanager
def _client(config: Config, client: Any | None) -> Iterator[Any]:
    if client is not None:
        yield client
    else:
        with api_client(config) as owned:
            yield owned


def _parse_sync_state(payload: Any) -> tuple[list[str], list[str]]:
    if not isinstance(payload, dict):
        return [], []
    pending = payload.get("pending_remove") or []
    tombs = payload.get("tombstones") or []
    pending_remove = [str(k) for k in pending] if isinstance(pending, list) else []
    tombstones = [str(k) for k in tombs] if isinstance(tombs, list) else []
    return pending_remove, tombstones


def _export_query(config: Config, *, locale: str | None = None) -> dict[str, str]:
    params = {"layout": config.layout.value, "stage": config.stage.value}
    if locale:
        params["locale"] = locale
    return params


def _pull_locale_param(config: Config) -> str | None:
    allowed = config.locale_filter
    if allowed and len(allowed) == 1:
        return allowed[0]
    return None


def _fetch_sync_state(client: Any, project_id: str, config: Config) -> dict[str, Any]:
    result = request_json(
        client,
        "GET",
        f"/api/projects/{project_id}/sync-state",
        action="Sync-state fetch",
        params={"layout": config.layout.value, "stage": config.stage.value},
    )
    return result if isinstance(result, dict) else {}


def _local_and_remote_base(config: Config, export: Any) -> tuple[dict[str, str], dict[str, str]]:
    out = config.output_path
    base_language = config.base_language
    if config.layout is Layout.modular:
        remote_base = collect_modular_remote_keys(export, base_language)
        local_base = collect_modular_local_keys(out, base_language)
        return local_base, remote_base

    remote: dict[str, dict[str, str]] = export if isinstance(export, dict) else {}
    remote_base = string_map(remote.get(base_language))
    local_base: dict[str, str] = {}
    src = out / f"{base_language}.json"
    if src.exists():
        raw = load_json_file(src)
        if isinstance(raw, dict):
            local_base = {k: v for k, v in raw.items() if isinstance(v, str)}
    return local_base, remote_base


def load_status_snapshot(
    config: Config,
    *,
    client: Any | None = None,
    export: Any | None = None,
    state: dict[str, Any] | None = None,
) -> StatusSnapshot:
    project_id = require_project_id(config)
    if export is None or state is None:
        with _client(config, client) as http:
            if export is None:
                export = request_json(
                    http,
                    "GET",
                    f"/api/projects/{project_id}/export",
                    action="Status fetch",
                    params=_export_query(config, locale=config.base_language),
                )
            if state is None:
                state = _fetch_sync_state(http, project_id, config)

    local_base, remote_base = _local_and_remote_base(config, export)
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
    )


def _exit_if_blocking(snapshot: StatusSnapshot) -> None:
    if snapshot.issues.has_blocking():
        raise XLocaleExit(1)


def push_strings(config: Config, *, dry_run: bool = False, client: Any | None = None) -> None:
    project_id = require_project_id(config)
    output_dir = config.output_path
    base_language = config.base_language

    if config.layout is Layout.modular:
        modules = scan_modular_base(output_dir, base_language)
        if not modules:
            raise XLocaleError(
                f"No module directories with {base_language}.json found in {output_dir}. "
                "Create at least one module directory or switch to flat layout."
            )
        payload: dict[str, Any] = build_modular_push_body(modules, base_language)
        local_key_count = sum(len(strings) for strings in modules.values())
        details = [config.layout.value, f"{len(modules)} modules", base_language]
    else:
        source_path = resolve_push_source(config, None)
        raw = load_json_file(source_path)
        if not isinstance(raw, dict):
            raise XLocaleError("Locale JSON must be a top-level object")
        strings = parse_locale_json(raw)
        payload = {"strings": strings}
        local_key_count = len(strings)
        details = [config.layout.value, str(source_path)]

    if dry_run:
        details = ["dry run", *details]

    with _client(config, client) as http:
        result = request_json(
            http,
            "POST",
            f"/api/projects/{project_id}/strings/import",
            action="Push",
            params={"dry_run": dry_run},
            payload=payload,
        )

    print_push_report(
        result=result,
        local_key_count=local_key_count,
        details=details,
        dry_run=dry_run,
    )


def pull_translations(config: Config, *, client: Any | None = None) -> PullResult:
    project_id = require_project_id(config)
    output_dir = config.output_path
    allowed_locales = config.locale_filter
    write_manifest = config.manifest

    with _client(config, client) as http:
        data = request_json(
            http,
            "GET",
            f"/api/projects/{project_id}/export",
            action="Pull",
            params=_export_query(config, locale=_pull_locale_param(config)),
        )
        state = _fetch_sync_state(http, project_id, config)

    pending_remove, tombstones = _parse_sync_state(state)

    output_root = output_dir.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    reports: list[PulledFileReport] = []
    manifest_written: Path | None = None

    if config.layout is Layout.modular:
        modules = data.get("modules", {})
        unassigned = data.get("unassigned", {})
        manifest = data.get("manifest", {})

        for module_slug, locale_map in modules.items():
            for locale, strings in locale_map.items():
                if allowed_locales and locale not in allowed_locales:
                    continue
                target = resolve_under_output(output_root, module_slug, f"{locale}.json")
                target.parent.mkdir(parents=True, exist_ok=True)
                reports.append(write_locale_file_reported(target, strings))

        has_unassigned = any(strings for strings in unassigned.values())
        if has_unassigned:
            for locale, strings in unassigned.items():
                if not strings:
                    continue
                if allowed_locales and locale not in allowed_locales:
                    continue
                target = resolve_under_output(output_root, UNASSIGNED_SLUG, f"{locale}.json")
                target.parent.mkdir(parents=True, exist_ok=True)
                reports.append(write_locale_file_reported(target, strings))

        if write_manifest and manifest:
            manifest_written = resolve_under_output(output_root, "manifest.json")
            manifest_written.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    else:
        for locale, strings in data.items():
            if allowed_locales and locale not in allowed_locales:
                continue
            target = resolve_under_output(output_root, f"{locale}.json")
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
    return PullResult(export=data, state=state)


def show_status(config: Config) -> StatusSnapshot:
    snapshot = load_status_snapshot(config)
    print_status(snapshot)
    _exit_if_blocking(snapshot)
    return snapshot


def finish_sync(
    config: Config,
    *,
    export: Any | None = None,
    state: dict[str, Any] | None = None,
) -> StatusSnapshot:
    pull_locale = _pull_locale_param(config)
    if pull_locale is not None and pull_locale != config.base_language:
        export = None
    snapshot = load_status_snapshot(config, export=export, state=state)
    print_sync_summary(snapshot)
    _exit_if_blocking(snapshot)
    return snapshot
