"""Postgres-backed API tests.

The default suite stays on SQLite. These helpers run only when
TEST_DATABASE_URL points at a real Postgres database (CI service container).
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]


def postgres_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    return url


def reset_public_schema(url: str) -> None:
    from sqlalchemy import text

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
    engine.dispose()


def upgrade_head(url: str) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")


def alembic_check(url: str) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.check(cfg)


@pytest.fixture()
def pg_session(monkeypatch) -> Iterator[tuple[TestClient, sessionmaker[Session]]]:
    """Alembic-upgraded Postgres with the same dev-bypass client the sqlite tests use."""
    url = postgres_url()
    from app.config import settings
    from app.database import get_db, register_activity_listener
    from app.main import app

    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")

    reset_public_schema(url)
    upgrade_head(url)

    engine: Engine = create_engine(url)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    register_activity_listener()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, session_factory

    app.dependency_overrides.pop(get_db, None)
    engine.dispose()
