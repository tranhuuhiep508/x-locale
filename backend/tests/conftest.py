"""Backend test fixtures."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Use in-memory SQLite for tests before app imports engine.
# Cloud/dev hosts may inject OIDC_*; bypass is ignored when OIDC is configured.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["AUTH_DEV_BYPASS"] = "true"
os.environ["X_LOCALE_SECRET"] = "test-secret"
os.environ["X_LOCALE_DEMO_API_KEY"] = "test-demo-key"
os.environ["OIDC_ISSUER"] = ""
os.environ["OIDC_CLIENT_ID"] = ""
os.environ["OIDC_CLIENT_SECRET"] = ""


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)

    # Re-import with patched settings is tricky; create tables on a fresh engine
    from app import models  # noqa: F401
    from app.config import settings
    from app.database import Base, get_db, register_activity_listener
    from app.main import app

    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")

    engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    register_activity_listener()

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
