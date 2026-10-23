"""Auth, session cookies, and API key management integration tests."""

from __future__ import annotations

import uuid

import pytest

from tests.helpers import _make_project


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_me_dev_bypass(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "dev@localhost"


def test_login_sets_x_locale_session_cookie(client):
    from app.auth import SESSION_COOKIE

    assert SESSION_COOKIE == "x_locale_session"
    r = client.get("/api/auth/login", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers.get("location") == "/"
    cookie = r.headers.get("set-cookie", "")
    assert f"{SESSION_COOKIE}=" in cookie
    assert "tms_session=" not in cookie
    assert "httponly" in cookie.lower()


def test_auth_me_unauthorized_without_bypass(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_login_503_when_neither_bypass_nor_oidc(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    r = client.get("/api/auth/login", follow_redirects=False)
    assert r.status_code == 503


def test_bypass_skipped_when_oidc_configured(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "oidc_issuer", "https://login.microsoftonline.com/common/v2.0")
    monkeypatch.setattr(settings, "oidc_client_id", "test-client")
    monkeypatch.setattr(settings, "oidc_client_secret", "test-secret")
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_create_project_and_string(client):
    r = client.post(
        "/api/projects",
        json={
            "name": "Test App",
            "base_language": "vi",
            "target_languages": ["en"],
            "layout": "modular",
        },
    )
    assert r.status_code == 201, r.text
    project = r.json()
    assert project["slug"] == "test-app"
    assert project["base_language"] == "vi"
    pid = project["id"]

    # Create module
    r = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
    )
    assert r.status_code == 201, r.text
    module = r.json()

    # Create string
    r = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "module_id": module["id"],
        },
    )
    assert r.status_code == 201, r.text
    string = r.json()
    assert string["key"] == "save"
    assert string["status"] == "draft"
    assert len(string["translations"]) == 1
    assert string["translations"][0]["locale"] == "en"

    # Upsert translation (value only; does not change string status)
    r = client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/en",
        json={"value": "Save"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["translations"][0]["value"] == "Save"
    assert r.json()["status"] == "draft"

    # Publish string
    r = client.patch(
        f"/api/projects/{pid}/strings/{string['id']}",
        json={"status": "public"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "public"

    # List strings
    r = client.get(f"/api/projects/{pid}/strings")
    assert r.status_code == 200
    assert r.json()["total"] == 1

    # Export flat public
    r = client.get(f"/api/projects/{pid}/export?layout=flat&stage=public")
    assert r.status_code == 200
    data = r.json()
    assert "en" in data
    assert data["en"]["save"] == "Save"
    assert data["vi"]["save"] == "Lưu"

    # Activities recorded
    r = client.get(f"/api/projects/{pid}/activities")
    assert r.status_code == 200
    assert r.json()["total"] >= 1


@pytest.mark.parametrize("endpoint", ["strings", "export", "bootstrap"])
def test_api_key_reads_persist_last_used(client, session_factory, endpoint):
    from datetime import UTC, datetime

    from app.models import ApiKey

    r = client.post(
        "/api/projects",
        json={"name": "Keyed", "target_languages": ["en"]},
    )
    assert r.status_code == 201
    pid = r.json()["id"]

    r = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "ci"},
    )
    assert r.status_code == 201, r.text
    raw_key = r.json()["key"]
    key_id = uuid.UUID(r.json()["id"])
    assert raw_key.startswith("xlocale_")

    with session_factory() as db:
        assert db.get(ApiKey, key_id).last_used_at is None

    before = datetime.now(UTC)
    r = client.get(
        "/api/bootstrap" if endpoint == "bootstrap" else f"/api/projects/{pid}/{endpoint}",
        headers={"X-API-Key": raw_key},
    )
    assert r.status_code == 200, r.text
    with session_factory() as db:
        first_used = db.get(ApiKey, key_id).last_used_at
        assert first_used is not None
        assert first_used >= before

    r = client.get("/api/bootstrap", headers={"X-API-Key": raw_key})
    assert r.status_code == 200, r.text
    with session_factory() as db:
        assert db.get(ApiKey, key_id).last_used_at > first_used


@pytest.mark.parametrize("endpoint", ["bootstrap", "export"])
def test_api_key_auth_with_one_connection(
    client, database_engine, session_factory, monkeypatch, endpoint
):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app import database
    from app.models import ApiKey

    project = _make_project(client, "One connection")
    response = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "ci"})
    assert response.status_code == 201, response.text
    key = response.json()
    engine = create_engine(database_engine.url, pool_size=1, max_overflow=0, pool_timeout=0.2)
    monkeypatch.setattr(
        database, "SessionLocal", sessionmaker(bind=engine, autoflush=False, autocommit=False)
    )
    try:
        url = "/api/bootstrap" if endpoint == "bootstrap" else f"/api/projects/{project['id']}/export"
        response = client.get(url, headers={"X-API-Key": key["key"]})
        assert response.status_code == 200, response.text
        with session_factory() as db:
            assert db.get(ApiKey, uuid.UUID(key["id"])).last_used_at is not None
    finally:
        engine.dispose()


