"""CLI e2e database names are created for one run and dropped only by that run."""

from __future__ import annotations

import re
import subprocess

import pytest

from tests.e2e import support
from tests.e2e.support import (
    allocate_cli_database_name,
    reset_allocated_database_url,
    start_backend_server,
    unique_database_url,
)


@pytest.fixture(autouse=True)
def _fresh_allocation():
    reset_allocated_database_url()
    yield
    reset_allocated_database_url()


def test_allocate_requires_the_cli_prefix_and_rejects_non_test_names():
    for stem in ("latest", "contest_prod", "xlocale", "xlocale_test", "production"):
        with pytest.raises(RuntimeError, match="xlocale_cli_"):
            allocate_cli_database_name(stem, "xlocale")


def test_allocate_refuses_the_application_database_name():
    with pytest.raises(RuntimeError, match="application database"):
        allocate_cli_database_name("xlocale_cli_app", "xlocale_cli_app")


def test_allocate_appends_a_unique_suffix():
    first = allocate_cli_database_name("xlocale_cli_run", "xlocale")
    second = allocate_cli_database_name("xlocale_cli_run", "xlocale")
    assert re.fullmatch(r"xlocale_cli_run_[0-9]{10}_[0-9a-f]+", first)
    assert re.fullmatch(r"xlocale_cli_run_[0-9]{10}_[0-9a-f]+", second)
    assert first != second
    assert len(first) <= 63
    long_stem = "xlocale_cli_" + ("a" * 80)
    fitted = allocate_cli_database_name(long_stem, "xlocale")
    assert fitted.startswith("xlocale_cli_")
    assert "__" not in fitted
    assert len(fitted) <= 63


def test_allocate_strips_the_prefix_trailing_underscore():
    name = allocate_cli_database_name("xlocale_cli_", "xlocale")
    assert re.fullmatch(r"xlocale_cli_[0-9]{10}_[0-9a-f]+", name)
    assert "__" not in name


def test_unique_database_url_keeps_the_first_allocation(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/xlocale")
    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale_cli_one")
    first = unique_database_url()
    assert "/xlocale_cli_one_" in first
    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale_cli_two")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/production")
    assert unique_database_url() == first


def test_unique_database_url_refuses_the_app_database_and_a_non_test_name(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/xlocale")
    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale")
    with pytest.raises(RuntimeError, match="xlocale_cli_"):
        unique_database_url()
    reset_allocated_database_url()
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/xlocale_cli_app")
    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale_cli_app")
    with pytest.raises(RuntimeError, match="application database"):
        unique_database_url()


class _Proc:
    def poll(self) -> None:
        return None

    def terminate(self) -> None:
        return None

    def kill(self) -> None:
        return None

    def wait(self, timeout: float | None = None) -> int:
        return 0


def test_start_creates_a_new_database_and_stop_drops_only_that_url(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[tuple[str, str]] = []

    def record(action: str, url: str) -> None:
        calls.append((action, url))
        if action == "create-new" and "already" in url:
            raise RuntimeError("Database already exists")

    monkeypatch.setattr(support, "_admin", record)
    monkeypatch.setattr(support, "migrate_database", lambda _url: None)
    monkeypatch.setattr(support, "wait_for_health", lambda _url: None)
    monkeypatch.setattr(support, "find_free_port", lambda: 9)
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: _Proc())
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/xlocale")
    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale_cli_run")

    server = start_backend_server()
    created = server.database_url
    assert calls == [("sweep", created), ("create-new", created)]
    assert "/xlocale_cli_run_" in created
    assert not created.endswith("/xlocale")

    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale_cli_other")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/production")
    server.stop()
    assert calls[-1] == ("drop", created)
    assert all(url == created for _action, url in calls)


def test_start_does_not_drop_when_create_new_refuses_an_existing_database(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []

    def record(action: str, _url: str) -> None:
        calls.append(action)
        if action == "create-new":
            raise RuntimeError("Database 'xlocale_cli_run_abc' already exists")

    monkeypatch.setattr(support, "_admin", record)
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: _Proc())
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/xlocale")
    monkeypatch.setenv("CLI_E2E_DATABASE_NAME", "xlocale_cli_run")

    with pytest.raises(RuntimeError, match="already exists"):
        start_backend_server()
    assert calls == ["sweep", "create-new"]
    assert "drop" not in calls
