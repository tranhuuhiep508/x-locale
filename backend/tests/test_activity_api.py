"""Activity feed, history restore, and bulk undo."""

from __future__ import annotations

import uuid

from tests.helpers import publish_strings


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
        and any(
            row["field"] == "translation"
            and row.get("locale") == "en"
            and row.get("after") == "Hello"
            for row in a["changed"]
        )
    )

    r = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{hello['id']}/restore"
    )
    assert r.status_code == 200, r.text
    assert r.json()["event_type"] == "string.restored"
    assert r.json()["summary"] == "Restored previous value of 'welcome'"
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

    undo = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": True},
    )
    assert undo.status_code == 200, undo.text
    assert undo.json()["reverted"] == 2

    restored = client.get(f"/api/projects/{pid}/strings").json()["items"]
    by_key = {row["key"]: row for row in restored}
    assert by_key["a"]["source_text"] == "A1"
    assert by_key["b"]["source_text"] == "B1"

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


def test_restore_last_history_skips_publish(client):
    project = _make_project(client, "Restore Skip Publish")
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
    pub = publish_strings(client, pid, [sid])
    assert pub["affected"] == 1

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "restore_last_history", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1

    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert by_locale["en"] == "OK"
    assert string["status"] == "public"


def test_restore_last_history_noop_when_only_publish(client):
    project = _make_project(client, "Restore Noop Publish")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "only", "source_text": "Only", "status": "draft"},
    ).json()
    sid = created["id"]
    publish_strings(client, pid, [sid])

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "restore_last_history", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 0
    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert string["status"] == "public"
    assert string["source_text"] == "Only"


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
    publish_strings(client, pid, [sid])
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


def test_create_undo_tombstones_and_allows_recreate(client):
    project = _make_project(client, "Create Undo Tombstone")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"welcome": "Chào"}},
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]
    sid = client.get(f"/api/projects/{pid}/strings").json()["items"][0]["id"]

    undo = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": False},
    )
    assert undo.status_code == 200, undo.text
    assert client.get(f"/api/projects/{pid}/strings").json()["items"] == []

    tomb = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert tomb["deleted_at"] is not None

    again = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "welcome", "source_text": "Chào"},
    )
    assert again.status_code == 201, again.text
    assert again.json()["id"] != sid


def test_create_undo_conflicts_after_later_edit(client):
    project = _make_project(client, "Create Undo Conflict")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"welcome": "Chào"}},
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]
    sid = client.get(f"/api/projects/{pid}/strings").json()["items"][0]["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Xin chào"},
    )

    conflict = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": False},
    )
    assert conflict.status_code == 409, conflict.text

    default_force = client.post(f"/api/projects/{pid}/activities/batch/{batch_id}/revert")
    assert default_force.status_code == 409, default_force.text

    undo = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": True},
    )
    assert undo.status_code == 200, undo.text
    tomb = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert tomb["deleted_at"] is not None


def test_feed_caps_batch_children(client):
    from app.services.activities import FEED_CHILD_LIMIT

    project = _make_project(client, "Feed Cap")
    pid = project["id"]
    total = FEED_CHILD_LIMIT + 5
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {f"k{i:02d}": f"N{i}" for i in range(total)}},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == total

    feed = client.get(
        f"/api/projects/{pid}/activities/feed",
        params={"event_type": "import"},
    )
    assert feed.status_code == 200, feed.text
    card = feed.json()["items"][0]
    assert card["children_count"] == total
    assert card["children"] == []
    assert card["counts"]["created"] == total


def test_tag_change_shows_names_in_changed(client):
    project = _make_project(client, "Tag Names")
    pid = project["id"]
    tag = client.post(f"/api/projects/{pid}/tags", json={"name": "release"}).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hi"},
    ).json()
    client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"tag_ids": [tag["id"]]},
    )
    items = client.get(
        f"/api/projects/{pid}/strings/{created['id']}/activities"
    ).json()["items"]
    tagged = next(a for a in items if a["event_type"] == "string.tagged")
    tags_changed = [row for row in tagged["changed"] if row["field"] == "tags"]
    assert tags_changed
    assert "release" in (tags_changed[0]["after"] or "")
    assert tag["id"] not in (tags_changed[0]["after"] or "")


