"""Activity feed, history restore, and bulk undo."""

from __future__ import annotations


def _make_project(client, name: str, targets=None):
    r = client.post(
        "/api/projects",
        json={
            "name": name,
            "base_language": "vi",
            "target_languages": targets or ["en"],
            "layout": "modular",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_excel_import_is_one_feed_card(client):
    project = _make_project(client, "Excel Feed")
    pid = project["id"]
    seeded = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {f"k{i:02d}": f"Nguồn {i}" for i in range(40)}},
    )
    assert seeded.status_code == 200, seeded.text
    assert seeded.json()["created"] == 40

    exported = client.get(f"/api/projects/{pid}/export", params={"format": "xlsx", "stage": "all"})
    assert exported.status_code == 200, exported.text

    items = client.get(f"/api/projects/{pid}/strings", params={"page_size": 100}).json()["items"]
    for row in items:
        client.patch(
            f"/api/projects/{pid}/strings/{row['id']}",
            json={"source_text": f"{row['source_text']} changed"},
        )

    imported = client.post(
        f"/api/projects/{pid}/import",
        files={
            "file": (
                "bundle.xlsx",
                exported.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["updated"] == 40

    feed = client.get(
        f"/api/projects/{pid}/activities/feed",
        params={"page": 1, "page_size": 20, "event_type": "excel_import"},
    )
    assert feed.status_code == 200, feed.text
    body = feed.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    card = body["items"][0]
    assert card["kind"] == "batch"
    assert card["event_type"] == "excel_import"
    assert card["children_count"] == 40
    assert card["is_undoable"] is True
    assert "Excel" in card["summary"]
    assert card["batch_id"] == imported.json()["batch_id"]


def test_restore_version_applies_after_without_409(client):
    project = _make_project(client, "Restore Version")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "welcome", "source_text": "Chào", "translations": {"en": "Hi"}},
    ).json()
    sid = created["id"]

    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"translations": {"en": "Hello"}},
    )
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"translations": {"en": "Welcome"}},
    )

    history = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
    hello = next(
        a
        for a in history
        if a["action"] == "update"
        and (a["after"] or {}).get("translations", {}).get("en") == "Hello"
    )

    r = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{hello['id']}/restore"
    )
    assert r.status_code == 200, r.text
    assert r.json()["event_type"] == "string.restored"
    assert r.json()["summary"] == "Restored a previous working-copy version of 'welcome'"
    assert r.json()["batch_kind"] is None
    assert r.json()["pending_delete"] is False
    assert "Publish status is unchanged" in r.json()["notice"]

    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert by_locale["en"] == "Hello"

    later = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
    assert later[0]["event_type"] == "string.restored"


def test_batch_undo_force_overwrites_later_edits(client):
    project = _make_project(client, "Batch Undo Force")
    pid = project["id"]
    first = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"a": "A1", "b": "B1"}},
    )
    assert first.status_code == 200, first.text
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"a": "A2", "b": "B2"}},
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]

    items = client.get(f"/api/projects/{pid}/strings").json()["items"]
    by_key = {row["key"]: row for row in items}
    client.patch(
        f"/api/projects/{pid}/strings/{by_key['a']['id']}",
        json={"source_text": "A3"},
    )

    conflict = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": False},
    )
    assert conflict.status_code == 409, conflict.text

    undo = client.post(f"/api/projects/{pid}/activities/batch/{batch_id}/revert")
    assert undo.status_code == 200, undo.text
    assert undo.json()["reverted"] == 2

    restored = client.get(f"/api/projects/{pid}/strings").json()["items"]
    by_key = {row["key"]: row for row in restored}
    assert by_key["a"]["source_text"] == "A1"
    assert by_key["b"]["source_text"] == "B1"

    feed = client.get(f"/api/projects/{pid}/activities/feed").json()["items"]
    restored = next(card for card in feed if card["event_type"] == "revert")
    assert restored["kind"] == "batch"
    assert "restored" in restored["summary"].lower()


