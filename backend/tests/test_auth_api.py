"""Auth, session cookies, and API key management integration tests."""

from __future__ import annotations

import uuid

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


def test_api_key_auth(client):
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
    assert raw_key.startswith("xlocale_")

    r = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": raw_key},
    )
    assert r.status_code == 200


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

