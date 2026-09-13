"""String catalog CRUD, batch publish, filters, and activity tests."""

from __future__ import annotations

import uuid

from tests.helpers import _make_project


def test_batch_publish(client):
    r = client.post(
        "/api/projects",
        json={"name": "Batch", "target_languages": ["en"]},
    )
    pid = r.json()["id"]
    r = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "a", "source_text": "A"},
    )
    sid = r.json()["id"]
    client.put(
        f"/api/projects/{pid}/strings/{sid}/translations/en",
        json={"value": "A-en"},
    )
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1

    r = client.get(f"/api/projects/{pid}/strings/{sid}")
    assert r.json()["status"] == "public"


def test_public_export_empty_missing_locale(client):
    r = client.post(
        "/api/projects",
        json={"name": "Empty Locale", "target_languages": ["en", "fr"]},
    )
    pid = r.json()["id"]
    r = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "greet", "source_text": "Xin chào"},
    )
    sid = r.json()["id"]
    client.put(
        f"/api/projects/{pid}/strings/{sid}/translations/en",
        json={"value": "Hello"},
    )
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )

    r = client.get(f"/api/projects/{pid}/export?layout=flat&stage=public")
    assert r.status_code == 200
    data = r.json()
    assert data["en"]["greet"] == "Hello"
    assert data["fr"]["greet"] == ""
    assert data["vi"]["greet"] == "Xin chào"


def test_list_strings_filters(client):
    r = client.post(
        "/api/projects",
        json={
            "name": "Filter App",
            "target_languages": ["en"],
            "layout": "modular",
        },
    )
    pid = r.json()["id"]

    m1 = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "auth", "name": "Auth"},
    ).json()
    m2 = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "home", "name": "Home"},
    ).json()

    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "priority", "color": "#f00"},
    ).json()

    s1 = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "login",
            "source_text": "Đăng nhập",
            "module_id": m1["id"],
            "tag_ids": [tag["id"]],
        },
    ).json()
    assert s1["created_at"]
    assert s1["created_by_label"] == "dev@localhost"
    assert s1["updated_by_label"] == "dev@localhost"
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "welcome", "source_text": "Chào mừng", "module_id": m2["id"]},
    )

    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [s1["id"]]},
    )
    client.put(
        f"/api/projects/{pid}/strings/{s1['id']}/translations/en",
        json={"value": "Log in"},
    )

    listed = client.get(f"/api/projects/{pid}/strings").json()["items"]
    login = next(item for item in listed if item["key"] == "login")
    updated_after_edit = login["updated_at"]
    assert updated_after_edit
    assert updated_after_edit != s1["updated_at"]

    # module filter uses `module` query param
    r = client.get(f"/api/projects/{pid}/strings", params={"module": m1["id"]})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "login"

    # tag filter uses `tag` query param
    r = client.get(f"/api/projects/{pid}/strings", params={"tag": tag["id"]})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "login"

    # status=public finds published strings
    r = client.get(f"/api/projects/{pid}/strings", params={"status": "public"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "login"

    # status=draft finds draft strings
    r = client.get(f"/api/projects/{pid}/strings", params={"status": "draft"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "welcome"

    # missing locale filter
    r = client.get(f"/api/projects/{pid}/strings", params={"missing_locale": "en"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "welcome"

    listed = client.get(f"/api/projects/{pid}/strings").json()["items"]
    login = next(item for item in listed if item["key"] == "login")
    assert login["updated_at"] == updated_after_edit
    assert login["updated_by_label"] == "dev@localhost"


def test_string_author_survives_activity_prune(client):
    import uuid

    from app.database import get_db
    from app.main import app
    from app.models import Activity

    project = _make_project(client, "Author Prune")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "greet", "source_text": "Xin chào"},
    ).json()
    assert created["created_by_label"] == "dev@localhost"

    client.put(
        f"/api/projects/{pid}/strings/{created['id']}/translations/en",
        json={"value": "Hello"},
    )

    listed = client.get(f"/api/projects/{pid}/strings").json()["items"]
    entry = next(item for item in listed if item["id"] == created["id"])
    assert entry["updated_by_label"] == "dev@localhost"

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        db.query(Activity).filter(Activity.string_id == uuid.UUID(created["id"])).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db_gen.close()

    listed = client.get(f"/api/projects/{pid}/strings").json()["items"]
    entry = next(item for item in listed if item["id"] == created["id"])
    assert entry["updated_by_label"] == "dev@localhost"
    assert entry["created_by_label"] == "dev@localhost"


def test_stamp_string_metadata_preserves_created_by(client):
    import uuid

    from app.database import get_db
    from app.main import app
    from app.models import StringEntry

    project = _make_project(client, "Created By Immutability")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "immutable", "source_text": "Test"},
    ).json()
    original_created_by = created["created_by_label"]
    assert original_created_by

    client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"source_text": "Changed"},
    )

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        entry = db.get(StringEntry, uuid.UUID(created["id"]))
        assert entry is not None
        assert entry.created_by_label == original_created_by
        assert entry.updated_by_label == "dev@localhost"
    finally:
        db_gen.close()


