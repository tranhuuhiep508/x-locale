"""Backend test fixtures. One Postgres database, truncated between tests."""

from __future__ import annotations

import atexit
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from tests.pg import (
    assert_connected_test_database,
    assert_no_preexisting_app_tables,
    databases_created_by_this_run,
    disposable_database,
    forget_database_created_by_this_run,
    load_dotenv_defaults,
    open_engine,
    path_database_name,
    prepare_session_database,
    truncate_all,
    validate_test_database_env,
)

load_dotenv_defaults()
_APP_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_TEST_DATABASE_URL = validate_test_database_env(
    os.environ.get("TEST_DATABASE_URL", ""),
    _APP_DATABASE_URL,
)
_APP_DATABASE_NAME = path_database_name(_APP_DATABASE_URL)
_RUN_DATABASE_URL = prepare_session_database(_TEST_DATABASE_URL)
os.environ["DATABASE_URL"] = _RUN_DATABASE_URL


def _drop_run_database() -> None:
    """Drop the session database if fixture teardown did not run."""
    from app.postgres_admin import database_name, drop_database

    try:
        drop_database(_RUN_DATABASE_URL)
    except Exception:
        return
    forget_database_created_by_this_run(database_name(_RUN_DATABASE_URL))


atexit.register(_drop_run_database)
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
    assert_connected_test_database(engine, _RUN_DATABASE_URL, _APP_DATABASE_NAME)
    assert_no_preexisting_app_tables(engine)
    Base.metadata.create_all(bind=engine)
    register_activity_listener()
    yield engine
    engine.dispose()
    from app.postgres_admin import database_name, drop_database

    name = database_name(_RUN_DATABASE_URL)
    drop_database(_RUN_DATABASE_URL)
    forget_database_created_by_this_run(name)


@pytest.fixture(scope="session", autouse=True)
def _no_leftover_databases():
    """Fail only for databases this process created and did not drop.

    Another pytest process on the same server has its own ``xl_test_`` name,
    so its databases are not this run's leftovers.
    """
    from app.postgres_admin import list_databases

    yield
    present = list_databases(_RUN_DATABASE_URL)
    leaked = sorted(name for name in databases_created_by_this_run() if name in present)
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
