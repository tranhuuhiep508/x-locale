"""Push, pull, and status operations shared by CLI commands."""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from x_locale_cli.client import api_client, request_json
from x_locale_cli.config import require_project_ref
from x_locale_cli.errors import XLocaleError, XLocaleExit
from x_locale_cli.io import (
    apply_pull_export,
    build_modular_push_body,
    collect_modular_local_keys,
    collect_modular_remote_keys,
    load_json_file,
    parse_locale_json,
    prepare_pull_export,
    resolve_push_source,
    scan_modular_base,
    string_map,
)
from x_locale_cli.issues import StatusSnapshot, classify_sync_issues
from x_locale_cli.models import Config, Layout, PullResult, Stage, resolve_web_base
from x_locale_cli.push_index import (
    apply_index_after_success,
    build_flat_delta_payload,
    build_modular_delta_payload,
    catalog_hashes_flat,
    catalog_hashes_modular,
    compute_push_diff,
    hashes_from_flat_payload,
    hashes_from_modular_payload,
    load_push_index,
    maybe_clear_push_pending_after_failure,
    push_pending_is_active,
    refresh_push_index_after_pull,
    set_push_pending,
)
from x_locale_cli.report import (
    print_pull_report,
    print_push_report,
    print_status,
    print_sync_summary,
)
from x_locale_cli.validation import (
    reject_deleted_local_keys,
    require_matching_base,
    validate_export,
    validate_sync_state,
)


@contextmanager
def _client(config: Config, client: Any | None) -> Iterator[Any]:
    if client is not None:
        yield client
    else:
        with api_client(config) as owned:
            yield owned


