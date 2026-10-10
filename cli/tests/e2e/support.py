"""Shared helpers for CLI end-to-end tests against a live x-locale API."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI_ROOT = REPO_ROOT / "cli"
BACKEND_ROOT = REPO_ROOT / "backend"


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def backend_env(database_url: str) -> dict[str, str]:
    return {
        **os.environ,
        "DATABASE_URL": database_url,
        "AUTH_DEV_BYPASS": "true",
        "OIDC_ISSUER": "",
        "OIDC_CLIENT_ID": "",
        "OIDC_CLIENT_SECRET": "",
        "X_LOCALE_SECRET": "cli-e2e-secret",
        "X_LOCALE_DEMO_API_KEY": "cli-e2e-demo-key",
    }


def _postgres_base_url() -> str:
    configured = os.environ.get("DATABASE_URL", "").strip()
    lowered = configured.lower()
    if lowered.startswith(("postgresql://", "postgresql+", "postgres://", "postgres+")):
        return configured
    return "postgresql+psycopg://xlocale:xlocale@localhost:5432/xlocale"


def redact_database_url(url: str) -> str:
    """Mask the password in this process. The CLI env does not import SQLAlchemy."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "database url"
    if not parts.scheme or parts.hostname is None:
        return "database url"
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    port = f":{parts.port}" if parts.port is not None else ""
    if parts.password is None:
        auth = "" if parts.username is None else f"{parts.username}@"
    else:
        auth = f"{parts.username or ''}:***@"
    return urlunsplit(
        (parts.scheme, f"{auth}{host}{port}", parts.path, parts.query, parts.fragment)
    )


def unique_database_url() -> str:
    """A database name that is unique for this process, on the configured server."""
    base = _postgres_base_url()
    name = os.environ.get("CLI_E2E_DATABASE_NAME", "").strip() or f"xlocale_cli_{uuid.uuid4().hex}"
    if any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for char in name):
        raise RuntimeError(f"Refusing database name {name!r}.")
    if "://" not in base or "/" not in base.split("://", 1)[1]:
        raise RuntimeError(
            f"Cannot derive a database name from {redact_database_url(base)}."
        )
    prefix, rest = base.split("://", 1)
    path, query = (rest.split("?", 1) + [""])[:2]
    head, _, _db = path.rpartition("/")
    suffix = f"?{query}" if query else ""
    return f"{prefix}://{head}/{name}{suffix}"


def _admin(action: str, database_url: str) -> None:
    try:
        subprocess.run(
            ["uv", "run", "python", "-m", "app.postgres_admin", action, database_url],
            cwd=BACKEND_ROOT,
            env=backend_env(database_url),
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"postgres_admin {action} failed for {redact_database_url(database_url)}:\n{exc.stderr}"
        ) from None


def migrate_database(database_url: str) -> None:
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=backend_env(database_url),
        check=True,
        capture_output=True,
        text=True,
    )


def wait_for_health(base_url: str, *, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: str | None = None
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}/health", timeout=2.0)
            if response.status_code == 200 and response.json().get("status") == "ok":
                return
            last_error = f"HTTP {response.status_code}: {response.text}"
        except httpx.HTTPError as exc:
            last_error = str(exc)
        time.sleep(0.25)
    raise RuntimeError(f"Backend did not become healthy at {base_url}: {last_error}")


@dataclass(frozen=True)
class BackendServer:
    base_url: str
    database_url: str
    process: subprocess.Popen[str]

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        _admin("drop", self.database_url)


def start_backend_server() -> BackendServer:
    database_url = unique_database_url()
    _admin("create", database_url)
    try:
        migrate_database(database_url)
    except Exception:
        _admin("drop", database_url)
        raise
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            f"--port={port}",
        ],
        cwd=BACKEND_ROOT,
        env=backend_env(database_url),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_health(base_url)
    except Exception:
        process.kill()
        process.wait(timeout=5)
        _admin("drop", database_url)
        raise
    return BackendServer(base_url=base_url, database_url=database_url, process=process)


def login_admin_client(base_url: str) -> httpx.Client:
    client = httpx.Client(base_url=base_url, timeout=30.0, follow_redirects=False)
    response = client.get("/api/auth/login")
    if response.status_code != 302:
        raise RuntimeError(f"Dev login failed: HTTP {response.status_code}")
    return client


@dataclass(frozen=True)
class TestProject:
    id: str
    slug: str
    api_key: str
    base_language: str
    target_languages: list[str]
    layout: str
    name: str


def create_test_project(
    admin: httpx.Client,
    *,
    layout: str = "flat",
    base_language: str = "vi",
    target_languages: list[str] | None = None,
) -> TestProject:
    suffix = uuid.uuid4().hex[:8]
    targets = target_languages or ["en"]
    response = admin.post(
        "/api/projects",
        json={
            "name": f"CLI E2E {suffix}",
            "base_language": base_language,
            "target_languages": targets,
            "layout": layout,
        },
    )
    response.raise_for_status()
    project = response.json()
    key_response = admin.post(
        f"/api/projects/{project['id']}/api-keys",
        json={"name": f"cli-e2e-{suffix}"},
    )
    key_response.raise_for_status()
    raw_key = key_response.json()["key"]
    return TestProject(
        id=project["id"],
        slug=project["slug"],
        api_key=raw_key,
        base_language=base_language,
        target_languages=targets,
        layout=layout,
        name=project["name"],
    )


