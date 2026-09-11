"""Pytest fixtures for CLI E2E tests (one live backend, isolated projects per test)."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from .support import (
    BackendServer,
    TestProject,
    create_test_project,
    login_admin_client,
    start_backend_server,
)


@pytest.fixture(scope="session")
def backend_server(tmp_path_factory: pytest.TempPathFactory) -> BackendServer:
    data_dir = tmp_path_factory.mktemp("cli-e2e-backend")
    db_path = data_dir / "e2e.db"
    server = start_backend_server(db_path)
    yield server
    server.stop()


@pytest.fixture(scope="session")
def api_base_url(backend_server: BackendServer) -> str:
    return backend_server.base_url


@pytest.fixture(scope="session")
def admin_client(api_base_url: str) -> httpx.Client:
    client = login_admin_client(api_base_url)
    yield client
    client.close()


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def flat_project(admin_client: httpx.Client) -> TestProject:
    return create_test_project(admin_client, layout="flat")


@pytest.fixture
def modular_project(admin_client: httpx.Client) -> TestProject:
    return create_test_project(admin_client, layout="modular")