def test_translate_job_payload_stamps_actor(client, monkeypatch):
    project = _make_project(client, "Translate Actor", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()
    me = client.get("/api/auth/me").json()
    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    monkeypatch.setattr("app.routers.translate.run_translate_job", lambda *args, **kwargs: None)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"]},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert job_id

    from app.database import get_db
    from app.main import app
    from app.models import Job

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        job = db.query(Job).filter(Job.id == uuid.UUID(job_id)).first()
        assert job is not None
        actor = (job.payload or {}).get("actor") or {}
        assert actor["actor_type"] == "user"
        assert actor["actor_id"] == me["id"]
        assert actor["actor_label"] == me["email"]
    finally:
        db_gen.close()


def test_prune_activities_deletes_old_rows_only(client):
    from datetime import UTC, datetime, timedelta

    from app.database import get_db
    from app.main import app
    from app.models import Activity
    from app.services.activities import prune_activities

    project = _make_project(client, "Prune")
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "old", "source_text": "Old"},
    )
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "new", "source_text": "New"},
    )

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        rows = (
            db.query(Activity)
            .filter(Activity.project_id == uuid.UUID(pid))
            .order_by(Activity.created_at.asc(), Activity.id.asc())
            .all()
        )
        assert len(rows) >= 2
        rows[0].created_at = datetime.now(UTC) - timedelta(days=10)
        db.commit()
        assert prune_activities(db, days=0) == 0
        deleted = prune_activities(db, days=7)
        db.commit()
        assert deleted >= 1
        remaining = db.query(Activity).filter(Activity.project_id == uuid.UUID(pid)).all()
        assert remaining
        cutoff = datetime.now(UTC) - timedelta(days=7)
        for row in remaining:
            created_at = row.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=UTC)
            assert created_at > cutoff
    finally:
        db_gen.close()


def test_activity_retention_default_is_90():
    from app.config import Settings

    assert Settings.model_fields["activity_retention_days"].default == 90


def test_feed_batch_children_load_via_batch_id_list(client):
    project = _make_project(client, "Feed Child Diffs")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"a": "A", "b": "B"}},
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]

    feed = client.get(
        f"/api/projects/{pid}/activities/feed",
        params={"event_type": "import"},
    )
    assert feed.status_code == 200, feed.text
    card = feed.json()["items"][0]
    assert card["children_count"] == 2
    assert card["children"] == []

    children = client.get(
        f"/api/projects/{pid}/activities",
        params={"batch_id": batch_id},
    ).json()["items"]
    assert len(children) == 2
    for child in children:
        assert child["changed"], "each batch child should carry its own diff"
        assert "before" not in child
        assert "after" not in child
        assert child["changed_count"] >= len(child["changed"])


def test_activity_detail_endpoint(client):
    project = _make_project(client, "Activity Detail")
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
    latest = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"][0]

    list_row = latest
    assert list_row["is_history_restorable"] is True
    assert list_row["restore_blocked_reason"] is None
    assert "before" not in list_row
    assert "after" not in list_row

    detail = client.get(f"/api/projects/{pid}/activities/{latest['id']}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["string_key"] == "welcome"
    assert body["is_history_restorable"] is True
    assert body["restore_blocked_reason"] is None
    assert "before" not in body
    assert "after" not in body
    assert any(row["field"] == "translation" and row["locale"] == "en" for row in body["changed"])

    missing = client.get(f"/api/projects/{pid}/activities/{uuid.uuid4()}")
    assert missing.status_code == 404


def test_activity_detail_resolves_module_name_and_blocked_reason(client):
    project = _make_project(client, "Activity Detail Module")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}
    ).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "login", "source_text": "Đăng nhập", "status": "public"},
    ).json()
    sid = created["id"]
    client.patch(f"/api/projects/{pid}/strings/{sid}", json={"module_id": module["id"]})

    moved = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.moved"
    )
    detail = client.get(f"/api/projects/{pid}/activities/{moved['id']}").json()
    module_row = next(row for row in detail["changed"] if row["field"] == "module_id")
    assert module_row["after"] == "Auth"

    client.delete(f"/api/projects/{pid}/strings/{sid}")
    pending = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.pending_delete"
    )
    blocked_detail = client.get(f"/api/projects/{pid}/activities/{pending['id']}").json()
    assert blocked_detail["is_history_restorable"] is False
    assert "Pending deletes" in blocked_detail["restore_blocked_reason"]


def test_revert_batch_preview_caps_response_items(client):
    project = _make_project(client, "Revert Preview Cap")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {f"k{i:02d}": f"v{i}" for i in range(25)}},
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]
    preview = client.get(f"/api/projects/{pid}/activities/batch/{batch_id}/revert/preview")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["total"] == 25
    assert len(body["items"]) == 20
    assert body["conflict_count"] == 0
    # Truncated items undercount Deleted outcomes; full-batch tallies must not.
    assert sum(1 for item in body["items"] if item["outcome"] == "move_to_deleted") == 20
    assert body["outcome_counts"]["move_to_deleted"] == 25
    assert body["outcome_counts"]["restore_values"] == 0
    assert body["outcome_counts"]["recreate"] == 0
    assert body["outcome_counts"]["already_reverted"] == 0
    assert body["outcome_counts"]["missing"] == 0


