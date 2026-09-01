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
    src = _make_project(client, "Excel Feed Src")
    src_id = src["id"]
    for i in range(40):
        r = client.post(
            f"/api/projects/{src_id}/strings",
            json={"key": f"k{i:02d}", "source_text": f"Nguồn {i}"},
        )
        assert r.status_code == 201, r.text

    exported = client.get(
        f"/api/projects/{src_id}/export", params={"format": "xlsx", "stage": "all"}
    )
    assert exported.status_code == 200, exported.text

    dest = _make_project(client, "Excel Feed Dst")
    dest_id = dest["id"]
    imported = client.post(
        f"/api/projects/{dest_id}/import",
        files={
            "file": (
                "bundle.xlsx",
                exported.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == 40

    raw = client.get(f"/api/projects/{dest_id}/activities").json()
    assert raw["total"] >= 40

    feed = client.get(
        f"/api/projects/{dest_id}/activities/feed",
        params={"page": 1, "page_size": 20},
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
        if a["action"] == "update" and (a["after"] or {}).get("translations", {}).get("en") == "Hello"
    )

    r = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{hello['id']}/restore"
    )
    assert r.status_code == 200, r.text
    assert r.json()["event_type"] == "string.restored"
    assert r.json()["summary"] == "Restored previous value of 'welcome'"
    assert r.json()["batch_kind"] is None

    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert by_locale["en"] == "Hello"

    later = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
    assert later[0]["event_type"] == "string.restored"


def test_batch_undo_force_overwrites_later_edits(client):
    project = _make_project(client, "Batch Undo Force")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"a": "A1", "b": "B1"}},
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]

    items = client.get(f"/api/projects/{pid}/strings").json()["items"]
    by_key = {row["key"]: row for row in items}
    client.patch(
        f"/api/projects/{pid}/strings/{by_key['a']['id']}",
        json={"source_text": "A2"},
    )

    conflict = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": False},
    )
    assert conflict.status_code == 409, conflict.text

    undo = client.post(f"/api/projects/{pid}/activities/batch/{batch_id}/revert")
    assert undo.status_code == 200, undo.text
    assert undo.json()["reverted"] == 2

    missing = client.get(f"/api/projects/{pid}/strings").json()
    assert missing["total"] == 0

    feed = client.get(f"/api/projects/{pid}/activities/feed").json()["items"]
    restored = next(card for card in feed if card["event_type"] == "revert")
    assert restored["kind"] == "batch"
    assert "Restored" in restored["summary"]


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
