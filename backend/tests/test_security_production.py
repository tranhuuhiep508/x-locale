"""Production security settings and auth hardening."""

from __future__ import annotations

import json
import os
import secrets
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


@pytest.mark.parametrize(
    "secret",
    ["", " ", "change-me", INSECURE_DEFAULT_X_LOCALE_SECRET,
     "REPLACE_WITH_A_LONG_RANDOM_SIGNING_SECRET", "x" * 31, "é" * 15],
)
def test_runtime_rejects_insecure_signing_secrets(secret):
    loaded = Settings(x_locale_secret=secret, auth_dev_bypass=False, _env_file=None)
    with pytest.raises(RuntimeError, match="X_LOCALE_SECRET") as error:
        loaded.validate_for_runtime()
    if len(secret) > 4:
        assert secret not in str(error.value)


# Fixed id: xdist workers must collect identical test names, and the value is random.
@pytest.mark.parametrize(
    "secret", ["x" * 32, "é" * 16, pytest.param(secrets.token_urlsafe(32), id="token_urlsafe")]
)
def test_runtime_accepts_long_signing_secrets(secret):
    Settings(x_locale_secret=secret, auth_dev_bypass=False, _env_file=None).validate_for_runtime()


def test_example_env_is_rejected_without_dev_bypass(monkeypatch):
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    loaded = Settings(_env_file=_BACKEND_ROOT.parent / ".env.example")
    assert not loaded.dev_bypass_active
    with pytest.raises(RuntimeError, match="X_LOCALE_SECRET"):
        loaded.validate_for_runtime()


def test_oidc_disables_bypass_for_secret_validation():
    loaded = Settings(
        x_locale_secret="change-me",
        auth_dev_bypass=True,
        oidc_issuer="https://issuer.example.com",
        oidc_client_id="client",
        oidc_client_secret="client-secret",
        _env_file=None,
    )
    with pytest.raises(RuntimeError, match="X_LOCALE_SECRET"):
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
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "seed-demo", *args],
        cwd=_BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    for line in result.stdout.splitlines():
        assert json.loads(line)["event.dataset"] == "application"
    return result


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
    assert refused.stderr == ""
    assert "OIDC is configured" in json.loads(refused.stdout)["message"]
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
    assert refused.stderr == ""
    assert "ENV=production" in json.loads(refused.stdout)["message"]
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
    env["X_LOCALE_SECRET"] = "prod-test-secret-value-at-least-32-bytes"
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


@pytest.mark.parametrize("cors_origins", ["*", " * ", "https://app.example.com, *"])
@pytest.mark.parametrize("auth_dev_bypass", [False, True])
def test_runtime_rejects_wildcard_cors_origins(cors_origins, auth_dev_bypass):
    loaded = Settings(
        x_locale_secret="prod-test-secret-value-at-least-32-bytes",
        auth_dev_bypass=auth_dev_bypass,
        cors_origins=cors_origins,
        _env_file=None,
    )
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        loaded.validate_for_runtime()


@pytest.mark.parametrize("cors_origins", ["", "https://app.example.com"])
def test_runtime_accepts_non_wildcard_cors_origins(cors_origins):
    Settings(
        x_locale_secret="prod-test-secret-value-at-least-32-bytes",
        auth_dev_bypass=False,
        cors_origins=cors_origins,
        _env_file=None,
    ).validate_for_runtime()


def _setup_csrf_fixture(client, monkeypatch):
    from app.config import settings

    login = client.get("/api/auth/login", follow_redirects=False)
    cookie = login.cookies.get(SESSION_COOKIE)
    assert cookie

    project = client.post(
        "/api/projects",
        json={"name": "CsrfApp", "target_languages": ["en"]},
    ).json()
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hello", "source_text": "Xin chao"},
    ).json()
    sid = created["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Xin chao 2"},
    )
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"batch_key": "Batch value"}},
    ).json()
    batch_id = imported["batch_id"]
    activities = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
    activity_id = activities[0]["id"]
    raw_key = client.post(f"/api/projects/{pid}/api-keys", json={"name": "cli"}).json()["key"]

    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    return {
        "cookie": cookie,
        "pid": pid,
        "sid": sid,
        "activity_id": activity_id,
        "batch_id": batch_id,
        "api_key": raw_key,
    }


