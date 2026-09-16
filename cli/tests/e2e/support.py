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

import httpx
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI_ROOT = REPO_ROOT / "cli"
BACKEND_ROOT = REPO_ROOT / "backend"


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def backend_env(db_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{db_path}",
        "AUTH_DEV_BYPASS": "true",
        "OIDC_ISSUER": "",
        "OIDC_CLIENT_ID": "",
        "OIDC_CLIENT_SECRET": "",
        "X_LOCALE_SECRET": "cli-e2e-secret",
        "X_LOCALE_DEMO_API_KEY": "cli-e2e-demo-key",
    }


def migrate_database(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=backend_env(db_path),
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
    db_path: Path
    process: subprocess.Popen[str]

    def stop(self) -> None:
        if self.process.poll() is not None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)


def start_backend_server(db_path: Path) -> BackendServer:
    migrate_database(db_path)
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
        env=backend_env(db_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_health(base_url)
    except Exception:
        process.kill()
        process.wait(timeout=5)
        raise
    return BackendServer(base_url=base_url, db_path=db_path, process=process)


def login_admin_client(base_url: str) -> httpx.Client:
    client = httpx.Client(base_url=base_url, timeout=30.0, follow_redirects=False)
    response = client.get("/api/auth/login")
    if response.status_code != 302:
        raise RuntimeError(f"Dev login failed: HTTP {response.status_code}")
    return client


@dataclass(frozen=True)
class TestProject:
    id: str
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
    command = ["uv", "run", "--project", str(CLI_ROOT), "locale", *args]
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