def api_key_client(base_url: str, api_key: str) -> httpx.Client:
    return httpx.Client(
        base_url=base_url,
        headers={"X-API-Key": api_key},
        timeout=30.0,
    )


def create_module(admin: httpx.Client, project_id: str, slug: str, name: str | None = None) -> dict[str, Any]:
    response = admin.post(
        f"/api/projects/{project_id}/modules",
        json={"slug": slug, "name": name or slug.title()},
    )
    response.raise_for_status()
    return response.json()


def create_string(
    admin: httpx.Client,
    project_id: str,
    *,
    key: str,
    source_text: str,
    module_id: str | None = None,
    status: str = "draft",
    translations: dict[str, str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "key": key,
        "source_text": source_text,
        "status": status,
    }
    if module_id:
        payload["module_id"] = module_id
    if translations:
        payload["translations"] = translations
    response = admin.post(f"/api/projects/{project_id}/strings", json=payload)
    response.raise_for_status()
    return response.json()


def unpublish_strings(admin: httpx.Client, project_id: str, string_ids: list[str]) -> None:
    response = admin.post(
        f"/api/projects/{project_id}/strings/batch",
        json={"action": "unpublish", "string_ids": string_ids},
    )
    response.raise_for_status()


def find_string_by_key(client: httpx.Client, project_id: str, key: str) -> dict[str, Any] | None:
    response = client.get(
        f"/api/projects/{project_id}/strings",
        params={"q": key, "page_size": 50},
    )
    response.raise_for_status()
    for item in response.json().get("items") or []:
        if item.get("key") == key:
            return item
    return None


def export_flat_keys(
    client: httpx.Client,
    project_id: str,
    *,
    stage: str,
    locale: str = "vi",
) -> set[str]:
    response = client.get(
        f"/api/projects/{project_id}/export",
        params={"layout": "flat", "stage": stage},
    )
    response.raise_for_status()
    payload = response.json()
    locale_map = payload.get(locale) or {}
    return set(locale_map.keys())


def export_modular_keys(
    client: httpx.Client,
    project_id: str,
    *,
    stage: str,
    module_slug: str,
    locale: str = "vi",
) -> set[str]:
    response = client.get(
        f"/api/projects/{project_id}/export",
        params={"layout": "modular", "stage": stage},
    )
    response.raise_for_status()
    payload = response.json()
    modules = payload.get("modules") or {}
    module_locales = modules.get(module_slug) or {}
    locale_map = module_locales.get(locale) or {}
    return set(locale_map.keys())


def publish_strings(admin: httpx.Client, project_id: str, string_ids: list[str]) -> None:
    response = admin.post(
        f"/api/projects/{project_id}/strings/publish-preview",
        json={"string_ids": string_ids},
    )
    response.raise_for_status()
    fingerprint = response.json()["fingerprint"]
    response = admin.post(
        f"/api/projects/{project_id}/strings/batch",
        json={"action": "publish", "string_ids": string_ids, "fingerprint": fingerprint},
    )
    response.raise_for_status()


def list_string_keys(client: httpx.Client, project_id: str) -> set[str]:
    response = client.get(f"/api/projects/{project_id}/strings", params={"page_size": 200})
    response.raise_for_status()
    items = response.json().get("items") or []
    return {item["key"] for item in items}


def write_json(path: Path, data: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_config(
    root: Path,
    *,
    api_url: str,
    api_key: str,
    project_id: str,
    output_dir: str = "./locales",
    layout: str = "flat",
    stage: str = "draft",
    base_language: str = "vi",
    locales: list[str] | None = None,
    manifest: bool = False,
) -> Path:
    config_dir = root / ".x-locale"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "config.yaml"
    payload = {
        "api_url": api_url,
        "project_id": project_id,
        "api_key": api_key,
        "output_dir": output_dir,
        "layout": layout,
        "stage": stage,
        "base_language": base_language,
        "locales": locales or [],
        "manifest": manifest,
    }
    config_path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return config_path


@dataclass(frozen=True)
class CliResult:
    returncode: int
    stdout: str
    stderr: str


def run_locale(
    cwd: Path,
    *args: str,
    env: dict[str, str] | None = None,
    timeout: float = 120.0,
) -> CliResult:
    command = ["uv", "run", "--project", str(CLI_ROOT), "loc", *args]
    merged = {**os.environ, "NO_COLOR": "1", "TERM": "dumb"}
    if env:
        merged.update(env)
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=merged,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return CliResult(
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def combined_output(result: CliResult) -> str:
    return f"{result.stdout}\n{result.stderr}".strip()
