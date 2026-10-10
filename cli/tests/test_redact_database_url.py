"""Password redaction stays in-process. The CLI environment has no SQLAlchemy."""

from __future__ import annotations

import subprocess

import pytest

from tests.e2e.support import redact_database_url


def test_redact_database_url_masks_the_password(monkeypatch: pytest.MonkeyPatch):
    def fail(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        raise AssertionError("redact_database_url spawned a process")

    monkeypatch.setattr(subprocess, "run", fail)
    url = "postgresql+psycopg://xlocale:s3cret@localhost:5432/xlocale_test?sslmode=disable"
    redacted = redact_database_url(url)
    assert redacted == "postgresql+psycopg://xlocale:***@localhost:5432/xlocale_test?sslmode=disable"
    assert "s3cret" not in redacted


def test_redact_database_url_leaves_urls_without_a_password_unchanged():
    assert redact_database_url("postgresql://localhost/xlocale") == "postgresql://localhost/xlocale"
    assert redact_database_url("postgresql://xlocale@localhost/xlocale") == (
        "postgresql://xlocale@localhost/xlocale"
    )
