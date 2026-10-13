"""HTTP client for the x-locale API."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from typing import Any

import httpx

from x_locale_cli.errors import JobFailedError, XLocaleError
from x_locale_cli.models import Config

HTTP_TIMEOUT = 120.0
JOB_TIMEOUT_ENV = "X_LOCALE_JOB_TIMEOUT"
DEFAULT_JOB_TIMEOUT = 1800.0
JOB_POLL_START = 1.0
JOB_POLL_MAX = 3.0


def api_client(config: Config) -> httpx.Client:
    """Build an httpx client with ``X-API-Key`` auth against ``config.api_url``."""
    return httpx.Client(
        base_url=config.api_url.rstrip("/"),
        # Large imports and undos then answer 202 + job id instead of timing out.
        headers={"X-API-Key": config.api_key, "Prefer": "respond-async"},
        timeout=HTTP_TIMEOUT,
    )


def parse_api_error(response: httpx.Response) -> str:
    """Extract a human-readable message from a FastAPI error response."""
    try:
        body = response.json()
    except json.JSONDecodeError:
        text = response.text.strip()
        return text or f"HTTP {response.status_code}"
    if not isinstance(body, dict):
        return response.text.strip() or f"HTTP {response.status_code}"
    return format_error_detail(
        body.get("detail"), response.text.strip() or f"HTTP {response.status_code}"
    )


def format_error_detail(detail: Any, fallback: str) -> str:
    """Render a FastAPI ``detail`` value (string, structured dict, or validation list)."""
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict) and isinstance(detail.get("message"), str):
        parts = [detail["message"]]
        for field, label in (("pending_remove", "Pending remove"), ("tombstones", "Tombstones")):
            keys = detail.get(field)
            if isinstance(keys, list) and keys:
                parts.append(f"{label}: {', '.join(str(key) for key in keys)}")
        return "\n".join(parts)
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail:
            if isinstance(item, dict):
                loc = ".".join(str(part) for part in item.get("loc", ()))
                msg = item.get("msg", "")
                parts.append(f"{loc}: {msg}" if loc else msg)
            else:
                parts.append(str(item))
        return "; ".join(parts) if parts else fallback
    if detail is not None:
        return str(detail)
    return fallback


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
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise XLocaleError(f"{action} failed: server returned invalid JSON") from exc


def is_job_accepted(body: Any) -> bool:
    """True for the 202 body of an import or undo that runs as a background job."""
    return isinstance(body, dict) and "job_id" in body and "created" not in body


def job_timeout() -> float:
    raw = os.environ.get(JOB_TIMEOUT_ENV, "").strip()
    try:
        return float(raw) if raw else DEFAULT_JOB_TIMEOUT
    except ValueError as exc:
        raise XLocaleError(f"{JOB_TIMEOUT_ENV} must be a number of seconds") from exc


def progress_label(progress: Any) -> str:
    if not isinstance(progress, dict) or not progress.get("phase"):
        return "running"
    phase = str(progress["phase"])
    total = progress.get("chunks_total") or 0
    if total:
        return f"{phase} {progress.get('chunks_done') or 0}/{total}"
    return phase


def wait_for_job(
    client: httpx.Client,
    job_id: str,
    *,
    action: str,
    timeout: float | None = None,
    on_progress: Callable[[Any], None] | None = None,
    sleep: Callable[[float], None] | None = None,
    clock: Callable[[], float] | None = None,
) -> Any:
    """Poll ``GET /api/jobs/{id}`` until the job ends; return its result.

    A failed job raises ``JobFailedError`` with the server status code of the
    rejection. Polling errors and timeouts raise a plain ``XLocaleError`` with
    no HTTP cause: the job may still commit, so callers must not treat them as
    a server rejection.
    """
    sleep = sleep or time.sleep
    clock = clock or time.monotonic
    limit = job_timeout() if timeout is None else timeout
    deadline = clock() + limit
    delay = JOB_POLL_START
    while True:
        try:
            job = request_json(client, "GET", f"/api/jobs/{job_id}", action=f"{action} status")
        except XLocaleError as exc:
            raise XLocaleError(
                f"{exc} (job {job_id}). The job may still finish on the server."
            ) from None
        status = job.get("status") if isinstance(job, dict) else None
        if status == "completed":
            return job.get("result") or {}
        if status == "failed":
            error = (job.get("result") or {}).get("error") or {}
            status_code = error.get("status_code")
            message = format_error_detail(error.get("detail"), job.get("error") or "job failed")
            label = status_code if status_code is not None else "job"
            raise JobFailedError(
                f"{action} failed ({label}): {message} (job {job_id})", status_code=status_code
            )
        if on_progress is not None:
            on_progress(job.get("progress") if isinstance(job, dict) else None)
        if clock() >= deadline:
            raise XLocaleError(
                f"{action} is still running on the server after {limit:.0f}s (job {job_id}). "
                f"Set {JOB_TIMEOUT_ENV} to wait longer."
            )
        sleep(delay)
        delay = min(delay * 1.5, JOB_POLL_MAX)
