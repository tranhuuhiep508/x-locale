"""Postgres is required for the API, seed-demo, and Alembic."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import require_postgres_database_url
from tests.pg import assert_connected_test_database, truncate_all, validate_test_database_env

_BACKEND = Path(__file__).resolve().parents[1]
_FILE_URL = "sqlite:///:memory:"
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
        validate_test_database_env(_FILE_URL, "postgresql://localhost/xlocale_test")
    with pytest.raises(SystemExit, match="must not point at the DATABASE_URL database"):
        same = "postgresql+psycopg://localhost/xlocale_test"
        validate_test_database_env(same, same)
    with pytest.raises(SystemExit, match="dedicated test database"):
        validate_test_database_env(
            "postgresql+psycopg://localhost/xlocale_ci",
            "postgresql+psycopg://localhost/xlocale",
        )


def test_validate_test_database_env_rejects_host_alias_of_the_app_database():
    with pytest.raises(SystemExit, match="must not point at the DATABASE_URL database"):
        validate_test_database_env(
            "postgresql+psycopg://reader:secret@127.0.0.1:5432/xlocale_test",
            "postgresql://writer:other@localhost/xlocale_test",
        )


def test_validate_test_database_env_rejects_the_same_database_name():
    with pytest.raises(SystemExit, match="must not point at the DATABASE_URL database"):
        validate_test_database_env(
            "postgresql+psycopg://xlocale:secret@db.internal:5432/xlocale",
            "postgresql+psycopg://xlocale:secret@other.internal:5433/xlocale",
        )


def test_validate_test_database_env_accepts_a_distinct_test_database():
    test_url = "postgresql+psycopg://user:secret@127.0.0.1:5432/xlocale_test?sslmode=disable"
    app_url = "postgresql://user:secret@localhost/xlocale"
    assert validate_test_database_env(test_url, app_url) == test_url


@pytest.mark.parametrize("key", ["dbname", "DBNAME", "service", "servicefile"])
def test_validate_test_database_env_rejects_libpq_target_overrides(key: str):
    with pytest.raises(SystemExit, match="not the query string"):
        validate_test_database_env(
            f"postgresql+psycopg://localhost/xlocale_test?sslmode=disable&{key}=xlrev_app",
            "postgresql+psycopg://localhost/xlocale",
        )


def test_connected_database_matches_the_parsed_test_name(database_engine):
    expected = make_url(os.environ["TEST_DATABASE_URL"]).database
    with database_engine.connect() as conn:
        actual = conn.execute(text("SELECT current_database()")).scalar()
    assert actual == expected
    assert_connected_test_database(database_engine, os.environ["TEST_DATABASE_URL"], "xlocale")


def test_connected_database_refuses_a_different_parsed_name(database_engine):
    with pytest.raises(SystemExit, match="Refusing to TRUNCATE"):
        assert_connected_test_database(
            database_engine,
            "postgresql+psycopg://localhost/other_test",
            "xlocale",
        )


def test_connected_database_refuses_the_app_database_name(database_engine):
    current = make_url(os.environ["TEST_DATABASE_URL"]).database or ""
    with pytest.raises(SystemExit, match="Refusing to TRUNCATE"):
        assert_connected_test_database(
            database_engine,
            os.environ["TEST_DATABASE_URL"],
            current,
        )


class _Scalar:
    def __init__(self, value: str) -> None:
        self.value = value

    def scalar(self) -> str:
        return self.value


class _NameConnection:
    def __init__(self, name: str) -> None:
        self.name = name

    def execute(self, _statement: object) -> _Scalar:
        return _Scalar(self.name)

    def __enter__(self) -> _NameConnection:
        return self

    def __exit__(self, *_args: object) -> bool:
        return False


class _NameEngine:
    def __init__(self, name: str) -> None:
        self.name = name

    def connect(self) -> _NameConnection:
        return _NameConnection(self.name)


def test_connected_database_refuses_a_name_without_test():
    with pytest.raises(SystemExit, match="Refusing to TRUNCATE"):
        assert_connected_test_database(
            _NameEngine("xlrev_app"), "postgresql://localhost/xlrev_app", "other"
        )


def test_truncate_all_leaves_lock_timeout_at_default(database_engine):
    truncate_all(database_engine)
    pool = database_engine.pool
    capacity = pool.size() + pool._max_overflow
    held = []
    try:
        for _ in range(capacity):
            conn = database_engine.connect()
            held.append(conn)
            shown = conn.execute(text("SHOW lock_timeout")).scalar()
            assert shown == "0"
    finally:
        for conn in held:
            conn.close()


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
        row = conn.execute(
            text(
                """
                SELECT datcollate, datlocprovider
                FROM pg_database
                WHERE datname = current_database()
                """
            )
        ).one()
        datcollate = row.datcollate
        datlocprovider = row.datlocprovider
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
    assert datlocprovider == "c"
    if shown is not None:
        assert shown == "C"
