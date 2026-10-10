"""Server-side sort for GET /projects/{id}/strings (XLOCALE-36)."""

from __future__ import annotations

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from alembic import command
from app.config import settings


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


def test_list_sort_with_time_range(client):
    pid = _project(client)
    _string(client, pid, "a", "A")
    _string(client, pid, "b", "B")

    r = _list(
        client, pid, sort="key", order="desc",
        since="2000-01-01T00:00:00Z", until="2100-01-01T00:00:00Z",
    )
    assert r.status_code == 200
    assert [row["key"] for row in r.json()["items"]] == ["b", "a"]

    for bounds in (
        {"since": "2100-01-01T00:00:00Z"},
        {"until": "2000-01-01T00:00:00Z"},
    ):
        r = _list(client, pid, sort="key", order="desc", **bounds)
        assert r.status_code == 200
        assert r.json()["items"] == []


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


def test_migration_creates_updated_at_partial_index(throwaway_database, monkeypatch):
    url = throwaway_database
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    with engine.connect() as conn:
        index_sql = conn.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'ix_strings_project_updated_at_alive'"
            )
        ).scalar()
    assert index_sql
    assert "deleted_at" in index_sql.lower()
    assert "updated_at" in index_sql.lower()
    engine.dispose()


@pytest.mark.parametrize("starting_state", ["fresh", "catalog_sort", "time_range"])
def test_shared_index_migration_upgrade_and_downgrade(
    throwaway_database, monkeypatch, starting_state
):
    url = throwaway_database
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config("alembic.ini")
    engine = create_engine(url)

    if starting_state == "catalog_sort":
        command.upgrade(cfg, "m2d49g0b1234")
    elif starting_state == "time_range":
        # Reproduce the original PR's schema and revision before its parent
        # changed to reuse the catalog sorting migration.
        command.upgrade(cfg, "l1c38f9a0123")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX ix_strings_project_updated_at_alive "
                    "ON strings (project_id, updated_at) WHERE deleted_at IS NULL"
                )
            )
        command.stamp(cfg, "m2d49a0b1234")

    def index_count():
        with engine.connect() as conn:
            return conn.execute(
                text(
                    "SELECT count(*) FROM pg_indexes "
                    "WHERE indexname = 'ix_strings_project_updated_at_alive'"
                )
            ).scalar()

    command.upgrade(cfg, "head")
    assert index_count() == 1
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").all() == [
            (ScriptDirectory.from_config(cfg).get_current_head(),)
        ]

    command.downgrade(cfg, "m2d49g0b1234")
    assert index_count() == 1
    command.downgrade(cfg, "l1c38f9a0123")
    assert index_count() == 0
    command.upgrade(cfg, "head")
    assert index_count() == 1
    engine.dispose()
