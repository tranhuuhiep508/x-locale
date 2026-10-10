"""Backend test fixtures. One Postgres database, truncated between tests."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from tests.pg import (
    disposable_database,
    load_dotenv_defaults,
    open_engine,
    truncate_all,
    validate_test_database_env,
)

load_dotenv_defaults()
_TEST_DATABASE_URL = validate_test_database_env(
    os.environ.get("TEST_DATABASE_URL", ""),
    os.environ.get("DATABASE_URL", ""),
)
os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
os.environ["AUTH_DEV_BYPASS"] = "true"
os.environ["X_LOCALE_SECRET"] = "test-secret"
os.environ["X_LOCALE_DEMO_API_KEY"] = "test-demo-key"
os.environ["OIDC_ISSUER"] = ""
os.environ["OIDC_CLIENT_ID"] = ""
os.environ["OIDC_CLIENT_SECRET"] = ""

pytest_plugins = ["tests.postgres_support"]


@pytest.fixture(scope="session")
def database_engine():
    import app.models  # noqa: F401
    from app.database import Base, register_activity_listener

    engine = open_engine()
    Base.metadata.create_all(bind=engine)
    register_activity_listener()
    yield engine
    engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def _no_leftover_databases():
    from app.postgres_admin import list_databases

    before = list_databases(_TEST_DATABASE_URL)
    yield
    after = list_databases(_TEST_DATABASE_URL)
    leaked = sorted(name for name in after - before if name.startswith("xltest_"))
    assert leaked == [], f"throwaway databases left behind: {leaked}"


@pytest.fixture(autouse=True)
def _truncate_between_tests(database_engine):
    truncate_all(database_engine)
    yield


@pytest.fixture()
def session_factory(database_engine):
    return sessionmaker(bind=database_engine, autoflush=False, autocommit=False)


@pytest.fixture()
def client(database_engine, session_factory, monkeypatch):
    from app.config import settings
    from app.database import get_db
    from app.main import app

    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def throwaway_database():
    yield from disposable_database()