def test_api_key_usage_does_not_commit_content(client, session_factory):
    from app.auth import _resolve_api_key
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey, Project

    project = _make_project(client, "Usage transaction")
    response = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "ci"})
    assert response.status_code == 201, response.text
    key = response.json()
    project_id = uuid.UUID(project["id"])
    request_db = app.dependency_overrides[get_db]()
    db = next(request_db)
    try:
        stored_project = db.get(Project, project_id)
        stored_project.name = "Must roll back"
        db.flush()
        _resolve_api_key(db, key["key"])
    finally:
        request_db.close()

    with session_factory() as db:
        assert db.get(Project, project_id).name == "Usage transaction"
        assert db.get(ApiKey, uuid.UUID(key["id"])).last_used_at is not None


@pytest.mark.parametrize("revoke", [False, True])
def test_late_usage_cleanup_preserves_newer_state(client, session_factory, revoke):
    from app.auth import _resolve_api_key
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey

    project = _make_project(client, "Late usage")
    response = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "ci"})
    assert response.status_code == 201, response.text
    key = response.json()
    request_db = app.dependency_overrides[get_db]()
    db = next(request_db)
    try:
        _resolve_api_key(db, key["key"])
        if revoke:
            response = client.delete(f"/api/projects/{project['id']}/api-keys/{key['id']}")
            assert response.status_code == 204, response.text
        else:
            response = client.get("/api/bootstrap", headers={"X-API-Key": key["key"]})
            assert response.status_code == 200, response.text
        with session_factory() as check_db:
            latest_usage = check_db.get(ApiKey, uuid.UUID(key["id"])).last_used_at
    finally:
        request_db.close()

    with session_factory() as db:
        stored = db.get(ApiKey, uuid.UUID(key["id"]))
        assert stored.last_used_at == latest_usage
        assert (stored.revoked_at is not None) == revoke


def test_usage_write_failure_preserves_client_status(client, session_factory, monkeypatch, caplog):
    import logging

    from sqlalchemy.orm import Session

    from app import database
    from app.models import ApiKey

    project = _make_project(client, "Usage failure")
    created = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "ci"})
    assert created.status_code == 201, created.text
    raw_key = created.json()["key"]
    key_id = uuid.UUID(created.json()["id"])
    headers = {"X-API-Key": raw_key}

    class FailingUsageSession(Session):
        def execute(self, statement, *args, **kwargs):
            raise RuntimeError("usage write failed")

    monkeypatch.setattr(database, "Session", FailingUsageSession)
    # Alembic's fileConfig disables loggers that already exist. Turn this one back on.
    usage_logger = logging.getLogger("app.database")
    usage_logger.disabled = False
    caplog.set_level(logging.WARNING, logger="app.database")

    missing = client.get(f"/api/jobs/{uuid.uuid4()}", headers=headers)
    assert missing.status_code == 404, missing.text
    forbidden = client.get(f"/api/projects/{project['id']}/members", headers=headers)
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["detail"] == "API keys cannot perform this action"

    with session_factory() as db:
        assert db.get(ApiKey, key_id).last_used_at is None
    assert caplog.text.count("Failed to persist API key last_used_at") == 2


def test_authenticated_key_records_usage_on_forbidden_and_missing(client, session_factory):
    from app.models import ApiKey

    project = _make_project(client, "Counted denial")
    created = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "ci"})
    assert created.status_code == 201, created.text
    raw_key = created.json()["key"]
    key_id = uuid.UUID(created.json()["id"])
    headers = {"X-API-Key": raw_key}

    with session_factory() as db:
        assert db.get(ApiKey, key_id).last_used_at is None

    forbidden = client.get(f"/api/projects/{project['id']}/members", headers=headers)
    assert forbidden.status_code == 403, forbidden.text
    with session_factory() as db:
        after_forbidden = db.get(ApiKey, key_id).last_used_at
        assert after_forbidden is not None

    missing = client.get(f"/api/jobs/{uuid.uuid4()}", headers=headers)
    assert missing.status_code == 404, missing.text
    with session_factory() as db:
        assert db.get(ApiKey, key_id).last_used_at > after_forbidden


