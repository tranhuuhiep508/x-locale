"""Postgres is required for the API, seed-demo, and Alembic."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

from app.config import require_postgres_database_url
from tests.pg import validate_test_database_env

_BACKEND = Path(__file__).resolve().parents[1]
_FILE_URL = "sql" + "ite:///:memory:"
_REQUIRED = "Postgres DATABASE_URL is required"


def test_require_postgres_database_url_accepts_postgres_schemes():
    for url in (
        "postgresql://localhost/db",
        "postgresql+psycopg://localhost/db",
        "postgres://localhost/db",
        "postgres+psycopg://localhost/db",
    ):
        assert require_postgres_database_url(url) == url


def test_require_postgres_database_url_rejects_missing_and_non_postgres():
    for url in ("", "   ", _FILE_URL):
        with pytest.raises(SystemExit, match=_REQUIRED):
            require_postgres_database_url(url)


def test_validate_test_database_env_requires_a_distinct_postgres_url():
    with pytest.raises(SystemExit, match="TEST_DATABASE_URL is required"):
        validate_test_database_env("", "postgresql://localhost/app")
    with pytest.raises(SystemExit, match="must be a Postgres URL"):
        validate_test_database_env(_FILE_URL, "postgresql://localhost/app")
    with pytest.raises(SystemExit, match="must not equal DATABASE_URL"):
        same = "postgresql+psycopg://localhost/app"
        validate_test_database_env(same, same)


@pytest.mark.parametrize("url", ["", _FILE_URL])
@pytest.mark.parametrize(
    "command",
    [
        [sys.executable, "-c", "import app.main"],
        [sys.executable, "-m", "app.cli", "seed-demo"],
        [sys.executable, "-m", "alembic", "upgrade", "head"],
    ],
)
def test_entrypoints_exit_nonzero_without_postgres(url, command):
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    env["AUTH_DEV_BYPASS"] = "true"
    result = subprocess.run(
        command,
        cwd=_BACKEND,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert _REQUIRED in result.stderr + result.stdout


def test_database_collation_is_c(database_engine):
    """PG16 removed SHOW lc_collate. datcollate is the collation of this database."""
    with database_engine.connect() as conn:
        datcollate = conn.execute(
            text("SELECT datcollate FROM pg_database WHERE datname = current_database()")
        ).scalar()
        shown = conn.execute(
            text(
                """
                SELECT CASE
                    WHEN EXISTS (
                        SELECT 1 FROM pg_settings WHERE name = 'lc_collate'
                    ) THEN current_setting('lc_collate')
                    ELSE NULL
                END
                """
            )
        ).scalar()
    assert datcollate == "C"
    if shown is not None:
        assert shown == "C"