def test_string_create_activity_snapshot(client):
    project = _make_project(client, "Create Snap")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
    ).json()
    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "ui", "color": "#111"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "description": "Primary action",
            "module_id": module["id"],
            "tag_ids": [tag["id"]],
            "status": "public",
            "translations": {"en": "Save"},
        },
    )
    assert r.status_code == 201, r.text
    string = r.json()
    assert string["status"] == "public"
    assert string["translations"][0]["value"] == "Save"

    r = client.get(f"/api/projects/{pid}/activities")
    creates = [
        a
        for a in r.json()["items"]
        if a["action"] == "create" and a["entity_type"] == "string"
    ]
    assert len(creates) == 1
    after = creates[0]["after"]
    uuid.UUID(after["id"])
    assert after["status"] == "public"
    assert after["key"] == "save"
    assert after["tag_ids"] == [tag["id"]]
    assert after["tag_names"] == ["ui"]
    assert after["translations"]["en"] == "Save"
    assert creates[0]["event_type"] == "string.created"
    assert creates[0]["summary"] == "Created 'save'"
    assert all(change["field"] != "published_key" for change in creates[0]["changed"])


def test_string_patch_one_activity_with_translation(client):
    project = _make_project(client, "Patch Snap")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    ).json()

    r = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"key": "save_v2", "translations": {"en": "Saved"}},
    )
    assert r.status_code == 200, r.text

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    updates = [a for a in items if a["action"] == "update" and a["entity_type"] == "string"]
    assert len(updates) == 1
    assert updates[0]["before"]["key"] == "save"
    assert updates[0]["after"]["key"] == "save_v2"
    assert updates[0]["before"]["translations"]["en"] == "Save"
    assert updates[0]["after"]["translations"]["en"] == "Saved"
    assert all(a["entity_type"] != "translation" for a in items)


def test_string_delete_activity_and_revert(client):
    project = _make_project(client, "Delete Snap")
    pid = project["id"]
    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "keep", "color": "#222"},
    ).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "cancel",
            "source_text": "Hủy",
            "tag_ids": [tag["id"]],
            "translations": {"en": "Cancel"},
        },
    ).json()
    sid = created["id"]

    r = client.delete(f"/api/projects/{pid}/strings/{sid}")
    assert r.status_code == 204

    hidden = client.get(f"/api/projects/{pid}/strings").json()
    assert hidden["total"] == 0
    tombstone = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert tombstone["deleted_at"] is not None
    assert tombstone["key"] == "cancel"

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    deletes = [a for a in items if a["action"] == "delete" and a["entity_type"] == "string"]
    assert len(deletes) == 1
    before = deletes[0]["before"]
    assert before["key"] == "cancel"
    assert before["tag_ids"] == [tag["id"]]
    assert before["translations"]["en"] == "Cancel"

    r = client.post(f"/api/projects/{pid}/activities/{deletes[0]['id']}/revert")
    assert r.status_code == 200, r.text
    restored = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert restored["key"] == "cancel"
    assert restored["deleted_at"] is None
    assert restored["tags"][0]["id"] == tag["id"]
    assert restored["translations"][0]["value"] == "Cancel"
    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 1

    after_revert = client.get(f"/api/projects/{pid}/activities").json()["items"]
    new_rows = [a for a in after_revert if a["id"] not in {x["id"] for x in items}]
    assert len(new_rows) == 1
    assert new_rows[0]["batch_kind"] == "revert"
    assert new_rows[0]["event_type"] == "string.restored"
    assert new_rows[0]["summary"] == "Restored previous value of 'cancel'"
    assert new_rows[0]["revert_of_id"] == deletes[0]["id"]