def test_revert_batch_preview_reports_outcomes_and_conflicts(client):
    project = _make_project(client, "Revert Batch Preview")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"a": "A1", "b": "B1"}},
    )
    first_batch = imported.json()["batch_id"]
    reimported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"a": "A2", "b": "B2"}},
    )
    batch_id = reimported.json()["batch_id"]
    items = client.get(f"/api/projects/{pid}/strings").json()["items"]
    by_key = {row["key"]: row for row in items}

    clean_preview = client.get(f"/api/projects/{pid}/activities/batch/{batch_id}/revert/preview")
    assert clean_preview.status_code == 200, clean_preview.text
    clean_body = clean_preview.json()
    assert clean_body["total"] == 2
    assert clean_body["conflict_count"] == 0
    assert clean_body["requires_force"] is False
    assert clean_body["outcome_counts"]["restore_values"] == 2
    assert clean_body["outcome_counts"]["move_to_deleted"] == 0
    outcomes = {item["outcome"] for item in clean_body["items"]}
    assert outcomes == {"restore_values"}
    a_item = next(item for item in clean_body["items"] if item["string_key"] == "a")
    change = next(row for row in a_item["changes"] if row["field"] == "source_text")
    assert change["before"] == "A2"
    assert change["after"] == "A1"

    client.patch(
        f"/api/projects/{pid}/strings/{by_key['a']['id']}",
        json={"source_text": "A3"},
    )
    conflict_preview = client.get(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert/preview"
    )
    assert conflict_preview.status_code == 200, conflict_preview.text
    conflict_body = conflict_preview.json()
    assert conflict_body["conflict_count"] == 1
    assert conflict_body["requires_force"] is True
    conflicted = next(item for item in conflict_body["items"] if item["string_key"] == "a")
    assert conflicted["conflict"] is True

    # The revert itself is unaffected by having previewed it first.
    reverted = client.post(
        f"/api/projects/{pid}/activities/batch/{batch_id}/revert",
        params={"force": True},
    )
    assert reverted.status_code == 200, reverted.text

    missing = client.get(
        f"/api/projects/{pid}/activities/batch/{uuid.uuid4()}/revert/preview"
    )
    assert missing.status_code == 404

    already = client.get(f"/api/projects/{pid}/activities/batch/{first_batch}/revert/preview")
    # first_batch's activities were superseded by the second import and are not
    # revertible on their own once overwritten; either 404 (nothing left to revert)
    # or a report with no pending conflicts is acceptable here.
    assert already.status_code in (200, 404)


def test_revert_activity_preview_move_to_deleted_for_create(client):
    project = _make_project(client, "Revert Activity Preview Create")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "temp", "source_text": "Tạm"},
    ).json()
    sid = created["id"]
    activity = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.created"
    )
    preview = client.get(f"/api/projects/{pid}/activities/{activity['id']}/revert/preview")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["total"] == 1
    assert body["items"][0]["outcome"] == "move_to_deleted"
    assert body["items"][0]["string_id"] == sid
    assert body["outcome_counts"]["move_to_deleted"] == 1
    assert body["outcome_counts"]["restore_values"] == 0


def test_restore_version_preview_matches_actual_restore(client):
    project = _make_project(client, "Restore Version Preview")
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
        and any(
            row["field"] == "translation"
            and row.get("locale") == "en"
            and row.get("after") == "Hello"
            for row in a["changed"]
        )
    )

    preview = client.get(
        f"/api/projects/{pid}/strings/{sid}/activities/{hello['id']}/restore/preview"
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["can_restore"] is True
    assert body["blocked_reason"] is None
    assert "Publish status is unchanged" in body["notice"]
    translation_change = next(row for row in body["changes"] if row["field"] == "translation")
    assert translation_change["before"] == "Welcome"
    assert translation_change["after"] == "Hello"

    restored = client.post(
        f"/api/projects/{pid}/strings/{sid}/activities/{hello['id']}/restore"
    )
    assert restored.status_code == 200, restored.text

    noop_preview = client.get(
        f"/api/projects/{pid}/strings/{sid}/activities/{hello['id']}/restore/preview"
    )
    assert noop_preview.status_code == 200, noop_preview.text
    noop_body = noop_preview.json()
    assert noop_body["can_restore"] is False
    assert noop_body["already_matches"] is True


def test_restore_version_preview_blocks_publish_events(client):
    project = _make_project(client, "Restore Preview Blocked")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "delete", "source_text": "Xóa", "translations": {"en": "Delete"}},
    ).json()
    sid = created["id"]
    publish_strings(client, pid, [sid])
    published = next(
        a
        for a in client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
        if a["event_type"] == "string.published"
    )
    preview = client.get(
        f"/api/projects/{pid}/strings/{sid}/activities/{published['id']}/restore/preview"
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["can_restore"] is False
    assert "Publish" in body["blocked_reason"]


def test_feed_locale_filter_matches_snapshot_keys(client):
    project = _make_project(client, "Locale JSON", targets=["en", "fr"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hi", "fr": "Salut"},
        },
    ).json()
    sid = created["id"]
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"translations": {"en": "Hello", "fr": "Bonjour"}},
    )
    history = client.get(f"/api/projects/{pid}/strings/{sid}/activities").json()["items"]
    update = next(a for a in history if a["event_type"] == "translation.updated")
    assert update["locale"] is None

    feed = client.get(
        f"/api/projects/{pid}/activities/feed",
        params={"locale": "en", "event_type": "translation.updated"},
    )
    assert feed.status_code == 200, feed.text
    assert feed.json()["total"] >= 1
    keys = {card.get("string_key") for card in feed.json()["items"]}
    assert "hi" in keys