def test_invalid_and_revoked_keys_do_not_record_usage(client, session_factory):
    from app.models import ApiKey

    project = _make_project(client, "Rejected usage")
    response = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "ci"})
    assert response.status_code == 201, response.text
    key = response.json()
    response = client.delete(f"/api/projects/{project['id']}/api-keys/{key['id']}")
    assert response.status_code == 204, response.text
    for raw_key in ("invalid-key", key["key"]):
        response = client.get("/api/bootstrap", headers={"X-API-Key": raw_key})
        assert response.status_code == 401, response.text
    with session_factory() as db:
        assert db.get(ApiKey, uuid.UUID(key["id"])).last_used_at is None


def test_api_key_write_activity_uses_key_not_owner(client):
    pid = _make_project(client, "Keyed Owner")["id"]
    created_key = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "alice-laptop"},
    )
    assert created_key.status_code == 201, created_key.text
    raw_key = created_key.json()["key"]
    key_id = created_key.json()["id"]

    r = client.post(
        f"/api/projects/{pid}/strings/import",
        headers={"X-API-Key": raw_key},
        json={"strings": {"hello": "Xin chào"}},
    )
    assert r.status_code == 200, r.text

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    created = [
        a for a in items if a["action"] == "create" and a["entity_type"] == "string"
    ]
    assert created
    assert created[0]["actor_type"] == "api_key"
    assert created[0]["actor_label"] == "alice-laptop"
    assert created[0]["actor_id"] == key_id


def test_generate_api_key_revokes_previous_personal_key(client):
    pid = _make_project(client, "Keyed Rotate")["id"]
    first = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "first"},
    )
    assert first.status_code == 201, first.text
    old_key = first.json()["key"]
    assert old_key.startswith("xlocale_")
    assert not old_key.startswith("tms_")

    second = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "second"},
    )
    assert second.status_code == 201, second.text
    new_key = second.json()["key"]
    assert new_key.startswith("xlocale_")
    assert new_key != old_key

    stale = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": old_key},
    )
    assert stale.status_code == 401

    fresh = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": new_key},
    )
    assert fresh.status_code == 200

    listed = client.get(f"/api/projects/{pid}/api-keys").json()
    assert len(listed) == 1
    assert listed[0]["name"] == "second"


def test_generate_api_key_does_not_revoke_unowned_key(client):
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey

    pid = _make_project(client, "Keyed Keep Demo")["id"]
    r = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "github-actions"},
    )
    assert r.status_code == 201, r.text
    unowned_key = r.json()["key"]
    unowned_id = r.json()["id"]

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        key = db.query(ApiKey).filter(ApiKey.id == uuid.UUID(unowned_id)).first()
        assert key is not None
        key.created_by = None
        db.commit()
    finally:
        db_gen.close()

    personal = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "dev@localhost"},
    )
    assert personal.status_code == 201, personal.text

    still_valid = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": unowned_key},
    )
    assert still_valid.status_code == 200

    listed = client.get(f"/api/projects/{pid}/api-keys").json()
    names = {k["name"] for k in listed}
    assert names == {"github-actions", "dev@localhost"}


def test_api_key_write_activity_without_owner(client):
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey

    pid = _make_project(client, "Keyed CI")["id"]
    r = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "github-actions"},
    )
    assert r.status_code == 201, r.text
    raw_key = r.json()["key"]
    key_id = r.json()["id"]

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        key = db.query(ApiKey).filter(ApiKey.id == uuid.UUID(key_id)).first()
        assert key is not None
        key.created_by = None
        db.commit()
    finally:
        db_gen.close()

    r = client.post(
        f"/api/projects/{pid}/strings/import",
        headers={"X-API-Key": raw_key},
        json={"strings": {"bye": "Tạm biệt"}},
    )
    assert r.status_code == 200, r.text

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    created = [
        a for a in items if a["action"] == "create" and a["entity_type"] == "string"
    ]
    assert created
    assert created[0]["actor_type"] == "api_key"
    assert created[0]["actor_label"] == "github-actions"

