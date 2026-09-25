"""Isolated PostgreSQL databases for migration and concurrency tests."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def postgres_url() -> Iterator[str]:
    base = os.environ.get("POSTGRES_TEST_URL")
    if not base:
        pytest.skip("POSTGRES_TEST_URL is not configured")
    url = make_url(base)
    name = f"xlocale_test_{uuid.uuid4().hex}"
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.exec_driver_sql(f'CREATE DATABASE "{name}"')
    try:
        yield url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as conn:
            conn.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


def migrate(url: str, revision: str = "head") -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    env["AUTH_DEV_BYPASS"] = "true"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture()
def postgres_engine(postgres_url):
    migrate(postgres_url)
    engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        engine.dispose()
