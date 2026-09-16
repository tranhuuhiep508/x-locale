"""Publish preview loads the same snapshot fields batch publish would apply."""

from __future__ import annotations


def _project(client, name="Preview App"):
    r = client.post(
        "/api/projects",
        json={"name": name, "base_language": "vi", "target_languages": ["en", "ja"]},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _create_string(client, pid, key="save", source="Lưu", translations=None, status="draft"):
    payload = {
        "key": key,
        "source_text": source,
        "status": status,
        "translations": translations or {},
    }
    r = client.post(f"/api/projects/{pid}/strings", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_publish_preview_does_not_mutate(client):
    project = _project(client)
    pid = project["id"]
    created = _create_string(client, pid, translations={"en": "Save"})
    sid = created["id"]

    r = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == sid
    assert items[0]["status"] == "draft"
    assert items[0]["published_key"] is None
    assert isinstance(r.json()["fingerprint"], str)
    assert len(r.json()["fingerprint"]) == 64

    refreshed = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert refreshed["status"] == "draft"
    assert refreshed["published_key"] is None
    assert refreshed["has_unpublished_changes"] is False


def test_publish_preview_includes_unpublished_and_pending_delete(client):
    project = _project(client)
    pid = project["id"]
    live = _create_string(
        client, pid, key="save", source="Lưu", translations={"en": "Save"}, status="public"
    )
    sid = live["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Lưu ngay", "translations": {"en": "Save now"}},
    )
    pending = _create_string(
        client, pid, key="gone", source="Xóa", translations={"en": "Delete"}, status="public"
    )
    client.delete(f"/api/projects/{pid}/strings/{pending['id']}")

    r = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"filter": {"has_unpublished_changes": True}},
    )
    assert r.status_code == 200, r.text
    keys = {row["key"] for row in r.json()["items"]}
    assert keys == {"save", "gone"}
    by_key = {row["key"]: row for row in r.json()["items"]}
    assert by_key["save"]["has_unpublished_changes"] is True
    assert by_key["save"]["published_source_text"] == "Lưu"
    assert by_key["gone"]["pending_delete"] is True


def test_publish_preview_keeps_soft_deleted_when_selected_by_id(client):
    project = _project(client)
    pid = project["id"]
    draft = _create_string(client, pid, key="temp", source="Tạm")
    client.delete(f"/api/projects/{pid}/strings/{draft['id']}")
    tombstone = client.get(
        f"/api/projects/{pid}/strings/{draft['id']}",
    )
    assert tombstone.status_code == 200
    assert tombstone.json()["deleted_at"] is not None

    r = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"string_ids": [draft["id"]]},
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["deleted_at"] is not None

    listed = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"filter": {"has_unpublished_changes": True}},
    )
    assert listed.status_code == 200
    assert listed.json()["items"] == []
    assert listed.json()["fingerprint"]


def test_publish_preview_empty_selection(client):
    project = _project(client)
    r = client.post(
        f"/api/projects/{project['id']}/strings/publish-preview",
        json={},
    )
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []
    assert r.json()["fingerprint"]