def _parse_sync_state(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    # All callers have already validated the remote contract.
    return payload["pending_remove"], payload["tombstones"]


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
    return validate_sync_state(result, config)


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
        if not isinstance(raw, dict):
            raise XLocaleError(f"Locale JSON in {src} must be a top-level object")
        try:
            local_base = parse_locale_json(raw)
        except XLocaleError as exc:
            raise XLocaleError(f"Invalid locale file {src}: {exc}") from exc
    return local_base, remote_base


def load_status_snapshot(
    config: Config,
    *,
    client: Any | None = None,
    export: Any | None = None,
    state: dict[str, Any] | None = None,
) -> StatusSnapshot:
    project_id = require_project_ref(config)
    export_fetched = export is None
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

    export = validate_export(
        config,
        export,
        state,
        requested_locale=config.base_language if export_fetched else _pull_locale_param(config),
    ).data
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


def push_strings(
    config: Config,
    *,
    dry_run: bool = False,
    full: bool = False,
    client: Any | None = None,
) -> None:
    with _client(config, client) as http:
        _push_strings(config, dry_run=dry_run, full=full, client=http)


def _push_strings(
    config: Config,
    *,
    dry_run: bool = False,
    full: bool = False,
    client: Any | None = None,
) -> None:
    started = time.perf_counter()
    project_id = require_project_ref(config)
    output_dir = config.output_path
    base_language = config.base_language
    flat_strings: dict[str, str] | None = None
    modules: dict[str, dict[str, str]] | None = None

    if config.layout is Layout.modular:
        modules = scan_modular_base(output_dir, base_language)
        if not modules:
            raise XLocaleError(
                f"No module directories with {base_language}.json found in {output_dir}. "
                "Create at least one module directory or switch to flat layout."
            )
        local_hashes = catalog_hashes_modular(modules)
        local_key_count = len(local_hashes)
        details = [config.layout.value, f"{len(modules)} modules", base_language]
    else:
        source_path = resolve_push_source(config, None)
        raw = load_json_file(source_path)
        if not isinstance(raw, dict):
            raise XLocaleError(f"Locale JSON in {source_path} must be a top-level object")
        try:
            flat_strings = parse_locale_json(raw)
        except XLocaleError as exc:
            raise XLocaleError(f"Invalid locale file {source_path}: {exc}") from exc
        local_hashes = catalog_hashes_flat(flat_strings)
        local_key_count = len(local_hashes)
        details = [config.layout.value, str(source_path)]

    state = _fetch_sync_state(client, project_id, config.with_overrides(stage=Stage.draft))
    require_matching_base(config, state)
    reject_deleted_local_keys(config, set(local_hashes), state)

    loaded = load_push_index(config)
    diff = compute_push_diff(config, local_hashes, full=full, loaded=loaded)
    old_entries = dict(loaded.entries) if loaded and diff.index_usable and not diff.use_full else {}

    if full:
        details = ["full", *details]
    if dry_run:
        details = ["dry run", *details]

    keys_to_send = diff.keys_to_send if not diff.use_full else sorted(local_hashes)
    use_partial = not diff.use_full and bool(keys_to_send)

    if config.layout is Layout.modular:
        assert modules is not None
        if diff.use_full:
            payload: dict[str, Any] = build_modular_push_body(modules, base_language)
        else:
            payload = build_modular_delta_payload(modules, base_language, keys_to_send)
    else:
        assert flat_strings is not None
        if diff.use_full:
            payload = {"strings": flat_strings}
        else:
            payload = build_flat_delta_payload(flat_strings, keys_to_send)

    payload["base_language"] = base_language

    prepare_seconds = time.perf_counter() - started
    request_seconds = 0.0
    skipped_api = False
    result: dict[str, Any] = {
        "dry_run": dry_run,
        "created": 0,
        "updated": 0,
        "total": 0,
        "diff": {
            "create": [],
            "update": [],
            "orphan": [],
            "create_count": 0,
            "update_count": 0,
            "orphan_count": 0,
        },
    }

    # A full import still reports orphans and refreshes the index for an empty catalog.
    skipped_api = not keys_to_send and not diff.use_full
    if not skipped_api:
        params: dict[str, Any] = {"dry_run": dry_run}
        if use_partial:
            params["partial"] = True
        request_started = time.perf_counter()
        pending_existed_before = push_pending_is_active()
        created_marker_this_run = False
        if not dry_run:
            set_push_pending()
            created_marker_this_run = not pending_existed_before
        try:
            with _client(config, client) as http:
                result = request_json(
                    http,
                    "POST",
                    f"/api/projects/{project_id}/strings/import",
                    action="Push",
                    params=params,
                    payload=payload,
                )
        except Exception as exc:
            if not dry_run:
                maybe_clear_push_pending_after_failure(
                    marker_existed_before=pending_existed_before,
                    created_marker_this_run=created_marker_this_run,
                    exc=exc,
                )
            raise
        request_seconds = time.perf_counter() - request_started

        if not dry_run:
            if config.layout is Layout.modular:
                sent_hashes = hashes_from_modular_payload(
                    payload.get("modules") or {},
                    base_language,
                )
            else:
                sent_hashes = hashes_from_flat_payload(payload.get("strings") or {})
            apply_index_after_success(
                config,
                use_full=diff.use_full,
                old_entries=old_entries if not diff.use_full else {},
                sent_hashes=sent_hashes,
                local_hashes=local_hashes,
            )

    total_seconds = time.perf_counter() - started

    print_push_report(
        result=result,
        local_key_count=local_key_count,
        keys_to_send=len(keys_to_send) if not diff.use_full else local_key_count,
        details=details,
        dry_run=dry_run,
        prepare_seconds=prepare_seconds,
        request_seconds=request_seconds,
        total_seconds=total_seconds,
        skipped_api=skipped_api,
        removed_locally=diff.removed_locally,
        delta_mode=not diff.use_full,
        project_ref=config.project_ref,
        web_base=resolve_web_base(config),
    )


def pull_translations(config: Config, *, client: Any | None = None) -> PullResult:
    project_id = require_project_ref(config)
    output_dir = config.output_path
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
    validated = validate_export(config, data, state, requested_locale=_pull_locale_param(config))
    plan = prepare_pull_export(
        config,
        validated,
        output_root=output_root,
        write_manifest=write_manifest,
    )

    pending_existed_before = push_pending_is_active()
    created_marker_this_run = False
    if plan.base_locale_touched:
        set_push_pending()
        created_marker_this_run = not pending_existed_before

    apply_result = apply_pull_export(plan)
    reports = apply_result.reports
    manifest_written = apply_result.manifest_written

    refresh_push_index_after_pull(
        config,
        data,
        reports,
        output_dir=output_root,
        clear_pending_after_success=created_marker_this_run,
        base_locale_touched=apply_result.base_locale_touched,
    )
    print_pull_report(
        reports,
        output_dir=output_root,
        layout=config.layout.value,
        stage=config.stage.value,
        manifest_written=manifest_written,
        deleted_paths=apply_result.deleted_paths,
        pruned_reports=apply_result.pruned_reports,
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