def test_revert_create_and_update_tags_translations(client):
    project = _make_project(client, "Revert Snap")
    pid = project["id"]
    tag_a = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "a", "color": "#aaa"},
    ).json()
    tag_b = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "b", "color": "#bbb"},
    ).json()

    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "ok",
            "source_text": "OK",
            "tag_ids": [tag_a["id"]],
            "translations": {"en": "OK"},
        },
    ).json()
    sid = created["id"]

    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"tag_ids": [tag_b["id"]], "translations": {"en": "Okay"}},
    )
    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    update = next(a for a in items if a["action"] == "update" and a["entity_type"] == "string")
    r = client.post(f"/api/projects/{pid}/activities/{update['id']}/revert")
    assert r.status_code == 200, r.text
    restored = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert restored["tags"][0]["id"] == tag_a["id"]
    assert restored["translations"][0]["value"] == "OK"

    after_revert = client.get(f"/api/projects/{pid}/activities").json()["items"]
    new_rows = [a for a in after_revert if a["id"] not in {x["id"] for x in items}]
    assert len(new_rows) == 1
    assert new_rows[0]["batch_kind"] == "revert"
    assert new_rows[0]["event_type"] == "string.restored"
    assert new_rows[0]["summary"] == "Restored previous value of 'ok'"
    assert not any("Reverted:" in a["summary"] for a in new_rows)
    assert not any("Redid " in a["summary"] for a in new_rows)

    creates = [
        a
        for a in client.get(f"/api/projects/{pid}/activities").json()["items"]
        if a["action"] == "create" and a["entity_type"] == "string" and a["string_id"] == sid
    ]
    r = client.post(f"/api/projects/{pid}/activities/{creates[0]['id']}/revert")
    assert r.status_code == 200, r.text
    tomb = client.get(f"/api/projects/{pid}/strings/{sid}")
    assert tomb.status_code == 200, tomb.text
    assert tomb.json()["deleted_at"] is not None
    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 0


def test_revert_redo_summaries_do_not_stack(client):
    project = _make_project(client, "Revert Ping")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "cancel", "source_text": "Hủy", "status": "public"},
    ).json()
    sid = created["id"]
    client.patch(f"/api/projects/{pid}/strings/{sid}", json={"status": "draft"})

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    update = next(
        a
        for a in items
        if a["action"] == "update" and a["entity_type"] == "string" and a["string_id"] == sid
    )

    summaries = []
    current_id = update["id"]
    for _ in range(3):
        r = client.post(f"/api/projects/{pid}/activities/{current_id}/revert")
        assert r.status_code == 200, r.text
        latest = next(
            a
            for a in client.get(f"/api/projects/{pid}/activities").json()["items"]
            if a["revert_of_id"] == current_id
        )
        assert latest["summary"] == "Restored previous value of 'cancel'"
        assert latest["event_type"] == "string.restored"
        assert "Reverted:" not in latest["summary"]
        assert "Redid " not in latest["summary"]
        summaries.append(latest["summary"])
        current_id = latest["id"]

    assert summaries == [
        "Restored previous value of 'cancel'",
        "Restored previous value of 'cancel'",
        "Restored previous value of 'cancel'",
    ]

