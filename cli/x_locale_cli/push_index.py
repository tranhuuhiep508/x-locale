"""Local push snapshot (``.x-locale/push-index.json``) for key-level delta push."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass

import httpx
from pathlib import Path
from typing import Any

from x_locale_cli.config import CONFIG_DIR
from x_locale_cli.console import console
from x_locale_cli.io import scoped_key
from x_locale_cli.models import UNASSIGNED_SLUG, Config, Layout, PulledFileReport, Stage

PUSH_INDEX_VERSION = 1
ALLOWLISTED_PUSH_REJECT_STATUSES = frozenset({400, 401, 403, 404, 409, 413, 415, 422})
INDEX_NAME = "push-index.json"
PENDING_NAME = "push-index.pending"
_TMP_NAME = "push-index.json.tmp"
_KEY_BATCH_HINT = 500


def normalize_api_origin(api_url: str) -> str:
    """Normalize API base URL for index scope (trailing slash only)."""
    return api_url.strip().rstrip("/")


def hash_base_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def index_file_path(config_dir: Path = CONFIG_DIR) -> Path:
    return config_dir / INDEX_NAME


def pending_file_path(config_dir: Path = CONFIG_DIR) -> Path:
    return config_dir / PENDING_NAME


@dataclass(frozen=True)
class PushIndexScope:
    version: int
    project_id: str
    api_origin: str
    output_dir: str
    layout: str
    base_locale: str


@dataclass
class LoadedPushIndex:
    scope: PushIndexScope
    entries: dict[str, str]


@dataclass
class PushDiff:
    keys_to_send: list[str]
    removed_locally: list[str]
    local_hashes: dict[str, str]
    use_full: bool
    index_usable: bool


def scope_from_config(config: Config) -> PushIndexScope:
    output_resolved = str(config.output_path.resolve())
    return PushIndexScope(
        version=PUSH_INDEX_VERSION,
        project_id=config.project_id,
        api_origin=normalize_api_origin(config.api_url),
        output_dir=output_resolved,
        layout=config.layout.value,
        base_locale=config.base_language,
    )


def scopes_match(stored: PushIndexScope, current: PushIndexScope) -> bool:
    return (
        stored.version == current.version
        and stored.project_id == current.project_id
        and normalize_api_origin(stored.api_origin) == normalize_api_origin(current.api_origin)
        and stored.output_dir == current.output_dir
        and stored.layout == current.layout
        and stored.base_locale == current.base_locale
    )


def _parse_scope(raw: dict[str, Any]) -> PushIndexScope | None:
    try:
        return PushIndexScope(
            version=int(raw.get("version", 0)),
            project_id=str(raw.get("project_id", "")),
            api_origin=str(raw.get("api_origin", "")),
            output_dir=str(raw.get("output_dir", "")),
            layout=str(raw.get("layout", "")),
            base_locale=str(raw.get("base_locale", "")),
        )
    except (TypeError, ValueError):
        return None


def load_push_index(config: Config) -> LoadedPushIndex | None:
    path = index_file_path()
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    scope = _parse_scope(raw)
    if scope is None:
        return None
    entries_raw = raw.get("entries")
    if not isinstance(entries_raw, dict):
        return None
    entries = {str(k): str(v) for k, v in entries_raw.items() if isinstance(k, str) and isinstance(v, str)}
    return LoadedPushIndex(scope=scope, entries=entries)


def catalog_hashes_flat(strings: dict[str, str]) -> dict[str, str]:
    return {key: hash_base_value(value) for key, value in strings.items()}


def catalog_hashes_modular(modules: dict[str, dict[str, str]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for slug, strings in modules.items():
        for key, value in strings.items():
            result[scoped_key(slug, key)] = hash_base_value(value)
    return result


def compute_push_diff(
    config: Config,
    local_hashes: dict[str, str],
    *,
    full: bool,
    loaded: LoadedPushIndex | None,
) -> PushDiff:
    current_scope = scope_from_config(config)
    index_usable = False
    old_entries: dict[str, str] = {}
    pending_active = push_pending_is_active()

    if not full and pending_active:
        console.print(
            "[yellow]Warning:[/yellow] push-index.pending is present from an interrupted push or pull. "
            "Performing a full push."
        )

    if not full and loaded is not None and not pending_active:
        if scopes_match(loaded.scope, current_scope):
            index_usable = True
            old_entries = dict(loaded.entries)
        else:
            console.print(
                "[yellow]Warning:[/yellow] push-index scope does not match this run "
                "(project, API URL, output dir, layout, or base language). "
                "Performing a full push."
            )
    elif not full and loaded is None and index_file_path().exists() and not pending_active:
        console.print(
            "[yellow]Warning:[/yellow] push-index.json is missing or invalid. "
            "Performing a full push."
        )

    use_full = full or pending_active or not index_usable
    if use_full:
        return PushDiff(
            keys_to_send=sorted(local_hashes),
            removed_locally=[],
            local_hashes=local_hashes,
            use_full=True,
            index_usable=index_usable,
        )

    keys_to_send: list[str] = []
    for identity, digest in sorted(local_hashes.items()):
        previous = old_entries.get(identity)
        if previous is None or previous != digest:
            keys_to_send.append(identity)

    removed_locally = sorted(identity for identity in old_entries if identity not in local_hashes)

    return PushDiff(
        keys_to_send=keys_to_send,
        removed_locally=removed_locally,
        local_hashes=local_hashes,
        use_full=False,
        index_usable=True,
    )


def build_flat_delta_payload(strings: dict[str, str], keys_to_send: list[str]) -> dict[str, Any]:
    return {"strings": {k: strings[k] for k in keys_to_send if k in strings}}


def build_modular_delta_payload(
    modules: dict[str, dict[str, str]],
    base_language: str,
    keys_to_send: list[str],
) -> dict[str, Any]:
    by_module: dict[str, dict[str, str]] = {}
    for identity in keys_to_send:
        if "/" not in identity:
            continue
        slug, key = identity.split("/", 1)
        if slug not in modules or key not in modules[slug]:
            continue
        module_map = by_module.setdefault(slug, {})
        module_map[key] = modules[slug][key]
    return {
        "modules": {
            slug: {base_language: strings} for slug, strings in sorted(by_module.items()) if strings
        }
    }


def hashes_from_flat_payload(strings: dict[str, str]) -> dict[str, str]:
    return catalog_hashes_flat(strings)


def hashes_from_modular_payload(
    modules: dict[str, dict[str, dict[str, str]]],
    base_language: str,
) -> dict[str, str]:
    result: dict[str, str] = {}
    for slug, locale_maps in modules.items():
        if not isinstance(locale_maps, dict):
            continue
        base_map = locale_maps.get(base_language)
        if not isinstance(base_map, dict):
            continue
        for key, value in base_map.items():
            if isinstance(key, str) and isinstance(value, str):
                result[scoped_key(slug, key)] = hash_base_value(value)
    return result


def _index_document(scope: PushIndexScope, entries: dict[str, str]) -> dict[str, Any]:
    return {
        "version": scope.version,
        "project_id": scope.project_id,
        "api_origin": scope.api_origin,
        "output_dir": scope.output_dir,
        "layout": scope.layout,
        "base_locale": scope.base_locale,
        "entries": dict(sorted(entries.items())),
    }


def atomic_write_push_index(scope: PushIndexScope, entries: dict[str, str]) -> None:
    config_dir = CONFIG_DIR
    config_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = config_dir / _TMP_NAME
    final_path = index_file_path()
    payload = json.dumps(_index_document(scope, entries), ensure_ascii=False, indent=2) + "\n"
    tmp_path.write_text(payload, encoding="utf-8")
    with tmp_path.open("rb") as fh:
        os.fsync(fh.fileno())
    os.replace(tmp_path, final_path)


def delete_push_index() -> None:
    path = index_file_path()
    if path.exists():
        path.unlink()
    pending = pending_file_path()
    if pending.exists():
        pending.unlink()


def set_push_pending() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    pending_file_path().write_text("", encoding="utf-8")


def clear_push_pending() -> None:
    pending = pending_file_path()
    if pending.exists():
        pending.unlink()


def push_pending_is_active() -> bool:
    return pending_file_path().exists()


def maybe_clear_push_pending_after_failure(
    *,
    marker_existed_before: bool,
    created_marker_this_run: bool,
    exc: BaseException,
) -> None:
    """Clear the marker only when this run created it and the server rejected before commit."""
    if marker_existed_before or not created_marker_this_run:
        return
    cause = exc.__cause__ if isinstance(exc, BaseException) else None
    if isinstance(cause, httpx.HTTPStatusError):
        if cause.response.status_code in ALLOWLISTED_PUSH_REJECT_STATUSES:
            clear_push_pending()


def merge_sent_hashes(
    old_entries: dict[str, str],
    sent_hashes: dict[str, str],
) -> dict[str, str]:
    merged = dict(old_entries)
    merged.update(sent_hashes)
    return merged


def replace_entries_from_catalog(local_hashes: dict[str, str]) -> dict[str, str]:
    return dict(local_hashes)


def apply_index_after_success(
    config: Config,
    *,
    use_full: bool,
    old_entries: dict[str, str],
    sent_hashes: dict[str, str],
    local_hashes: dict[str, str],
) -> bool:
    """Persist index after a successful push. Returns False if the file could not be written."""
    scope = scope_from_config(config)
    try:
        if use_full:
            entries = replace_entries_from_catalog(local_hashes)
        else:
            entries = merge_sent_hashes(old_entries, sent_hashes)
        atomic_write_push_index(scope, entries)
        clear_push_pending()
        return True
    except OSError as exc:
        console.print(
            f"[yellow]Warning:[/yellow] Push was accepted by the server but push-index.json "
            f"could not be saved ({exc}). The next push may resend the same keys."
        )
        return False


def pull_should_mark_pending(config: Config, export: Any) -> bool:
    """True when this pull will rewrite pushable base files and may update the snapshot."""
    base = config.base_language
    allowed = config.locale_filter
    if allowed is not None and base not in allowed:
        return False

    if config.layout is Layout.flat:
        if not isinstance(export, dict):
            return False
        return base in export and isinstance(export.get(base), dict)

    if not isinstance(export, dict):
        return False
    modules = export.get("modules")
    if not isinstance(modules, dict):
        return False

    if config.stage is Stage.public:
        for locale_map in modules.values():
            if isinstance(locale_map, dict) and base in locale_map:
                return True
        unassigned = export.get("unassigned")
        if isinstance(unassigned, dict) and base in unassigned:
            return True
        return False

    for slug, locale_map in modules.items():
        if not isinstance(locale_map, dict) or base not in locale_map:
            continue
        if str(slug).startswith("_") or str(slug).startswith("."):
            continue
        if str(slug) == UNASSIGNED_SLUG:
            continue
        return True
    return False


def _module_base_maps_from_export(export: Any, base_language: str) -> dict[str, dict[str, str]]:
    modules = export.get("modules") if isinstance(export, dict) else None
    if not isinstance(modules, dict):
        return {}
    result: dict[str, dict[str, str]] = {}
    for slug, locale_map in modules.items():
        if not isinstance(locale_map, dict):
            continue
        base = locale_map.get(base_language)
        if isinstance(base, dict):
            result[str(slug)] = {k: v for k, v in base.items() if isinstance(k, str) and isinstance(v, str)}
    return result


def refresh_push_index_after_pull(
    config: Config,
    export: Any,
    reports: list[PulledFileReport],
    *,
    output_dir: Path,
    clear_pending_after_success: bool = False,
) -> None:
    from x_locale_cli.io import file_module_locale

    base = config.base_language
    allowed = config.locale_filter
    if allowed is not None and base not in allowed:
        return

    if config.stage is Stage.public:
        for report in reports:
            _module, locale = file_module_locale(report.path, output_dir)
            if locale == base:
                delete_push_index()
                console.print(
                    "\n[dim]Public pull updated base-language files; push-index removed. "
                    "The next push will be a full push.[/dim]"
                )
                return
        return

    loaded = load_push_index(config)
    scope = scope_from_config(config)
    if loaded is not None and not scopes_match(loaded.scope, scope):
        loaded = None

    entries: dict[str, str] = dict(loaded.entries) if loaded else {}

    if config.layout is Layout.flat:
        for report in reports:
            _module, locale = file_module_locale(report.path, output_dir)
            if locale != base:
                continue
            flat_map = export.get(base) if isinstance(export, dict) else None
            if isinstance(flat_map, dict):
                entries = catalog_hashes_flat(
                    {k: v for k, v in flat_map.items() if isinstance(k, str) and isinstance(v, str)}
                )
            break
    else:
        module_maps = _module_base_maps_from_export(export, base)
        touched_modules: set[str] = set()
        for report in reports:
            module, locale = file_module_locale(report.path, output_dir)
            if locale != base or module is None:
                continue
            if module.startswith("_") or module.startswith("."):
                continue
            if module == UNASSIGNED_SLUG:
                continue
            touched_modules.add(module)

        prefix_by_module = {slug: f"{slug}/" for slug in touched_modules}
        if touched_modules:
            entries = {
                ident: digest
                for ident, digest in entries.items()
                if not any(ident.startswith(prefix) for prefix in prefix_by_module.values())
            }
            for slug in sorted(touched_modules):
                strings = module_maps.get(slug, {})
                for key, value in strings.items():
                    entries[scoped_key(slug, key)] = hash_base_value(value)

    try:
        atomic_write_push_index(scope, entries)
        if clear_pending_after_success:
            clear_push_pending()
    except OSError as exc:
        console.print(
            f"[yellow]Warning:[/yellow] Locale files were written but push-index.json "
            f"could not be updated ({exc})."
        )
