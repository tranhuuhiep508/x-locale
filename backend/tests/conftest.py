"""Backend test fixtures."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Use in-memory SQLite for tests before app imports engine
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["AUTH_DEV_BYPASS"] = "true"
os.environ["TMS_SECRET"] = "test-secret"
os.environ["TMS_DEMO_API_KEY"] = "test-demo-key"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)

    # Re-import with patched settings is tricky; create tables on a fresh engine
    from app.database import Base, get_db
    from app import models  # noqa: F401
    from app.main import app
    from app.database import register_activity_listener

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
