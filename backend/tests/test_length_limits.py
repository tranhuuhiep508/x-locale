"""Reject user input that would overflow a varchar, before Postgres returns 500."""

from __future__ import annotations

import io
import os
import uuid

import pytest
from alembic.config import Config
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine, text

from alembic import command
from app.config import settings
from app.excel import FLAT_SHEET
from app.helpers import validate_locale_code
from app.main import app
from app.models import Project
from app.services.activities import _apply_published_snapshot, _apply_working_copy_only
from tests.helpers import json_upload, make_project

LONG_KEY = "k" * 513
MAX_KEY = "k" * 512
KEY_PREVIEW = "k" * 40
LONG_SLUG = "a" * 129
LONG_LOCALE = "a" * 17
REGEX_MAX_LOCALE = "abc-12345678"

_MISMATCH_DBS = [pytest.param("sqlite", id="sqlite")]
if os.environ.get("TEST_DATABASE_URL", "").strip():
    _MISMATCH_DBS.append(pytest.param("postgres", marks=pytest.mark.postgres, id="postgres"))

on_each_database = pytest.mark.parametrize("api", _MISMATCH_DBS, indirect=True)


@pytest.fixture
def api(request):
    """SQLite client, plus the Postgres client when this run can reach it."""
    if getattr(request, "param", "sqlite") == "postgres":
        client, _session_factory = request.getfixturevalue("pg_session")
        return client
    return request.getfixturevalue("client")


def _set_target_languages(project_id: str, locales: list[str]) -> None:
    from app.database import get_db

    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        row = db.get(Project, uuid.UUID(project_id))
        assert row is not None
        row.target_languages = locales
        db.commit()
    finally:
        generator.close()


def test_validate_locale_code_accepts_regex_maximum():
    assert validate_locale_code(REGEX_MAX_LOCALE) == REGEX_MAX_LOCALE
    assert len(REGEX_MAX_LOCALE) == 12


@on_each_database
def test_project_locale_over_column_limit_is_400(api):
    response = api.post(
        "/api/projects",
        json={
            "name": "Too long locale",
            "base_language": LONG_LOCALE,
            "target_languages": ["en"],
            "layout": "flat",
        },
    )
    assert response.status_code == 400, response.text
    assert "locale" in response.text
    assert "16" in response.text


def test_project_accepts_locale_longer_than_the_old_varchar_10(client):
    response = client.post(
        "/api/projects",
        json={
            "name": "Wide locale",
            "base_language": REGEX_MAX_LOCALE,
            "target_languages": ["en-abcdefgh"],
            "layout": "flat",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["base_language"] == REGEX_MAX_LOCALE
    assert "en-abcdefgh" in body["target_languages"]


@on_each_database
def test_string_update_rejects_key_over_512(api):
    project = make_project(api, layout="flat")
    created = api.post(
        f"/api/projects/{project['id']}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
    )
    assert created.status_code == 201, created.text
    updated = api.patch(
        f"/api/projects/{project['id']}/strings/{created.json()['id']}",
        json={"key": LONG_KEY},
    )
    assert updated.status_code == 422, updated.text
    assert "key" in updated.text
    assert "512" in updated.text


@on_each_database
def test_import_and_push_reject_key_over_512(api):
    project = make_project(api, layout="flat")
    pid = project["id"]
    uploaded = api.post(
        f"/api/projects/{pid}/import",
        files=json_upload({LONG_KEY: "Xin chào"}),
    )
    assert uploaded.status_code == 400, uploaded.text
    assert KEY_PREVIEW in uploaded.text
    assert "513 chars" in uploaded.text
    assert "512" in uploaded.text

    pushed = api.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {LONG_KEY: "Xin chào"}, "base_language": "vi"},
    )
    assert pushed.status_code == 400, pushed.text
    assert KEY_PREVIEW in pushed.text
    assert "513 chars" in pushed.text
    assert "512" in pushed.text
    assert api.get(f"/api/projects/{pid}/strings").json()["total"] == 0


def test_import_stores_512_character_key_and_activity_summary(client):
    project = make_project(client, layout="flat")
    pid = project["id"]
    uploaded = client.post(
        f"/api/projects/{pid}/import",
        files=json_upload({MAX_KEY: "Xin chào"}),
    )
    assert uploaded.status_code == 200, uploaded.text
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"]
    assert stored[0]["key"] == MAX_KEY
    activities = client.get(f"/api/projects/{pid}/activities").json()["items"]
    summaries = [item["summary"] for item in activities]
    assert any(MAX_KEY in summary for summary in summaries)


@on_each_database
def test_module_slug_update_rejects_over_128(api):
    project = make_project(api)
    created = api.post(
        f"/api/projects/{project['id']}/modules",
        json={"slug": "auth", "name": "Auth"},
    )
    assert created.status_code == 201, created.text
    updated = api.patch(
        f"/api/projects/{project['id']}/modules/{created.json()['id']}",
        json={"slug": LONG_SLUG},
    )
    assert updated.status_code == 422, updated.text
    assert "slug" in updated.text
    assert "128" in updated.text