def test_restore_last_history_batch(client):
    project = _make_project(client, "Restore Last")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "ok", "source_text": "OK", "translations": {"en": "OK"}},
    ).json()
    sid = created["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"translations": {"en": "Okay"}},
    )

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "restore_last_history", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1

    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert by_locale["en"] == "OK"

    latest = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"][0]
    assert latest["event_type"] == "string.restored"

    feed = client.get(f"/api/projects/{pid}/activities/feed").json()["items"]
    restored = next(card for card in feed if card["event_type"] == "string.restored")
    assert "Restored" in restored["summary"]


def test_discard_changes_feed_is_not_restore(client):
    project = _make_project(client, "Discard Event")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "translations": {"en": "Save"},
            "status": "public",
        },
    ).json()
    sid = created["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Lưu 2", "translations": {"en": "Save 2"}},
    )
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "discard_changes", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text

    latest = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"][0]
    assert latest["event_type"] == "string.discarded"
    assert latest["event_type"] != "string.restored"
    assert "Discarded unpublished changes" in latest["summary"]

    feed = client.get(f"/api/projects/{pid}/activities/feed").json()["items"]
    discarded = next(card for card in feed if card["event_type"] == "string.discarded")
    assert discarded["kind"] == "batch"
    assert "last published snapshot" in discarded["summary"]
    assert discarded["event_type"] != "string.restored"


def test_pending_delete_event_type(client):
    project = _make_project(client, "Pending Delete Event")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "gone", "source_text": "X", "status": "public"},
    ).json()
    r = client.delete(f"/api/projects/{pid}/strings/{created['id']}")
    assert r.status_code == 204

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    pending = next(a for a in items if a["action"] == "update")
    assert pending["event_type"] == "string.pending_delete"
    assert "deletion" in pending["summary"]


def test_restore_rejects_publish_and_pending_delete_events(client):
    project = _make_project(client, "Lifecycle Restore Reject")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "delete", "source_text": "Xóa", "translations": {"en": "Delete"}},
    ).json()
    sid = created["id"]
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"translations": {"en": "Remove"}},
    )
    published = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.published"
    )
    before = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    r = client.post(f"/api/projects/{pid}/strings/{sid}/activities/{published['id']}/restore")
    assert r.status_code == 400, r.text
    assert "Publish" in r.json()["detail"]
    after = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert after["status"] == before["status"]
    assert {t["locale"]: t["value"] for t in after["translations"]}["en"] == "Remove"

    client.delete(f"/api/projects/{pid}/strings/{sid}")
    pending = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.pending_delete"
    )
    blocked = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{pending['id']}/restore"
    )
    assert blocked.status_code == 400, blocked.text
    assert "Pending deletes" in blocked.json()["detail"]
    still = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert still["pending_delete"] is True


def test_restore_content_version_leaves_pending_delete(client):
    project = _make_project(client, "Restore Leaves Pending")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "cancel",
            "source_text": "Hủy",
            "translations": {"en": "Cancel"},
            "status": "public",
        },
    ).json()
    sid = created["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"translations": {"en": "Abort"}},
    )
    client.delete(f"/api/projects/{pid}/strings/{sid}")
    assert client.get(f"/api/projects/{pid}/strings/{sid}").json()["pending_delete"] is True

    created_event = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.created"
    )
    r = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{created_event['id']}/restore"
    )
    assert r.status_code == 200, r.text
    assert r.json()["pending_delete"] is True
    assert "marked for deletion" in r.json()["notice"]
    restored = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert restored["pending_delete"] is True
    assert restored["status"] == "public"
    assert {t["locale"]: t["value"] for t in restored["translations"]}["en"] == "Cancel"

    same = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{created_event['id']}/restore"
    )
    assert same.status_code == 400, same.text
    assert "already matches" in same.json()["detail"]
    assert "marked for deletion" in same.json()["detail"]
