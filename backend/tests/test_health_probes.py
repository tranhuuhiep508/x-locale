"""Infra probes must distinguish database outages from process failures."""

from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError, TimeoutError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.main import app


@pytest.mark.parametrize("path", ["/healthcheck/liveness", "/healthcheck/readiness"])
def test_probes_allow_unauthenticated_requests(client, monkeypatch, path):
    monkeypatch.setattr(settings, "auth_dev_bypass", False)

    response = client.get(path)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "error",
    [
        OperationalError("SELECT 1", {}, Exception("private database credentials")),
        TimeoutError("private database pool details"),
    ],
)
def test_database_failure_only_affects_readiness_and_can_recover(client, error):
    database = Mock(spec=Session)
    database.execute.side_effect = error
    app.dependency_overrides[get_db] = lambda: database

    liveness = client.get("/healthcheck/liveness")
    assert liveness.status_code == 200
    assert liveness.json() == {"status": "ok"}
    database.execute.assert_not_called()

    readiness = client.get("/healthcheck/readiness")
    assert readiness.status_code == 503
    assert readiness.json() == {"status": "not_ready"}
    assert readiness.headers["cache-control"] == "no-store"
    assert "private" not in readiness.text

    # A later successful query restores readiness without restarting the app.
    database.execute.side_effect = None
    recovered = client.get("/healthcheck/readiness")
    assert recovered.status_code == 200
    assert recovered.json() == {"status": "ok"}


def test_readiness_executes_real_database_query(client):
    original_get_db = app.dependency_overrides[get_db]

    def closed_database():
        # A real unbound SQLAlchemy session cannot execute SELECT 1.
        with Session() as database:
            yield database

    app.dependency_overrides[get_db] = closed_database
    assert client.get("/healthcheck/readiness").status_code == 503

    app.dependency_overrides[get_db] = original_get_db
    assert client.get("/healthcheck/readiness").status_code == 200