@on_each_database
def test_module_name_update_rejects_over_255(api):
    project = make_project(api)
    created = api.post(
        f"/api/projects/{project['id']}/modules",
        json={"slug": "auth", "name": "Auth"},
    )
    updated = api.patch(
        f"/api/projects/{project['id']}/modules/{created.json()['id']}",
        json={"name": "n" * 256},
    )
    assert updated.status_code == 422, updated.text
    assert "name" in updated.text
    assert "255" in updated.text


def test_push_rejects_module_slug_over_128(client):
    project = make_project(client)
    pushed = client.post(
        f"/api/projects/{project['id']}/strings/import",
        json={
            "base_language": "vi",
            "modules": {LONG_SLUG: {"vi": {"hello": "Xin chào"}}},
        },
    )
    assert pushed.status_code == 400, pushed.text
    assert "module slug" in pushed.text
    assert "128" in pushed.text


@on_each_database
def test_tag_update_rejects_name_and_color_over_limit(api):
    project = make_project(api, layout="flat")
    created = api.post(
        f"/api/projects/{project['id']}/tags",
        json={"name": "ui", "color": "#112233"},
    )
    assert created.status_code == 201, created.text
    tag_id = created.json()["id"]
    root = f"/api/projects/{project['id']}/tags/{tag_id}"

    renamed = api.patch(root, json={"name": "t" * 129})
    assert renamed.status_code == 422, renamed.text
    assert "name" in renamed.text
    assert "128" in renamed.text

    recolored = api.patch(root, json={"color": "c" * 33})
    assert recolored.status_code == 422, recolored.text
    assert "color" in recolored.text
    assert "32" in recolored.text


def _xlsx(rows: list[list[str]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = FLAT_SHEET
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_excel_import_rejects_long_key_and_tag_name(client):
    project = make_project(client, layout="flat")
    pid = project["id"]
    content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    long_key = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("keys.xlsx", _xlsx([["key", "vi"], [LONG_KEY, "Xin chào"]]), content_type)},
    )
    assert long_key.status_code == 400, long_key.text
    assert f"Sheet {FLAT_SHEET!r} row 2" in long_key.text
    assert KEY_PREVIEW in long_key.text
    assert "513 chars" in long_key.text
    assert "512" in long_key.text

    long_tag = client.post(
        f"/api/projects/{pid}/import",
        files={
            "file": (
                "tags.xlsx",
                _xlsx([["key", "tags", "vi"], ["hello", "t" * 129, "Xin chào"]]),
                content_type,
            )
        },
    )
    assert long_tag.status_code == 400, long_tag.text
    assert "tag name" in long_tag.text
    assert "128" in long_tag.text


def test_snapshot_apply_rejects_keys_over_512():
    entry = type("Entry", (), {"key": "ok", "published_key": None})()
    with pytest.raises(HTTPException) as published:
        _apply_published_snapshot(None, entry, {"published_key": LONG_KEY})
    assert published.value.status_code == 400
    assert "published_key" in published.value.detail
    assert "512" in published.value.detail

    working = type("Entry", (), {})()
    db = type("DB", (), {"info": {}})()
    with pytest.raises(HTTPException) as current:
        _apply_working_copy_only(
            db,
            working,
            {
                "key": LONG_KEY,
                "source_text": "x",
                "description": None,
                "module_id": None,
                "tag_ids": [],
                "translations": {},
            },
        )
    assert current.value.status_code == 400
    assert "key" in current.value.detail
    assert "512" in current.value.detail


def test_legacy_underscore_locale_still_creates_imports_and_pushes(client):
    rejected = client.post(
        "/api/projects",
        json={
            "name": "Legacy rejected at the door",
            "base_language": "vi",
            "target_languages": ["en_US"],
            "layout": "flat",
        },
    )
    assert rejected.status_code == 400, rejected.text

    project = make_project(client, layout="flat")
    pid = project["id"]
    _set_target_languages(pid, ["en_US"])

    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
    )
    assert created.status_code == 201, created.text
    assert "en_US" in {item["locale"] for item in created.json()["translations"]}

    uploaded = client.post(
        f"/api/projects/{pid}/import",
        files=json_upload({"imported": "Nhập"}),
    )
    assert uploaded.status_code == 200, uploaded.text

    pushed = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"pushed": "Đẩy"}, "base_language": "vi"},
    )
    assert pushed.status_code == 200, pushed.text

    stored = {item["key"]: item for item in client.get(f"/api/projects/{pid}/strings").json()["items"]}
    for key in ("hello", "imported", "pushed"):
        locales = {item["locale"] for item in stored[key]["translations"]}
        assert "en_US" in locales

    _set_target_languages(pid, ["a" * 17])
    overflow = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "overflow", "source_text": "Không"},
    )
    assert overflow.status_code == 400, overflow.text
    assert "locale" in overflow.text
    assert "16" in overflow.text


def test_widen_downgrade_names_rows_that_do_not_fit(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'narrow.db'}"
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO projects (id, name, slug, base_language, target_languages, layout) "
                "VALUES (:id, 'Wide', 'wide', :base, '[\"en\"]', 'flat')"
            ),
            {"id": uuid.uuid4().hex, "base": "abcdefghijk"},
        )
    with pytest.raises(
        RuntimeError,
        match=r"1 row\(s\) in projects\.base_language exceed 10 characters",
    ):
        command.downgrade(cfg, "o4f61c2d3456")
