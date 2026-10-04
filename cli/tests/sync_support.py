"""Complete remote contract fixtures for existing push/index tests."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from x_locale_cli.models import Config


def sync_state(
    config: Config, *, locales: list[str] | None = None, stage: str | None = None
) -> dict[str, Any]:
    return {
        "layout": config.layout.value,
        "stage": stage or config.stage.value,
        "base_language": config.base_language,
        "locales": locales
        if locales is not None
        else [config.base_language, *([] if config.base_language == "en" else ["en"])],
        "pending_remove": [],
        "tombstones": [],
    }


def export_locales(export: dict[str, Any], config: Config) -> list[str]:
    codes = list(export["manifest"]["locales"]) if "modules" in export else list(export)
    return list(dict.fromkeys([config.base_language, *codes]))


def export_for_request(export: dict[str, Any], params: dict[str, Any] | None) -> dict[str, Any]:
    locale = (params or {}).get("locale")
    if not locale:
        return export
    if "modules" not in export:
        return {locale: export[locale]}
    return {
        **export,
        "modules": {slug: {locale: maps[locale]} for slug, maps in export["modules"].items()},
        "unassigned": {locale: export["unassigned"][locale]},
        "manifest": {**export["manifest"], "locales": [locale]},
    }


def with_preflight(import_response: Callable[..., Any], config: Config) -> Callable[..., Any]:
    """Add the safety read to an existing mock that records import writes only."""

    def request(client: Any, method: str, path: str, **kwargs: Any) -> Any:
        if path.endswith("/sync-state"):
            return sync_state(config, stage=kwargs["params"]["stage"])
        return import_response(client, method, path, **kwargs)

    return request
