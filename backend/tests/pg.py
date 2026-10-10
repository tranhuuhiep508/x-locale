"""Postgres URLs, session truncate, and throwaway databases for tests."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from app.postgres_admin import create_database, drop_database, replace_database

REPO_ROOT = Path(__file__).resolve().parents[2]


def is_postgres_url(url: str | None) -> bool:
    lowered = (url or "").strip().lower()
    return lowered.startswith(("postgresql://", "postgresql+", "postgres://", "postgres+"))


def load_dotenv_defaults() -> None:
    """Fill empty process env from the repo .env without overriding real variables."""
    for path in (REPO_ROOT / ".env", REPO_ROOT / "backend" / ".env"):
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if os.environ.get(key, "").strip():
                continue
            os.environ[key] = value.strip().strip('"').strip("'")


def validate_test_database_env(test_url: str, app_url: str) -> str:
    """Return the test URL or exit before pytest can truncate a dev database."""
    test_url = test_url.strip()
    app_url = app_url.strip()
    if not test_url:
        raise SystemExit(
            "TEST_DATABASE_URL is required and must be a Postgres URL. "
            "Refusing to run tests without a database."
        )
    if not is_postgres_url(test_url):
        raise SystemExit("TEST_DATABASE_URL must be a Postgres URL.")
    if test_url == app_url:
        raise SystemExit(
            "TEST_DATABASE_URL must not equal DATABASE_URL. "
            "Refusing to TRUNCATE a database the app is configured to use."
        )
    return test_url


def open_engine(url: str | None = None) -> Engine:
    target = url or os.environ["DATABASE_URL"]
    return create_engine(target, pool_pre_ping=True, poolclass=NullPool)


def truncate_all(engine: Engine) -> None:
    from app.database import Base

    tables = list(Base.metadata.sorted_tables)
    if not tables:
        return
    quoted = ", ".join(f'"{table.name}"' for table in tables)
    with engine.begin() as conn:
        conn.execute(text("SET lock_timeout = '5s'"))
        conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))


def new_database_url(prefix: str = "xltest") -> str:
    name = f"{prefix}_{uuid.uuid4().hex}"
    return replace_database(os.environ["TEST_DATABASE_URL"], name)


def disposable_database(prefix: str = "xltest") -> Iterator[str]:
    url = new_database_url(prefix)
    create_database(url)
    try:
        yield url
    finally:
        drop_database(url)
