"""Rebrand invariants: names, env, cookies, leftovers, and docs.

Left as manual QA (not asserted here): real Microsoft Entra SSO, human
DevTools cookie inspection, Docker volume migrate from old ``tms``
Postgres, PATH shadowing of ``/usr/bin/locale``, full Excel/AI translate E2E.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

FORBIDDEN_SUBSTRINGS = (
    "tms_session",
    "TMS_SECRET",
    "TMS_DEMO_API_KEY",
    "tms-cli",
    "tms_cli",
    "tms-backend",
    "tms-frontend",
    "tms-mvp",
)

SKIP_PREFIXES = (".cursor/plans/", "cli/build/")
DOT_TMS_ALLOWED = {".gitignore"}


def _is_test_path(rel: str) -> bool:
    normalized = rel.replace("\\", "/")
    name = Path(normalized).name
    return (
        "/tests/" in f"/{normalized}"
        or name.endswith(".test.ts")
        or name.endswith(".test.tsx")
    )


def test_openapi_title_is_x_locale(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    title = r.json()["info"]["title"]
    assert title == "x-locale API"
    assert "TMS" not in title


def test_login_cookie_is_x_locale_session_not_tms(client):
    from app.auth import SESSION_COOKIE

    assert SESSION_COOKIE == "x_locale_session"
    r = client.get("/api/auth/login", follow_redirects=False)
    assert r.status_code == 302
    cookie = r.headers.get("set-cookie", "")
    assert "x_locale_session=" in cookie
    assert "tms_session=" not in cookie
    assert "httponly" in cookie.lower()


def test_logout_clears_x_locale_session_not_tms(client):
    from app.auth import SESSION_COOKIE

    client.get("/api/auth/login", follow_redirects=False)
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    cookie = r.headers.get("set-cookie", "")
    assert SESSION_COOKIE in cookie
    assert "tms_session" not in cookie


def test_settings_read_x_locale_env_names(monkeypatch):
    monkeypatch.setenv("X_LOCALE_SECRET", "secret-from-env")
    monkeypatch.setenv("X_LOCALE_DEMO_API_KEY", "demo-from-env")
    from app.config import Settings

    loaded = Settings()
    assert loaded.x_locale_secret == "secret-from-env"
    assert loaded.x_locale_demo_api_key == "demo-from-env"


def test_settings_ignore_legacy_tms_env(monkeypatch):
    monkeypatch.setenv("TMS_SECRET", "legacy-secret")
    monkeypatch.setenv("TMS_DEMO_API_KEY", "legacy-demo")
    monkeypatch.delenv("X_LOCALE_SECRET", raising=False)
    monkeypatch.delenv("X_LOCALE_DEMO_API_KEY", raising=False)
    from app.config import Settings

    loaded = Settings()
    assert loaded.x_locale_secret != "legacy-secret"
    assert loaded.x_locale_demo_api_key != "legacy-demo"


def test_env_example_documents_x_locale_not_tms():
    text = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    assert "X_LOCALE_SECRET=" in text
    assert "X_LOCALE_DEMO_API_KEY=" in text
    assert "TMS_SECRET" not in text
    assert "TMS_DEMO_API_KEY" not in text
    assert "sqlite:///./x-locale.db" in text
    assert "postgresql+psycopg://xlocale:xlocale@" in text
    assert "tms.db" not in text
    assert "://tms:tms@" not in text


def test_compose_uses_xlocale_postgres_and_x_locale_env():
    dev = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "POSTGRES_USER: xlocale" in dev
    assert "POSTGRES_DB: xlocale" in dev
    assert "postgresql+psycopg://xlocale:xlocale@postgres:5432/xlocale" in dev
    assert "X_LOCALE_SECRET:" in dev
    assert "X_LOCALE_DEMO_API_KEY:" in dev
    assert "TMS_SECRET" not in dev
    assert "POSTGRES_USER: tms" not in dev

    prod = (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
    assert "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}" in prod
    assert "X_LOCALE_SECRET: ${X_LOCALE_SECRET:?set X_LOCALE_SECRET}" in prod
    assert "seed-demo" not in prod


def test_sqlite_default_filename_in_config_source():
    text = (REPO_ROOT / "backend" / "app" / "config.py").read_text(encoding="utf-8")
    assert "x-locale.db" in text
    assert "tms.db" not in text


def test_generate_api_key_uses_xlocale_prefix():
    from app.auth import generate_api_key

    raw, prefix, digest = generate_api_key()
    assert raw.startswith("xlocale_")
    assert prefix == raw[:12]
    assert not raw.startswith("tms_")
    assert digest != raw


def test_bootstrap_accepts_x_locale_demo_api_key(client):
    from app.auth import hash_api_key
    from app.config import settings
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey, Project, ProjectLayout

    raw = settings.x_locale_demo_api_key
    assert raw == "test-demo-key"

    db = next(app.dependency_overrides[get_db]())
    try:
        project = Project(
            name="Demo App",
            slug="rebrand-demo-app",
            base_language="vi",
            target_languages=["en"],
            layout=ProjectLayout.modular,
        )
        db.add(project)
        db.flush()
        db.add(
            ApiKey(
                project_id=project.id,
                name="Demo key",
                key_prefix=raw[:12],
                key_hash=hash_api_key(raw),
            )
        )
        db.commit()
        project_id = str(project.id)
    finally:
        db.close()

    r = client.get("/api/bootstrap", headers={"X-API-Key": raw})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == project_id


def test_docs_smoke_readme_and_agents():
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    agents = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
    for text in (readme, agents):
        assert "locale init" in text or "`locale`" in text or "locale <" in text
        assert "X_LOCALE_SECRET" in text
        assert "X_LOCALE_DEMO_API_KEY" in text
        assert "x_locale_session" in text or "x-locale" in text
        assert "tms init" not in text
        assert "TMS_SECRET" not in text
        assert "tms_session" not in text
    assert agents.startswith("# AGENTS.md\n\nx-locale")
    assert readme.startswith("# x-locale\n")


def _tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return [path for path in result.stdout.decode().split("\0") if path]


@pytest.mark.parametrize("needle", FORBIDDEN_SUBSTRINGS)
def test_tracked_sources_have_no_forbidden_tms_token(needle: str):
    hits: list[str] = []
    for rel in _tracked_files():
        if rel.startswith(SKIP_PREFIXES) or _is_test_path(rel):
            continue
        if needle in rel:
            hits.append(rel)
            continue
        path = REPO_ROOT / rel
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        if needle in text:
            hits.append(rel)
    assert hits == [], f"{needle!r} still appears in {hits}"


def test_tracked_sources_have_no_legacy_dot_tms_config_dir():
    hits: list[str] = []
    for rel in _tracked_files():
        if rel.startswith(SKIP_PREFIXES) or rel in DOT_TMS_ALLOWED or _is_test_path(rel):
            continue
        if "/.tms/" in f"/{rel}" or rel.startswith(".tms/"):
            hits.append(rel)
            continue
        path = REPO_ROOT / rel
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        if ".tms/" in text or ".tms`" in text or "``.tms``" in text:
            hits.append(rel)
    assert hits == [], f"legacy .tms/ config path still appears in {hits}"
