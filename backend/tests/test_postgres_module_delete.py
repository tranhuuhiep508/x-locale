"""XLOCALE-44: module delete and cross-project module refs on real Postgres."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Module, StringEntry
from tests.helpers import json_upload, make_project, publish_strings

pytestmark = pytest.mark.postgres


def _module(client, project_id: str, slug: str) -> dict:
    created = client.post(
        f"/api/projects/{project_id}/modules",
        json={"slug": slug, "name": slug.title()},
    )
    assert created.status_code == 201, created.text
    return created.json()


def _string(client, project_id: str, key: str, module_id: str | None) -> dict:
    body: dict = {"key": key, "source_text": key}
    if module_id is not None:
        body["module_id"] = module_id
    created = client.post(f"/api/projects/{project_id}/strings", json=body)
    assert created.status_code == 201, created.text
    return created.json()


def test_delete_module_clears_refs_on_every_schema(pg_schema):
    client, session_factory, mode = pg_schema
    project = make_project(client, name=f"Delete {mode}")
    pid = project["id"]
    doomed = _module(client, pid, "auth")
    kept = _module(client, pid, "home")

    both = _string(client, pid, "both", doomed["id"])
    published_only = _string(client, pid, "published-only", doomed["id"])
    working_only = _string(client, pid, "working-only", doomed["id"])
    untouched = _string(client, pid, "kept", kept["id"])
    publish_strings(client, pid, [both["id"], published_only["id"], untouched["id"]])
    cleared = client.patch(
        f"/api/projects/{pid}/strings/{published_only['id']}",
        json={"module_id": None},
    )
    assert cleared.status_code == 200, cleared.text

    with session_factory() as db:
        stamps = {
            row.key: (
                row.updated_at,
                row.updated_by_type,
                row.updated_by_id,
                row.updated_by_label,
            )
            for row in db.query(StringEntry).all()
        }

    if mode == "restored_order":
        with session_factory() as db:
            engine = db.get_bind()
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM modules WHERE id = :id"),
                    {"id": uuid.UUID(doomed["id"])},
                )

    deleted = client.delete(f"/api/projects/{pid}/modules/{doomed['id']}")
    assert deleted.status_code == 204, deleted.text

    with session_factory() as db:
        assert db.get(Module, uuid.UUID(doomed["id"])) is None
        assert db.get(Module, uuid.UUID(kept["id"])) is not None
        rows = {row.key: row for row in db.query(StringEntry).all()}
        for key in ("both", "published-only", "working-only"):
            assert rows[key].project_id == uuid.UUID(pid)
            assert rows[key].module_id is None
            assert rows[key].published_module_id is None
        assert rows["kept"].module_id == uuid.UUID(kept["id"])
        assert rows["kept"].published_module_id == uuid.UUID(kept["id"])
        for key in ("both", "published-only", "working-only", "kept"):
            updated_at, actor_type, actor_id, actor_label = stamps[key]
            assert rows[key].updated_at == updated_at
            assert rows[key].updated_by_type == actor_type
            assert rows[key].updated_by_id == actor_id
            assert rows[key].updated_by_label == actor_label
        assert working_only["key"] == "working-only"


def test_cross_project_module_assignment_is_400(pg_session):
    client, _session_factory = pg_session
    project_a = make_project(client, name="Project A")
    project_b = make_project(client, name="Project B")
    foreign = _module(client, project_b["id"], "secret")
    own = _string(client, project_a["id"], "hello", None)

    created = client.post(
        f"/api/projects/{project_a['id']}/strings",
        json={"key": "nope", "source_text": "No", "module_id": foreign["id"]},
    )
    assert created.status_code == 400, created.text
    assert "Unknown module" in created.text

    updated = client.patch(
        f"/api/projects/{project_a['id']}/strings/{own['id']}",
        json={"module_id": foreign["id"]},
    )
    assert updated.status_code == 400, updated.text
    assert "Unknown module" in updated.text

    moved = client.post(
        f"/api/projects/{project_a['id']}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [own["id"]],
            "payload": {"module_id": foreign["id"]},
        },
    )
    assert moved.status_code == 400, moved.text
    assert "Unknown module" in moved.text

    imported = client.post(
        f"/api/projects/{project_a['id']}/import?module_id={foreign['id']}",
        files=json_upload({"hello": "Xin chào"}),
    )
    assert imported.status_code == 400, imported.text
    assert "Unknown module" in imported.text


def test_deferred_module_fk_commit_is_400(pg_session, monkeypatch):
    """Bypass the app check so the deferred FK is the thing that rejects the write."""
    client, session_factory = pg_session
    project_a = make_project(client, name="Checked later A")
    project_b = make_project(client, name="Checked later B")
    foreign = _module(client, project_b["id"], "secret")

    def passthrough(db, project_id, module_id, on_missing="error"):
        del db, project_id, on_missing
        return module_id

    monkeypatch.setattr("app.services.strings.require_module_in_project", passthrough)
    monkeypatch.setattr("app.services.sync.require_module_in_project", passthrough)
    created = client.post(
        f"/api/projects/{project_a['id']}/strings",
        json={"key": "late", "source_text": "Late", "module_id": foreign["id"]},
    )
    assert created.status_code == 400, created.text
    assert "Unknown module" in created.text
    assert "IntegrityError" not in created.text

    monkeypatch.setattr(
        "app.services.sync._get_or_create_module",
        lambda db, project, slug, *, dry_run: SimpleNamespace(id=uuid.UUID(foreign["id"])),
    )
    pushed = client.post(
        f"/api/projects/{project_a['id']}/strings/import",
        json={
            "base_language": "vi",
            "modules": {"auth": {"vi": {"pushed": "Xin chào"}}},
        },
    )
    assert pushed.status_code == 400, pushed.text
    assert "Unknown module" in pushed.text

    with session_factory() as db:
        assert db.query(StringEntry).filter(StringEntry.key == "late").one_or_none() is None
        assert db.query(StringEntry).filter(StringEntry.key == "pushed").one_or_none() is None
