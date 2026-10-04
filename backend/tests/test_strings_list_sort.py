"""Server-side sort for GET /projects/{id}/strings (XLOCALE-36)."""

from __future__ import annotations

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, event

from alembic import command
from app.config import settings
from app.database import enable_sqlite_foreign_keys


def _project(client):
    r = client.post(
        "/api/projects",
        json={"name": "Sort App", "target_languages": ["en"]},
    )
    assert r.status_code == 201
    return r.json()["id"]


def _string(client, pid, key, source_text, **extra):
    payload = {"key": key, "source_text": source_text, **extra}
    r = client.post(f"/api/projects/{pid}/strings", json=payload)
    assert r.status_code == 201
    return r.json()


def _list(client, pid, **params):
    return client.get(f"/api/projects/{pid}/strings", params=params)


def test_list_sort_default_matches_key_asc(client):
    pid = _project(client)
    _string(client, pid, "b-key", "B")
    _string(client, pid, "a-key", "A")

    default = _list(client, pid, page_size=50).json()["items"]
    explicit = _list(
        client, pid, page_size=50, sort="key", order="asc"
    ).json()["items"]
    assert [row["id"] for row in default] == [row["id"] for row in explicit]
    assert [row["key"] for row in default] == ["a-key", "b-key"]


@pytest.mark.parametrize(
    ("sort", "order"),
    [
        ("key", "asc"),
        ("key", "desc"),
        ("source_text", "asc"),
        ("source_text", "desc"),
        ("status", "asc"),
        ("status", "desc"),
        ("updated_at", "asc"),
        ("updated_at", "desc"),
        ("updated_by_label", "asc"),
        ("updated_by_label", "desc"),
        ("created_at", "asc"),
        ("created_at", "desc"),
        ("created_by_label", "asc"),
        ("created_by_label", "desc"),
    ],
)
def test_list_sort_allowlisted_fields(client, sort, order):
    pid = _project(client)
    _string(client, pid, "z", "Zulu")
    _string(client, pid, "a", "Alpha")
    r = _list(client, pid, sort=sort, order=order, page_size=50)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 2


def test_list_sort_source_text_tie_break_by_id(client):
    pid = _project(client)
    first = _string(client, pid, "first", "Same")
    second = _string(client, pid, "second", "Same")

    asc = _list(client, pid, sort="source_text", order="asc", page_size=50).json()["items"]
    desc = _list(client, pid, sort="source_text", order="desc", page_size=50).json()["items"]

    assert [row["id"] for row in asc] == sorted([first["id"], second["id"]])
    assert [row["id"] for row in desc] == sorted([first["id"], second["id"]])


def test_list_sort_pagination_stable(client):
    pid = _project(client)
    keys = ["c", "b", "a"]
    for key in keys:
        _string(client, pid, key, key.upper())

    page1 = _list(client, pid, sort="key", order="asc", page=1, page_size=2).json()["items"]
    page2 = _list(client, pid, sort="key", order="asc", page=2, page_size=2).json()["items"]
    combined = [row["key"] for row in page1 + page2]
    assert combined == ["a", "b", "c"]


def test_list_sort_with_status_filter(client):
    pid = _project(client)
    _string(client, pid, "draft-only", "D")
    pub = _string(client, pid, "public-one", "P", status="public")

    r = _list(
        client,
        pid,
        status="public",
        sort="key",
        order="desc",
        page_size=50,
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == pub["id"]


@pytest.mark.parametrize(
    "params",
    [
        {"sort": "tags"},
        {"order": "ASC"},
        {"sort": ""},
        {"order": ""},
    ],
)
def test_list_sort_invalid_params_400(client, params):
    pid = _project(client)
    _string(client, pid, "k", "K")
    r = _list(client, pid, **params)
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert isinstance(detail, str)
    assert detail


def test_migration_creates_updated_at_partial_index(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'sort-index.db'}"
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    event.listen(engine, "connect", enable_sqlite_foreign_keys)
    with engine.connect() as conn:
        index_sql = conn.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE name = 'ix_strings_project_updated_at_alive'"
        ).scalar()
    assert index_sql
    assert "deleted_at" in index_sql.lower()
    assert "updated_at" in index_sql.lower()