@pytest.mark.parametrize(
    "headers",
    [
        {"Sec-Fetch-Site": "same-site", "Origin": "http://other.testserver"},
        {"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
    ],
)
def test_csrf_rejects_cross_and_same_site_cookie_writes(client, monkeypatch, headers):
    from app.csrf import CSRF_FORBIDDEN_DETAIL

    fx = _setup_csrf_fixture(client, monkeypatch)
    pid, sid, activity_id, batch_id = fx["pid"], fx["sid"], fx["activity_id"], fx["batch_id"]

    import_resp = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b'{"injected": "evil"}', "application/json")},
        headers=headers,
    )
    assert import_resp.status_code == 403
    assert import_resp.json()["detail"] == CSRF_FORBIDDEN_DETAIL
    keys = {row["key"] for row in client.get(f"/api/projects/{pid}/strings").json()["items"]}
    assert "injected" not in keys

    logout_resp = client.post("/api/auth/logout", headers=headers)
    assert logout_resp.status_code == 403
    assert client.get("/api/auth/me").status_code == 200

    for path in (
        f"/api/projects/{pid}/activities/{activity_id}/revert",
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        f"/api/projects/{pid}/strings/{sid}/activities/{activity_id}/restore",
    ):
        resp = client.post(path, headers=headers)
        assert resp.status_code == 403, path

    delete_resp = client.delete(f"/api/projects/{pid}/strings/{sid}", headers=headers)
    assert delete_resp.status_code == 403
    assert client.get(f"/api/projects/{pid}/strings/{sid}").status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example"},
        {"Origin": "null"},
        {"Referer": "https://evil.example/form"},
    ],
)
def test_csrf_rejects_mismatched_origin_or_referer_without_fetch_metadata(
    client, monkeypatch, headers
):
    fx = _setup_csrf_fixture(client, monkeypatch)
    resp = client.post("/api/auth/logout", headers=headers)
    assert resp.status_code == 403
    assert client.get("/api/auth/me").status_code == 200
    assert fx["cookie"] == client.cookies.get(SESSION_COOKIE)


def test_csrf_allows_same_origin_and_explicit_cors_and_oidc_origin(client, monkeypatch):
    from app.config import settings

    fx = _setup_csrf_fixture(client, monkeypatch)
    pid = fx["pid"]

    # Same-origin Sec-Fetch-Site is allowed even behind a TLS/Vite proxy Origin difference.
    r1 = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b'{"k1": "v1"}', "application/json")},
        headers={"Sec-Fetch-Site": "same-origin", "Origin": "https://x-locale.company.com"},
    )
    assert r1.status_code == 200, r1.text

    # Without Sec-Fetch-Site, matching request Origin is allowed.
    r2 = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b'{"k2": "v2"}', "application/json")},
        headers={"Origin": "http://testserver"},
    )
    assert r2.status_code == 200, r2.text

    # Explicit CORS_ORIGINS allows cross-site/same-site writes from that configured origin.
    monkeypatch.setattr(settings, "cors_origins", "https://ui.example.com")
    r3 = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b'{"k3": "v3"}', "application/json")},
        headers={"Sec-Fetch-Site": "same-site", "Origin": "https://ui.example.com"},
    )
    assert r3.status_code == 200, r3.text
    monkeypatch.setattr(settings, "cors_origins", "")

    # Without Sec-Fetch-Site, configured OIDC redirect origin is allowed behind TLS proxies.
    monkeypatch.setattr(settings, "oidc_issuer", "https://login.example.test/tenant/v2.0")
    monkeypatch.setattr(settings, "oidc_client_id", "client")
    monkeypatch.setattr(settings, "oidc_client_secret", "secret")
    monkeypatch.setattr(
        settings, "oidc_redirect_url", "https://x-locale.company.com/api/auth/callback"
    )
    r4 = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b'{"k4": "v4"}', "application/json")},
        headers={"Origin": "https://x-locale.company.com"},
    )
    assert r4.status_code == 200, r4.text

    # Safe GET requests are never blocked even with cross-site Sec-Fetch-Site.
    assert (
        client.get(
            f"/api/projects/{pid}/strings",
            headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
        ).status_code
        == 200
    )


def test_csrf_allows_api_key_writes_without_session_cookie(client, monkeypatch):
    fx = _setup_csrf_fixture(client, monkeypatch)
    pid, api_key = fx["pid"], fx["api_key"]
    client.cookies.clear()

    cross_headers = {
        "X-API-Key": api_key,
        "Sec-Fetch-Site": "cross-site",
        "Origin": "https://other.example",
    }
    r1 = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b'{"cli_file": "ok"}', "application/json")},
        headers=cross_headers,
    )
    assert r1.status_code == 200, r1.text

    r2 = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"cli_json": "ok"}},
        headers=cross_headers,
    )
    assert r2.status_code == 200, r2.text
