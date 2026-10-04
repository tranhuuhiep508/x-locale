"""CLI import safety is distinct from the general JSON upload workflow."""

from __future__ import annotations

import pytest

from tests.helpers import json_upload, make_project, publish_strings


def _catalog_snapshot(client, pid):
    root = f"/api/projects/{pid}"
    return {
        "strings": client.get(f"{root}/strings", params={"deleted": False}).json(),
        "deleted": client.get(f"{root}/strings", params={"deleted": True}).json(),
        "modules": client.get(f"{root}/modules").json(),
        "activities": client.get(f"{root}/activities").json(),
        "state": client.get(f"{root}/sync-state", params={"layout": "flat"}).json(),
    }


@pytest.mark.parametrize("layout", ["flat", "modular"])
@pytest.mark.parametrize("deletion", ["pending", "tombstone"])
@pytest.mark.parametrize("changed", [False, True])
@pytest.mark.parametrize(
    "dry_run,partial", [(False, False), (False, True), (True, False), (True, True)]
)
def test_cli_rejects_entire_deleted_key_import(client, layout, deletion, changed, dry_run, partial):
    project = make_project(client, "Safe Push", layout=layout)
    pid = project["id"]
    root = f"/api/projects/{pid}"
    row = client.post(f"{root}/strings", json={"key": "gone", "source_text": "Old"}).json()
    if deletion == "pending":
        publish_strings(client, pid, [row["id"]])
    assert client.delete(f"{root}/strings/{row['id']}").status_code == 204
    before = _catalog_snapshot(client, pid)
    values = {"fresh": "New", "gone": "Changed" if changed else "Old"}
    payload = (
        {"strings": values} if layout == "flat" else {"modules": {"newmodule": {"vi": values}}}
    )
    response = client.post(
        f"{root}/strings/import", params={"dry_run": dry_run, "partial": partial}, json=payload
    )
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "push_deleted_keys"
    field = "pending_remove" if deletion == "pending" else "tombstones"
    assert detail[field] == (["gone"] if layout == "flat" else ["_unassigned/gone"])
    assert "Restore" in detail["message"]
    assert _catalog_snapshot(client, pid) == before


