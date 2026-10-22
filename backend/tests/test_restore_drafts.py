"""Recovering tombstones must not reactivate historical public snapshots."""

import io

import pytest
from openpyxl import Workbook

from app.config import settings
from tests.helpers import json_upload, make_project, publish_strings
from tests.test_import_jobs import poll


def create(client, root, key, **fields):
    response = client.post(
        f"{root}/strings", json={"key": key, "source_text": "Original", **fields}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def remove(client, project, sid, *, published=True):
    root = f"/api/projects/{project['id']}"
    assert client.delete(f"{root}/strings/{sid}").status_code == 204
    if published:
        publish_strings(client, project["id"], [sid])


def export(client, root, layout, stage="public"):
    response = client.get(f"{root}/export", params={"layout": layout, "stage": stage})
    assert response.status_code == 200, response.text
    body = response.json()
    return body if layout == "flat" else body["modules"].get("common", {})


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_restore_renamed_tombstone_keeps_replacement_public(client, layout):
    project = make_project(client, layout=layout)
    root = f"/api/projects/{project['id']}"
    module = client.post(f"{root}/modules", json={"slug": "common", "name": "Common"}).json()
    sid = create(client, root, "save", module_id=module["id"], translations={"en": "Old"})
    publish_strings(client, project["id"], [sid])
    assert (
        client.patch(
            f"{root}/strings/{sid}",
            json={"key": "save_new", "source_text": "Working", "translations": {"en": "New"}},
        ).status_code
        == 200
    )
    remove(client, project, sid)
    replacement = create(client, root, "save", module_id=module["id"], source_text="Replacement")
    publish_strings(client, project["id"], [replacement])
    restored = client.post(f"{root}/strings/batch", json={"action": "restore", "string_ids": [sid]})
    assert restored.status_code == 200, restored.text
    row = client.get(f"{root}/strings/{sid}").json()
    assert row["status"] == "draft" and row["deleted_at"] is None
    assert row["key"] == "save_new" and row["published_key"] == "save"
    assert row["source_text"] == "Working" and row["published_source_text"] == "Original"
    assert row["module_id"] == module["id"]
    target = next(t for t in row["translations"] if t["locale"] == "en")
    assert (target["value"], target["published_value"]) == ("New", "Old")
    assert export(client, root, layout)["vi"] == {"save": "Replacement"}
    assert export(client, root, layout, "draft")["vi"]["save_new"] == "Working"

    history = client.get(f"{root}/strings/{sid}/activities").json()["items"]
    assert history[0]["event_type"] == "string.restored"
    undone = client.post(f"{root}/activities/batch/{restored.json()['batch_id']}/revert")
    assert undone.status_code == 200, undone.text
    assert client.get(f"{root}/strings/{sid}").json()["deleted_at"] is not None
    assert (
        client.post(
            f"{root}/strings/batch", json={"action": "restore", "string_ids": [sid]}
        ).status_code
        == 200
    )
    publish_strings(client, project["id"], [sid])
    assert export(client, root, layout)["vi"] == {"save": "Replacement", "save_new": "Working"}


def test_mixed_restore_preserves_pending_publication_and_is_idempotent(client):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    tombstone = create(client, root, "deleted")
    pending = create(client, root, "pending")
    draft = create(client, root, "draft")
    publish_strings(client, project["id"], [tombstone, pending])
    remove(client, project, tombstone)
    remove(client, project, pending, published=False)
    remove(client, project, draft, published=False)
    ids = [tombstone, pending, draft]
    result = client.post(f"{root}/strings/batch", json={"action": "restore", "string_ids": ids})
    assert result.status_code == 200 and result.json()["affected"] == 3
    assert export(client, root, "flat")["vi"] == {"pending": "Original"}
    for sid in ids:
        row = client.get(f"{root}/strings/{sid}").json()
        assert row["status"] == ("public" if sid == pending else "draft")
        assert row["deleted_at"] is None and not row["pending_delete"]
    repeated = client.post(f"{root}/strings/batch", json={"action": "restore", "string_ids": ids})
    assert repeated.status_code == 200 and repeated.json()["affected"] == 0


def test_restore_reused_working_key_rolls_back_entire_batch(client):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    ids = [create(client, root, key) for key in ("free", "occupied")]
    for sid in ids:
        remove(client, project, sid, published=False)
    create(client, root, "occupied")
    result = client.post(f"{root}/strings/batch", json={"action": "restore", "string_ids": ids})
    assert result.status_code == 409, result.text
    assert all(client.get(f"{root}/strings/{sid}").json()["deleted_at"] for sid in ids)


@pytest.mark.parametrize("kind", ["json", "xlsx"])
@pytest.mark.parametrize("status", ["draft", "public"])
@pytest.mark.parametrize("dry_run", [False, True])
def test_file_import_revives_tombstone_with_requested_status(client, kind, status, dry_run):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    sid = create(client, root, "save", translations={"en": "Old"})
    publish_strings(client, project["id"], [sid])
    remove(client, project, sid)
    if kind == "json":
        files = json_upload({"vi": {"save": "Imported"}, "en": {"save": "New"}})
    else:
        workbook = Workbook()
        workbook.active.title = "common"
        workbook.active.append(["key", "vi", "en"])
        workbook.active.append(["save", "Imported", "New"])
        raw = io.BytesIO()
        workbook.save(raw)
        files = {"file": ("import.xlsx", raw.getvalue())}
    before = client.get(f"{root}/strings/{sid}").json()
    response = client.post(
        f"{root}/import", files=files, params={"status": status, "dry_run": dry_run}
    )
    assert response.status_code == 200, response.text
    row = client.get(f"{root}/strings/{sid}").json()
    if dry_run:
        assert row == before
    else:
        assert row["deleted_at"] is None and row["status"] == status
        assert row["source_text"] == "Imported"
        assert row["published_source_text"] == ("Imported" if status == "public" else "Original")
    expected = {"save": "Imported"} if not dry_run and status == "public" else {}
    assert export(client, root, "flat")["vi"] == expected


def test_async_import_revives_tombstone_as_draft(client, monkeypatch):
    monkeypatch.setattr(settings, "import_async_threshold", 0)
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    sid = create(client, root, "save")
    publish_strings(client, project["id"], [sid])
    remove(client, project, sid)
    accepted = client.post(
        f"{root}/import",
        files=json_upload({"save": "Imported"}),
        headers={"Prefer": "respond-async"},
    )
    assert accepted.status_code == 202, accepted.text
    job = poll(client, project, "json", accepted.json()["job_id"])
    assert job["status"] == "completed", job
    row = client.get(f"{root}/strings/{sid}").json()
    assert row["status"] == "draft" and row["deleted_at"] is None
    assert export(client, root, "flat")["vi"] == {}


def test_public_import_revival_collision_is_atomic(client):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    sid = create(client, root, "save")
    publish_strings(client, project["id"], [sid])
    remove(client, project, sid)
    owner = create(client, root, "save", source_text="Replacement")
    publish_strings(client, project["id"], [owner])
    assert client.patch(f"{root}/strings/{owner}", json={"key": "replacement"}).status_code == 200
    before = client.get(f"{root}/strings/{sid}").json()
    result = client.post(
        f"{root}/import",
        files=json_upload({"free": "New", "save": "Imported"}),
        params={"status": "public"},
    )
    assert result.status_code == 409, result.text
    assert result.json()["detail"]["code"] == "published_key_conflict"
    assert client.get(f"{root}/strings/{sid}").json() == before
    assert client.get(f"{root}/strings", params={"q": "free"}).json()["total"] == 0
    assert export(client, root, "flat")["vi"] == {"save": "Replacement"}


@pytest.mark.parametrize("pending", [False, True])
def test_default_json_import_preserves_live_public_snapshot(client, pending):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    sid = create(client, root, "save")
    publish_strings(client, project["id"], [sid])
    if pending:
        remove(client, project, sid, published=False)
    result = client.post(f"{root}/import", files=json_upload({"save": "Imported"}))
    assert result.status_code == 200, result.text
    row = client.get(f"{root}/strings/{sid}").json()
    assert row["status"] == "public" and not row["pending_delete"]
    assert row["source_text"] == "Imported"
    assert export(client, root, "flat")["vi"] == {"save": "Original"}
