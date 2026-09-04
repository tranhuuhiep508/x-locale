"""HTTP client for the x-locale API."""

from __future__ import annotations

import json
from typing import Any

import httpx

from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import Config

HTTP_TIMEOUT = 60.0


def api_client(config: Config) -> httpx.Client:
    """Build an httpx client with ``X-API-Key`` auth against ``config.api_url``."""
    return httpx.Client(
        base_url=config.api_url.rstrip("/"),
        headers={"X-API-Key": config.api_key},
        timeout=HTTP_TIMEOUT,
    )


def parse_api_error(response: httpx.Response) -> str:
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


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    action: str,
    params: dict[str, Any] | None = None,
    payload: Any = None,
) -> Any:
    """Send a request and return JSON, or raise ``XLocaleError`` on failure."""
    try:
        response = client.request(method, path, params=params, json=payload)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = parse_api_error(exc.response)
        raise XLocaleError(f"{action} failed ({exc.response.status_code}): {detail}") from exc
    except httpx.RequestError as exc:
        raise XLocaleError(f"{action} failed: cannot reach server ({exc})") from exc
    return response.json()
