"""Production security settings and auth hardening."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.auth import SESSION_COOKIE
from app.config import INSECURE_DEFAULT_X_LOCALE_SECRET, Settings

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


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


def _seed_env(**overrides: str) -> dict[str, str]:
    env = os.environ.copy()
    env["AUTH_DEV_BYPASS"] = "false"
    env["OIDC_ISSUER"] = ""
    env["OIDC_CLIENT_ID"] = ""
    env["OIDC_CLIENT_SECRET"] = ""
    env.pop("ENV", None)
    env.update(overrides)
    return env


def _run_seed(env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "seed-demo", *args],
        cwd=_BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )


def _key_count(env: dict[str, str]) -> int:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    from app.auth import hash_api_key

    engine = create_engine(env["DATABASE_URL"], poolclass=NullPool)
    try:
        with engine.connect() as conn:
            count = conn.execute(
                text("SELECT count(*) FROM api_keys WHERE key_hash = :digest"),
                {"digest": hash_api_key(env["X_LOCALE_DEMO_API_KEY"])},
            ).scalar()
    finally:
        engine.dispose()
    return int(count or 0)


def test_seed_demo_runs_when_bypass_is_off():
    """A fresh clone seeds. Dev User login still requires the bypass."""
    env = _seed_env()
    result = _run_seed(env)
    assert result.returncode == 0, result.stderr
    assert "Demo project ready" in result.stdout
    assert "AUTH_DEV_BYPASS" not in result.stderr


def test_seed_demo_refuses_when_oidc_is_configured_unless_allowed():
    env = _seed_env(
        OIDC_ISSUER="https://login.example.test/tenant/v2.0",
        OIDC_CLIENT_ID="client",
        OIDC_CLIENT_SECRET="secret",
    )
    before = _key_count(env)
    refused = _run_seed(env)
    assert refused.returncode == 1
    assert "OIDC is configured" in refused.stderr
    assert "Demo project ready" not in refused.stdout
    assert _key_count(env) == before
    forced = _run_seed(env, "--force")
    assert forced.returncode == 1
    assert "Demo project ready" not in forced.stdout
    assert _key_count(env) == before
    allowed = _run_seed(env, "--allow-production")
    assert allowed.returncode == 0, allowed.stderr
    assert "Demo project ready" in allowed.stdout


def test_seed_demo_refuses_in_production_unless_allowed():
    default_key = Settings.model_fields["x_locale_demo_api_key"].default
    env = _seed_env(ENV="production", X_LOCALE_DEMO_API_KEY=str(default_key))
    before = _key_count(env)
    refused = _run_seed(env)
    assert refused.returncode == 1
    assert "ENV=production" in refused.stderr
    assert "Demo project ready" not in refused.stdout
    assert _key_count(env) == before
    forced = _run_seed(env, "--force")
    assert forced.returncode == 1
    assert _key_count(env) == before
    allowed = _run_seed(env, "--allow-production")
    assert allowed.returncode == 0, allowed.stderr
    assert _key_count(env) == before + 1


def test_seed_demo_force_recreates_demo_app():
    env = _seed_env()
    ready = _run_seed(env)
    assert ready.returncode == 0, ready.stderr
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    engine = create_engine(env["DATABASE_URL"], poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(text("UPDATE projects SET name = 'Renamed Demo' WHERE slug = 'demo-app'"))
        with engine.connect() as conn:
            kept_name = conn.execute(
                text("SELECT name FROM projects WHERE slug = 'demo-app'")
            ).scalar()
    finally:
        engine.dispose()
    assert kept_name == "Renamed Demo"
    kept = _run_seed(env)
    assert kept.returncode == 0, kept.stderr
    engine = create_engine(env["DATABASE_URL"], poolclass=NullPool)
    try:
        with engine.connect() as conn:
            still = conn.execute(text("SELECT name FROM projects WHERE slug = 'demo-app'")).scalar()
    finally:
        engine.dispose()
    assert still == "Renamed Demo"
    forced = _run_seed(env, "--force")
    assert forced.returncode == 0, forced.stderr
    engine = create_engine(env["DATABASE_URL"], poolclass=NullPool)
    try:
        with engine.connect() as conn:
            restored = conn.execute(
                text("SELECT name FROM projects WHERE slug = 'demo-app'")
            ).scalar()
    finally:
        engine.dispose()
    assert restored == "Demo App"


def test_production_env_in_dotenv_file_refuses_seed(tmp_path, monkeypatch):
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.setenv("OIDC_ISSUER", "")
    monkeypatch.setenv("OIDC_CLIENT_ID", "")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "")
    env_file = tmp_path / "production.env"
    env_file.write_text("ENV=production\nOIDC_CLIENT_ID=\nOIDC_CLIENT_SECRET=\n", encoding="utf-8")
    loaded = Settings(_env_file=env_file)
    assert loaded.env == "production"
    from app.cli import _seed_demo_refused

    assert _seed_demo_refused(loaded) is True
    fresh = tmp_path / "fresh.env"
    fresh.write_text("OIDC_CLIENT_ID=\nOIDC_CLIENT_SECRET=\n", encoding="utf-8")
    assert _seed_demo_refused(Settings(_env_file=fresh)) is False


def test_e2e_setup_passes_force_only():
    root = _BACKEND_ROOT.parent
    for relative in ("e2e/global-setup.ts", "e2e/helpers/database.ts"):
        text = (root / relative).read_text(encoding="utf-8")
        assert "seed-demo --force" in text
        assert "--allow-production" not in text


def test_openapi_hidden_when_oidc_configured():
    import os

    env = os.environ.copy()
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
        cwd=_BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "None"
