"""XLOCALE-28: batch unpublish keeps published_* snapshot and omits public export."""

from __future__ import annotations

from tests.helpers import make_project, preview_publish, publish_strings


def test_batch_unpublish_keeps_published_snapshot_fields(client):
    project = make_project(client, "Batch Unpublish Snapshot")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "translations": {"en": "Save"},
        },
    ).json()
    sid = created["id"]
    publish_strings(client, pid, [sid])

    live = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert live["status"] == "public"
    assert live["published_key"] == "save"
    assert live["published_source_text"] == "Lưu"
    en = next(t for t in live["translations"] if t["locale"] == "en")
    assert en["published_value"] == "Save"

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1

    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["status"] == "draft"
    assert row["published_key"] == "save"
    assert row["published_source_text"] == "Lưu"
    en = next(t for t in row["translations"] if t["locale"] == "en")
    assert en["published_value"] == "Save"
    assert en["value"] == "Save"


def test_batch_unpublish_omits_from_public_export_and_public_list(client):
    project = make_project(client, "Batch Unpublish Export")
    pid = project["id"]
    pub = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "live", "source_text": "Live", "translations": {"en": "Live"}},
    ).json()
    draft_only = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "draft", "source_text": "Draft"},
    ).json()
    publish_strings(client, pid, [pub["id"]])

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [pub["id"]]},
    )
    assert r.status_code == 200, r.text

    public_export = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}
    ).json()
    assert "live" not in public_export["vi"]
    assert "draft" not in public_export["vi"]

    public_list = client.get(f"/api/projects/{pid}/strings", params={"status": "public"}).json()
    assert public_list["total"] == 0

    draft_export = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "draft"}
    ).json()
    assert draft_export["vi"]["live"] == "Live"
    assert draft_export["vi"]["draft"] == "Draft"


def test_batch_unpublish_draft_get_still_returns_working_copy_and_snapshot(client):
    project = make_project(client, "Batch Unpublish Working")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    ).json()
    sid = created["id"]
    publish_strings(client, pid, [sid])

    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Lưu mới", "translations": {"en": "Save new"}},
    )
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [sid]},
    )

    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["status"] == "draft"
    assert row["source_text"] == "Lưu mới"
    assert row["published_source_text"] == "Lưu"
    en = next(t for t in row["translations"] if t["locale"] == "en")
    assert en["value"] == "Save new"
    assert en["published_value"] == "Save"
    assert row["has_unpublished_changes"] is True

    listed = client.get(f"/api/projects/{pid}/strings").json()
    by_id = {item["id"]: item for item in listed["items"]}
    assert by_id[sid]["source_text"] == "Lưu mới"


def test_batch_unpublish_skips_soft_deleted(client):
    project = make_project(client, "Batch Unpublish Tombstone")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "gone", "source_text": "X"},
    ).json()
    sid = created["id"]
    client.delete(f"/api/projects/{pid}/strings/{sid}")

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 0


def test_publish_preview_after_unpublish_edit_shows_update_against_live_snapshot(client):
    """Re-publish intent is an update when published_key is set (defer formal classify to XLOCALE-5)."""
    project = make_project(client, "Unpublish Preview")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    ).json()
    sid = created["id"]
    publish_strings(client, pid, [sid])
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [sid]},
    )
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Lưu 2", "translations": {"en": "Save 2"}},
    )

    preview = preview_publish(client, pid, string_ids=[sid])
    assert len(preview["items"]) == 1
    item = preview["items"][0]
    assert item["status"] == "draft"
    assert item["published_key"] == "save"
    assert item["published_source_text"] == "Lưu"
    assert item["source_text"] == "Lưu 2"
    assert item["has_unpublished_changes"] is True
    en = next(t for t in item["translations"] if t["locale"] == "en")
    assert en["published_value"] == "Save"
    assert en["value"] == "Save 2"
    assert preview["fingerprint"]


def test_batch_unpublish_empty_selection(client):
    project = make_project(client, "Batch Unpublish Empty")
    pid = project["id"]
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": []},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["affected"] == 0
    assert body["batch_id"]
