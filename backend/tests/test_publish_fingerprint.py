"""Publish preview fingerprint is required at batch publish and rejects stale confirms."""

from __future__ import annotations

from tests.helpers import preview_publish, publish_strings


def _project(client, name="Fingerprint App"):
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
        "translations": translations or {"en": "Save"},
    }
    r = client.post(f"/api/projects/{pid}/strings", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_preview_returns_fingerprint_and_match_publishes(client):
    project = _project(client)
    pid = project["id"]
    created = _create_string(client, pid)
    sid = created["id"]

    preview = preview_publish(client, pid, string_ids=[sid])
    fingerprint = preview["fingerprint"]
    assert fingerprint
    assert len(fingerprint) == 64
    assert preview["items"][0]["id"] == sid
    assert preview["items"][0]["status"] == "draft"

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid], "fingerprint": fingerprint},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1
    assert client.get(f"/api/projects/{pid}/strings/{sid}").json()["status"] == "public"


def test_publish_without_fingerprint_is_400(client):
    project = _project(client, "Missing Fingerprint")
    pid = project["id"]
    created = _create_string(client, pid)
    sid = created["id"]

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "publish_fingerprint_required"
    assert client.get(f"/api/projects/{pid}/strings/{sid}").json()["status"] == "draft"

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid], "fingerprint": "   "},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "publish_fingerprint_required"


def test_mutate_between_preview_and_confirm_is_409_no_write(client):
    project = _project(client, "Stale Confirm")
    pid = project["id"]
    created = _create_string(client, pid, translations={"en": "Save"})
    sid = created["id"]

    preview = preview_publish(client, pid, string_ids=[sid])
    fingerprint = preview["fingerprint"]

    patch = client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Lưu ngay", "translations": {"en": "Save now"}},
    )
    assert patch.status_code == 200, patch.text

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid], "fingerprint": fingerprint},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "publish_fingerprint_mismatch"

    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["status"] == "draft"
    assert row["published_key"] is None
    assert row["source_text"] == "Lưu ngay"

    live = preview_publish(client, pid, string_ids=[sid])
    assert live["fingerprint"] != fingerprint
    confirm = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "publish",
            "string_ids": [sid],
            "fingerprint": live["fingerprint"],
        },
    )
    assert confirm.status_code == 200, confirm.text
    published = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert published["status"] == "public"
    assert published["published_source_text"] == "Lưu ngay"


def test_tag_change_does_not_false_conflict(client):
    project = _project(client, "Tag Noise")
    pid = project["id"]
    created = _create_string(client, pid)
    sid = created["id"]
    preview = preview_publish(client, pid, string_ids=[sid])

    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "priority", "color": "#f00"},
    ).json()
    tagged = client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"tag_ids": [tag["id"]]},
    )
    assert tagged.status_code == 200, tagged.text

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "publish",
            "string_ids": [sid],
            "fingerprint": preview["fingerprint"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1


def test_soft_deleted_row_never_publishes(client):
    project = _project(client, "Skip Tombstone")
    pid = project["id"]
    created = _create_string(client, pid, key="temp", source="Tạm")
    sid = created["id"]
    client.delete(f"/api/projects/{pid}/strings/{sid}")

    preview = preview_publish(client, pid, string_ids=[sid])
    assert preview["items"][0]["deleted_at"] is not None
    result = publish_strings(client, pid, [sid])
    assert result["affected"] == 0
    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["deleted_at"] is not None
    assert row["status"] == "draft"
    assert row["published_key"] is None


def test_wrong_fingerprint_is_409(client):
    project = _project(client, "Wrong Token")
    pid = project["id"]
    created = _create_string(client, pid)
    sid = created["id"]
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid], "fingerprint": "0" * 64},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "publish_fingerprint_mismatch"
    assert client.get(f"/api/projects/{pid}/strings/{sid}").json()["status"] == "draft"


def test_other_batch_actions_do_not_require_fingerprint(client):
    project = _project(client, "Unpublish Free")
    pid = project["id"]
    created = _create_string(client, pid, status="public")
    sid = created["id"]
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert client.get(f"/api/projects/{pid}/strings/{sid}").json()["status"] == "draft"