@pytest.mark.parametrize("layout", ["flat", "modular"])
@pytest.mark.parametrize("dry_run", [False, True])
def test_cli_base_language_mismatch_is_atomic(client, layout, dry_run):
    project = make_project(client, "Wrong Base", layout=layout)
    pid = project["id"]
    before = _catalog_snapshot(client, pid)
    values = {"hello": "English"}
    payload = {"strings": values} if layout == "flat" else {"modules": {"auth": {"en": values}}}
    payload["base_language"] = "en"
    response = client.post(
        f"/api/projects/{pid}/strings/import", params={"dry_run": dry_run}, json=payload
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "base_language_mismatch"
    assert response.json()["detail"]["expected"] == "vi"
    assert _catalog_snapshot(client, pid) == before


@pytest.mark.parametrize("deletion", ["pending", "tombstone"])
def test_general_json_upload_still_restores(client, deletion):
    project = make_project(client, "UI Restore")
    pid = project["id"]
    root = f"/api/projects/{pid}"
    row = client.post(f"{root}/strings", json={"key": "gone", "source_text": "Old"}).json()
    if deletion == "pending":
        publish_strings(client, pid, [row["id"]])
    client.delete(f"{root}/strings/{row['id']}")
    response = client.post(f"{root}/import", files=json_upload({"gone": "Restored"}))
    assert response.status_code == 200, response.text
    restored = client.get(f"{root}/strings/{row['id']}").json()
    assert restored["deleted_at"] is None
    assert not restored["pending_delete"]
    assert restored["source_text"] == "Restored"


def test_recreated_live_key_shadows_old_tombstone(client):
    project = make_project(client, "Recreated")
    pid = project["id"]
    root = f"/api/projects/{pid}"
    module = client.post(f"{root}/modules", json={"slug": "auth", "name": "Auth"}).json()
    old = client.post(
        f"{root}/strings", json={"key": "same", "source_text": "Old", "module_id": module["id"]}
    ).json()
    client.delete(f"{root}/strings/{old['id']}")
    live = client.post(f"{root}/strings", json={"key": "same", "source_text": "Replacement"}).json()
    for layout in ("flat", "modular"):
        state = client.get(f"{root}/sync-state", params={"layout": layout}).json()
        assert state["tombstones"] == []
        assert state["locales"] == ["vi", "en"]
    response = client.post(f"{root}/strings/import", json={"strings": {"same": "Updated"}})
    assert response.status_code == 200, response.text
    assert client.get(f"{root}/strings/{live['id']}").json()["source_text"] == "Updated"
    assert client.get(f"{root}/strings/{old['id']}").json()["deleted_at"] is not None


@pytest.mark.parametrize("layout", ["flat", "modular"])
@pytest.mark.parametrize("value", ["", "  "])
def test_empty_source_create_preview_update_and_public_snapshot(client, layout, value):
    project = make_project(client, "Empty Source", layout=layout)
    pid = project["id"]
    root = f"/api/projects/{pid}"

    def payload(text):
        data = (
            {"strings": {"blank": text}}
            if layout == "flat"
            else {"modules": {"auth": {"vi": {"blank": text}}}}
        )
        return {**data, "base_language": "vi"}

    preview = client.post(f"{root}/strings/import", params={"dry_run": True}, json=payload(value))
    assert preview.status_code == 200, preview.text
    assert preview.json()["diff"]["create"][0]["source_text"] == value
    created = client.post(f"{root}/strings/import", json=payload(value))
    assert created.status_code == 200, created.text
    row = client.get(f"{root}/strings").json()["items"][0]
    assert row["source_text"] == value
    publish_strings(client, pid, [row["id"]])
    for stage in ("draft", "public"):
        export = client.get(f"{root}/export", params={"layout": layout, "stage": stage}).json()
        base = export["vi"] if layout == "flat" else export["modules"]["auth"]["vi"]
        assert base["blank"] == value
    client.post(f"{root}/strings/import", json=payload("Working"))
    updated_preview = client.post(
        f"{root}/strings/import", params={"dry_run": True}, json=payload(value)
    )
    assert updated_preview.json()["diff"]["update"][0]["source_text"] == value
    client.post(f"{root}/strings/import", json=payload(value))
    assert client.get(f"{root}/strings/{row['id']}").json()["source_text"] == value


def test_target_only_upload_retains_source_fallback(client):
    project = make_project(client, "Target Only")
    pid = project["id"]
    response = client.post(
        f"/api/projects/{pid}/import", files=json_upload({"en": {"hello": "Hello"}})
    )
    assert response.status_code == 200, response.text
    assert client.get(f"/api/projects/{pid}/strings").json()["items"][0]["source_text"] == "hello"


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_partial_cli_import_loads_only_submitted_keys(client, monkeypatch, layout):
    from app.services import sync as sync_service

    project = make_project(client, "Bounded Push", layout=layout)
    pid = project["id"]
    initial = {f"key{i}": "Before" for i in range(25)}
    body = {"strings": initial} if layout == "flat" else {"modules": {"auth": {"vi": initial}}}
    assert client.post(f"/api/projects/{pid}/strings/import", json=body).status_code == 200
    original = sync_service._load_import_index_entries
    loaded = []

    def tracked(db, project_id, keys=None):
        loaded.append(keys)
        return original(db, project_id, keys)

    monkeypatch.setattr(sync_service, "_load_import_index_entries", tracked)
    values = {"key1": "After"}
    body = {"strings": values} if layout == "flat" else {"modules": {"auth": {"vi": values}}}
    response = client.post(
        f"/api/projects/{pid}/strings/import", params={"partial": True}, json=body
    )
    assert response.status_code == 200, response.text
    assert loaded == [["key1"]]
    assert response.json()["diff"]["orphan_count"] == 0
