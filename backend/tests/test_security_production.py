"""Production security settings and auth hardening."""

from __future__ import annotations

import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE
from app.config import INSECURE_DEFAULT_X_LOCALE_SECRET, Settings


def test_validate_for_runtime_rejects_default_secret_when_not_bypass(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "false")
    monkeypatch.setenv("OIDC_ISSUER", "")
    monkeypatch.setenv("OIDC_CLIENT_ID", "")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "")
    monkeypatch.setenv("X_LOCALE_SECRET", INSECURE_DEFAULT_X_LOCALE_SECRET)
    loaded = Settings()
    with pytest.raises(RuntimeError, match="X_LOCALE_SECRET"):
        loaded.validate_for_runtime()


def test_validate_for_runtime_allows_bypass(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("X_LOCALE_SECRET", INSECURE_DEFAULT_X_LOCALE_SECRET)
    loaded = Settings()
    loaded.validate_for_runtime()


def test_api_key_query_string_rejected(client, monkeypatch):
    from app.config import settings

    pid = client.post("/api/projects", json={"name": "Q", "target_languages": ["en"]}).json()["id"]
    raw = client.post(f"/api/projects/{pid}/api-keys", json={"name": "k"}).json()["key"]
    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    r = client.get(f"/api/projects/{pid}/strings?api_key={raw}")
    assert r.status_code == 401
    ok = client.get(f"/api/projects/{pid}/strings", headers={"X-API-Key": raw})
    assert ok.status_code == 200


def test_logout_revokes_session_token(client):
    login = client.get("/api/auth/login", follow_redirects=False)
    cookie = login.cookies.get(SESSION_COOKIE)
    assert cookie
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    r = client.get("/api/auth/me", cookies={SESSION_COOKIE: cookie})
    assert r.status_code == 401


def test_project_rejects_invalid_locale(client):
    r = client.post(
        "/api/projects",
        json={"name": "Bad", "base_language": "../vi", "target_languages": ["en"]},
    )
    assert r.status_code == 400


def test_seed_demo_exits_when_bypass_off(monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "false")
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "seed-demo"],
        cwd="/workspace/backend",
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "AUTH_DEV_BYPASS" in result.stderr + result.stdout


def test_openapi_hidden_when_oidc_configured():
    import os

    env = os.environ.copy()
    env["DATABASE_URL"] = "sqlite://"
    env["AUTH_DEV_BYPASS"] = "false"
    env["X_LOCALE_SECRET"] = "prod-test-secret-value"
    env["OIDC_ISSUER"] = "https://login.example.test/tenant/v2.0"
    env["OIDC_CLIENT_ID"] = "client"
    env["OIDC_CLIENT_SECRET"] = "secret"
    env["OIDC_REDIRECT_URL"] = "https://app.example.com/api/auth/callback"
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.main import app; print(app.openapi_url)",
        ],
        cwd="/workspace/backend",
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "None"
