"""Validate remote sync metadata and exports before any file mutation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import Config, Layout, Stage

_LOCALE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")
_MODULE = re.compile(r"^[a-z][a-z0-9_-]*$")


def _invalid(location: str, expected: str) -> XLocaleError:
    return XLocaleError(
        f"Invalid server response at {location}: expected {expected}. Update the backend before using this CLI."
    )


def validate_sync_state(data: Any, config: Config, *, stage: Stage | None = None) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise _invalid("sync-state", "an object")
    for field, expected in (
        ("layout", config.layout.value),
        ("stage", (stage or config.stage).value),
    ):
        if data.get(field) != expected:
            raise _invalid(f"sync-state.{field}", repr(expected))
    base = data.get("base_language")
    if not isinstance(base, str) or not _LOCALE.fullmatch(base):
        raise _invalid("sync-state.base_language", "a locale code")
    locales = data.get("locales")
    if (
        not isinstance(locales, list)
        or not locales
        or any(not isinstance(code, str) or not _LOCALE.fullmatch(code) for code in locales)
        or len(set(locales)) != len(locales)
        or base not in locales
    ):
        raise _invalid("sync-state.locales", "unique locale codes including the base language")
    for field in ("pending_remove", "tombstones"):
        keys = data.get(field)
        if not isinstance(keys, list) or any(not isinstance(key, str) or not key for key in keys):
            raise _invalid(f"sync-state.{field}", "a list of string identities")
        if config.layout is Layout.modular:
            for identity in keys:
                slug, separator, key = identity.partition("/")
                if (
                    not separator
                    or not key
                    or (slug != "_unassigned" and not _MODULE.fullmatch(slug))
                ):
                    raise _invalid(f"sync-state.{field}", "module/key identities")
    return data


def require_matching_base(config: Config, state: dict[str, Any]) -> None:
    if config.base_language != state["base_language"]:
        raise XLocaleError(
            f"Configured base language '{config.base_language}' does not match project base language "
            f"'{state['base_language']}'. Refresh config with loc init."
        )


def reject_deleted_local_keys(config: Config, local_keys: set[str], state: dict[str, Any]) -> None:
    def stored_key(identity: str) -> str:
        return identity.split("/", 1)[1] if config.layout is Layout.modular else identity

    wanted = {stored_key(identity) for identity in local_keys}
    blocked = {
        field: sorted(identity for identity in state[field] if stored_key(identity) in wanted)
        for field in ("pending_remove", "tombstones")
    }
    if any(blocked.values()):
        parts = [
            "Push includes keys removed on x-locale. Restore them in x-locale or remove them from local source files before pushing."
        ]
        for field, label in (("pending_remove", "Pending remove"), ("tombstones", "Tombstones")):
            if blocked[field]:
                parts.append(f"{label}: {', '.join(blocked[field])}")
        raise XLocaleError("\n".join(parts))


@dataclass(frozen=True)
class ValidatedExport:
    data: dict[str, Any]


def validate_export(
    config: Config, data: Any, state: dict[str, Any], *, requested_locale: str | None = None
) -> ValidatedExport:
    """Require complete coverage of the export request, including out-of-scope maps."""
    validate_sync_state(state, config)
    require_matching_base(config, state)
    expected = {requested_locale} if requested_locale else set(state["locales"])
    if not expected.issubset(state["locales"]):
        raise _invalid("export locales", "current project locales")
    if not isinstance(data, dict):
        raise _invalid("export", "an object")

    def locale_maps(value: Any, location: str) -> None:
        if not isinstance(value, dict) or set(value) != expected:
            raise _invalid(location, f"locale maps for {', '.join(sorted(expected))}")
        for locale, strings in value.items():
            if not isinstance(strings, dict) or any(
                not isinstance(key, str) or not isinstance(text, str)
                for key, text in strings.items()
            ):
                raise _invalid(f"{location}.{locale}", "an object of string keys and string values")

    if config.layout is Layout.flat:
        locale_maps(data, "export")
        return ValidatedExport(data)

    modules = data.get("modules")
    if not isinstance(modules, dict):
        raise _invalid("export.modules", "an object")
    for slug, maps in modules.items():
        if not isinstance(slug, str) or not _MODULE.fullmatch(slug):
            raise _invalid("export.modules", "safe module slugs")
        locale_maps(maps, f"export.modules.{slug}")
    locale_maps(data.get("unassigned"), "export.unassigned")
    manifest = data.get("manifest")
    if not isinstance(manifest, dict):
        raise _invalid("export.manifest", "an object")
    for field, expected_values in (("modules", set(modules)), ("locales", expected)):
        values = manifest.get(field)
        if (
            not isinstance(values, list)
            or any(not isinstance(value, str) for value in values)
            or len(set(values)) != len(values)
            or set(values) != expected_values
        ):
            raise _invalid(f"export.manifest.{field}", "a list matching the export")
    if manifest.get("base_language") != state["base_language"]:
        raise _invalid("export.manifest.base_language", repr(state["base_language"]))
    if "content_hash" in manifest and not isinstance(manifest["content_hash"], str):
        raise _invalid("export.manifest.content_hash", "a string")
    return ValidatedExport(data)
