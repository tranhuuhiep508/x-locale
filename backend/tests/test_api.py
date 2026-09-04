"""Smoke tests for core API flows."""

from __future__ import annotations

import json
import uuid


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_me_dev_bypass(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "dev@localhost"


def test_auth_me_unauthorized_without_bypass(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_login_503_when_neither_bypass_nor_oidc(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    r = client.get("/api/auth/login", follow_redirects=False)
    assert r.status_code == 503


def test_bypass_skipped_when_oidc_configured(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "oidc_issuer", "https://login.microsoftonline.com/common/v2.0")
    monkeypatch.setattr(settings, "oidc_client_id", "test-client")
    monkeypatch.setattr(settings, "oidc_client_secret", "test-secret")
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_create_project_and_string(client):
    r = client.post(
        "/api/projects",
        json={
            "name": "Test App",
            "base_language": "vi",
            "target_languages": ["en"],
            "layout": "modular",
        },
    )
    assert r.status_code == 201, r.text
    project = r.json()
    assert project["slug"] == "test-app"
    assert project["base_language"] == "vi"
    pid = project["id"]

    # Create module
    r = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
    )
    assert r.status_code == 201, r.text
    module = r.json()

    # Create string
    r = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "module_id": module["id"],
        },
    )
    assert r.status_code == 201, r.text
    string = r.json()
    assert string["key"] == "save"
    assert string["status"] == "draft"
    assert len(string["translations"]) == 1
    assert string["translations"][0]["locale"] == "en"

    # Upsert translation (value only; does not change string status)
    r = client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/en",
        json={"value": "Save"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["translations"][0]["value"] == "Save"
    assert r.json()["status"] == "draft"

    # Publish string
    r = client.patch(
        f"/api/projects/{pid}/strings/{string['id']}",
        json={"status": "public"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "public"

    # List strings
    r = client.get(f"/api/projects/{pid}/strings")
    assert r.status_code == 200
    assert r.json()["total"] == 1

    # Export flat public
    r = client.get(f"/api/projects/{pid}/export?layout=flat&stage=public")
    assert r.status_code == 200
    data = r.json()
    assert "en" in data
    assert data["en"]["common.save"] == "Save"
    assert data["vi"]["common.save"] == "Lưu"

    # Activities recorded
    r = client.get(f"/api/projects/{pid}/activities")
    assert r.status_code == 200
    assert r.json()["total"] >= 1


def test_api_key_auth(client):
    r = client.post(
        "/api/projects",
        json={"name": "Keyed", "target_languages": ["en"]},
    )
    assert r.status_code == 201
    pid = r.json()["id"]

    r = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "ci"},
    )
    assert r.status_code == 201, r.text
    raw_key = r.json()["key"]
    assert raw_key.startswith("tms_")

    r = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": raw_key},
    )
    assert r.status_code == 200


def test_api_key_write_activity_uses_key_not_owner(client):
    pid = _make_project(client, "Keyed Owner")["id"]
    created_key = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "alice-laptop"},
    )
    assert created_key.status_code == 201, created_key.text
    raw_key = created_key.json()["key"]
    key_id = created_key.json()["id"]

    r = client.post(
        f"/api/projects/{pid}/strings/import",
        headers={"X-API-Key": raw_key},
        json={"strings": {"hello": "Xin chào"}},
    )
    assert r.status_code == 200, r.text

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    created = [
        a for a in items if a["action"] == "create" and a["entity_type"] == "string"
    ]
    assert created
    assert created[0]["actor_type"] == "api_key"
    assert created[0]["actor_label"] == "alice-laptop"
    assert created[0]["actor_id"] == key_id


def test_generate_api_key_revokes_previous_personal_key(client):
    pid = _make_project(client, "Keyed Rotate")["id"]
    first = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "first"},
    )
    assert first.status_code == 201, first.text
    old_key = first.json()["key"]

    second = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "second"},
    )
    assert second.status_code == 201, second.text
    new_key = second.json()["key"]
    assert new_key != old_key

    stale = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": old_key},
    )
    assert stale.status_code == 401

    fresh = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": new_key},
    )
    assert fresh.status_code == 200

    listed = client.get(f"/api/projects/{pid}/api-keys").json()
    assert len(listed) == 1
    assert listed[0]["name"] == "second"


def test_generate_api_key_does_not_revoke_unowned_key(client):
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey

    pid = _make_project(client, "Keyed Keep Demo")["id"]
    r = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "github-actions"},
    )
    assert r.status_code == 201, r.text
    unowned_key = r.json()["key"]
    unowned_id = r.json()["id"]

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        key = db.query(ApiKey).filter(ApiKey.id == uuid.UUID(unowned_id)).first()
        assert key is not None
        key.created_by = None
        db.commit()
    finally:
        db_gen.close()

    personal = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "dev@localhost"},
    )
    assert personal.status_code == 201, personal.text

    still_valid = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": unowned_key},
    )
    assert still_valid.status_code == 200

    listed = client.get(f"/api/projects/{pid}/api-keys").json()
    names = {k["name"] for k in listed}
    assert names == {"github-actions", "dev@localhost"}


def test_api_key_write_activity_without_owner(client):
    from app.database import get_db
    from app.main import app
    from app.models import ApiKey

    pid = _make_project(client, "Keyed CI")["id"]
    r = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "github-actions"},
    )
    assert r.status_code == 201, r.text
    raw_key = r.json()["key"]
    key_id = r.json()["id"]

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        key = db.query(ApiKey).filter(ApiKey.id == uuid.UUID(key_id)).first()
        assert key is not None
        key.created_by = None
        db.commit()
    finally:
        db_gen.close()

    r = client.post(
        f"/api/projects/{pid}/strings/import",
        headers={"X-API-Key": raw_key},
        json={"strings": {"bye": "Tạm biệt"}},
    )
    assert r.status_code == 200, r.text

    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    created = [
        a for a in items if a["action"] == "create" and a["entity_type"] == "string"
    ]
    assert created
    assert created[0]["actor_type"] == "api_key"
    assert created[0]["actor_label"] == "github-actions"


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


def _make_project(client, name="Act", targets=None):
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


def test_translate_preview_does_not_persist(client, monkeypatch):
    project = _make_project(client, "Preview", targets=["en", "ja"])
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    )

    def fake_batch(source_locale, items):
        item = items[0]
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    r = client.post(
        f"/api/projects/{pid}/translate/preview",
        json={"source_text": "Xin chào", "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["translations"]["en"] == "en:Xin chào"
    assert r.json()["translations"]["ja"] == "ja:Xin chào"

    after = client.get(f"/api/projects/{pid}/activities").json()["total"]
    assert after == before
    string = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(t["value"] == "" for t in string["translations"])


def test_translate_fills_all_locales_in_one_batch(client, monkeypatch):
    project = _make_project(client, "Batch Translate", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    calls: list = []

    def fake_batch(source_locale, items):
        calls.append(items)
        item = items[0]
        assert item.locales == ("en", "ja")
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en", "ja"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 2
    assert len(calls) == 1

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "en:Xin chào"
    assert by_locale["ja"] == "ja:Xin chào"


def test_translate_skips_filled_locale_unless_overwrite(client, monkeypatch):
    project = _make_project(client, "Skip Filled", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
        },
    ).json()

    def fake_batch(source_locale, items):
        assert len(items) == 1
        assert items[0].locales == ("ja",)
        return {items[0].id: {"ja": "こんにちは"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en", "ja"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 1

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "Hello"
    assert by_locale["ja"] == "こんにちは"


def test_translate_proposals_do_not_persist(client, monkeypatch):
    project = _make_project(client, "Propose", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items):
        item = items[0]
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "missing", "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] is None
    assert len(body["items"]) == 1
    assert body["items"][0]["string_id"] == string["id"]
    assert body["items"][0]["translations"]["en"] == "en:Xin chào"
    assert body["items"][0]["translations"]["ja"] == "ja:Xin chào"

    after = client.get(f"/api/projects/{pid}/activities").json()["total"]
    assert after == before
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(t["value"] == "" for t in stored["translations"])


def test_translate_missing_lists_empty_locales_without_ai(client, monkeypatch):
    project = _make_project(client, "Missing List", targets=["en", "ja"])
    pid = project["id"]
    filled = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
        },
    ).json()
    empty = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "bye", "source_text": "Tạm biệt"},
    ).json()

    def fail_batch(*args, **kwargs):
        raise AssertionError("AI should not run when listing missing translations")

    monkeypatch.setattr("app.services.translate.translate_batch", fail_batch)

    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    r = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] is None
    by_key = {item["key"]: item for item in body["items"]}
    assert "en" not in by_key["hi"]["translations"]
    assert by_key["hi"]["translations"]["ja"] == ""
    assert by_key["hi"]["string_id"] == filled["id"]
    assert by_key["bye"]["translations"] == {"en": "", "ja": ""}
    assert by_key["bye"]["string_id"] == empty["id"]
    assert "description" in by_key["hi"]
    assert "description" in by_key["bye"]
    after = client.get(f"/api/projects/{pid}/activities").json()["total"]
    assert after == before
    stored = {s["key"]: s for s in client.get(f"/api/projects/{pid}/strings").json()["items"]}
    assert {t["locale"]: t["value"] for t in stored["hi"]["translations"]}["en"] == "Hello"
    assert all(t["value"] == "" for t in stored["bye"]["translations"])


def test_translate_proposals_omit_filled_locales(client, monkeypatch):
    project = _make_project(client, "Propose Skip", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
        },
    ).json()

    def fake_batch(source_locale, items):
        assert items[0].locales == ("ja",)
        return {items[0].id: {"ja": "こんにちは", "en": "should-not-use"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en", "ja"],
        },
    )
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert "en" not in item["translations"]
    assert item["translations"]["ja"] == "こんにちは"


def test_translate_apply_persists_and_is_revertible(client, monkeypatch):
    project = _make_project(client, "Apply", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items):
        item = items[0]
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    proposed = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [string["id"]], "locales": ["en", "ja"]},
    ).json()["items"]

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={"items": proposed},
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 2
    batch_id = r.json()["batch_id"]

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "en:Xin chào"
    assert by_locale["ja"] == "ja:Xin chào"
    assert refreshed["status"] == "draft"

    activities = client.get(f"/api/projects/{pid}/activities").json()["items"]
    translate_rows = [a for a in activities if a["batch_kind"] == "translate"]
    assert translate_rows
    assert all(a["batch_id"] == batch_id for a in translate_rows)

    revert = client.post(f"/api/projects/{pid}/activities/batch/{batch_id}/revert")
    assert revert.status_code == 200, revert.text
    restored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(t["value"] == "" for t in restored["translations"])


def test_translate_apply_skips_locale_filled_after_preview(client):
    project = _make_project(client, "Apply Skip", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/en",
        json={"value": "Hello"},
    )

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "translations": {"en": "AI Hello", "ja": "こんにちは"},
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 1

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "Hello"
    assert by_locale["ja"] == "こんにちは"


def test_translate_apply_saves_description(client):
    project = _make_project(client, "Apply Description", targets=["en"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "description": "Greeting on the home screen",
                    "translations": {"en": "Hello"},
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert refreshed["description"] == "Greeting on the home screen"
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "Hello"


def test_translate_stores_confidence_and_manual_edit_clears_it(client, monkeypatch):
    from app.ai import TranslatedCell

    project = _make_project(client, "Score Persist", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items):
        item = items[0]
        return {
            item.id: {
                "en": TranslatedCell(text="Hello", confidence=92),
                "ja": TranslatedCell(text="こんにちは", confidence=61),
            }
        }

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={"scope": "strings", "string_ids": [string["id"]], "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t for t in refreshed["translations"]}
    assert by_locale["en"]["value"] == "Hello"
    assert by_locale["en"]["confidence"] == 92
    assert by_locale["ja"]["value"] == "こんにちは"
    assert by_locale["ja"]["confidence"] == 61

    client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/ja",
        json={"value": "やあ"},
    )
    after_edit = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    edited = {t["locale"]: t for t in after_edit["translations"]}
    assert edited["ja"]["value"] == "やあ"
    assert edited["ja"]["confidence"] is None
    assert edited["en"]["confidence"] == 92

    listed = client.get(f"/api/projects/{pid}/strings", params={"max_confidence": 70})
    assert listed.status_code == 200
    assert listed.json()["total"] == 0

    listed_high = client.get(f"/api/projects/{pid}/strings", params={"max_confidence": 95})
    assert listed_high.json()["total"] == 1


def test_translate_preview_and_apply_include_scores(client, monkeypatch):
    from app.ai import TranslatedCell

    project = _make_project(client, "Score Preview", targets=["en"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items):
        item = items[0]
        return {item.id: {"en": TranslatedCell(text="Hello", confidence=74)}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    preview = client.post(
        f"/api/projects/{pid}/translate/preview",
        json={"source_text": "Xin chào", "locales": ["en"]},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["translations"]["en"] == "Hello"
    assert preview.json()["scores"]["en"] == 74

    proposed = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [string["id"]], "locales": ["en"]},
    ).json()["items"]
    assert proposed[0]["translations"]["en"] == "Hello"
    assert proposed[0]["scores"]["en"] == 74

    applied = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={"items": proposed},
    )
    assert applied.status_code == 200, applied.text
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    en = next(t for t in stored["translations"] if t["locale"] == "en")
    assert en["value"] == "Hello"
    assert en["confidence"] == 74

    needs_review = client.get(f"/api/projects/{pid}/strings", params={"max_confidence": 79})
    assert needs_review.json()["total"] == 1


def test_save_with_translation_scores(client):
    project = _make_project(client, "Score Save", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
            "translation_scores": {"en": 81},
        },
    ).json()
    en = next(t for t in created["translations"] if t["locale"] == "en")
    assert en["confidence"] == 81

    updated = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"translations": {"en": "Hi there"}},
    ).json()
    en = next(t for t in updated["translations"] if t["locale"] == "en")
    assert en["value"] == "Hi there"
    assert en["confidence"] is None


def test_translate_proposals_large_uses_job(client, monkeypatch):
    project = _make_project(client, "Propose Job", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    monkeypatch.setattr("app.routers.translate.run_propose_job", lambda *args, **kwargs: None)

    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"]},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert job_id
    assert r.json()["items"] == []

    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["kind"] == "translate_proposals"
    assert job["status"] == "pending"


def test_export_stage_all_and_locale_filter(client):
    project = _make_project(client, "Export All")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    ).json()
    client.patch(f"/api/projects/{pid}/strings/{created['id']}", json={"status": "public"})
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "drafty", "source_text": "Nháp"},
    )

    r = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "all"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "save" in data["vi"] and "drafty" in data["vi"]
    assert r.headers["content-disposition"].endswith('.json"')

    r = client.get(
        f"/api/projects/{pid}/export",
        params={"layout": "flat", "stage": "public", "locale": "en"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert list(data.keys()) == ["en"]
    assert data["en"]["save"] == "Save"
    assert "drafty" not in data["en"]


def test_json_file_import_roundtrip_and_locale_overlay(client):
    project = _make_project(client, "Import Round")
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
    )
    client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "module_id": client.get(f"/api/projects/{pid}/modules").json()[0]["id"],
            "translations": {"en": "Save"},
            "status": "public",
        },
    )

    exported = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "draft"}
    )
    assert exported.status_code == 200, exported.text

    r = client.post(
        f"/api/projects/{pid}/import",
        params={"dry_run": True},
        files={"file": ("export.json", exported.content, "application/json")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["dry_run"] is True

    overlay = json.dumps({"common.save": "Saved"}).encode()
    r = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "en", "dry_run": False},
        files={"file": ("en.json", overlay, "application/json")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 1

    string = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert string["source_text"] == "Lưu"
    assert by_locale["en"] == "Saved"


def test_xlsx_export_import_roundtrip(client):
    project = _make_project(client, "Excel Round")
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hello", "source_text": "Xin chào", "translations": {"en": "Hello"}},
    )

    exported = client.get(f"/api/projects/{pid}/export", params={"format": "xlsx", "stage": "all"})
    assert exported.status_code == 200, exported.text
    assert "spreadsheetml" in exported.headers["content-type"]

    r = client.post(
        f"/api/projects/{pid}/import",
        files={
            "file": (
                "bundle.xlsx",
                exported.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r.status_code == 200, r.text

    r = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"hello": "Xin chào", "bye": "Tạm biệt"}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    keys = {s["key"] for s in client.get(f"/api/projects/{pid}/strings").json()["items"]}
    assert keys == {"hello", "bye"}


def test_strings_import_modules_payload_keeps_key_and_module(client):
    project = _make_project(client, "Modular Push")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "auth", "name": "Auth"},
    ).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "auth.email",
            "source_text": "Email",
            "module_id": module["id"],
        },
    )

    r = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"modules": {"auth": {"vi": {"auth.email": "Địa chỉ email", "password": "Mật khẩu"}}}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 1
    assert body["updated"] == 1
    assert body["diff"]["create"] == ["auth/password"]
    assert body["diff"]["update"] == ["auth/auth.email"]

    items = client.get(f"/api/projects/{pid}/strings").json()["items"]
    by_key = {s["key"]: s for s in items}
    assert set(by_key) == {"auth.email", "password"}
    assert by_key["auth.email"]["source_text"] == "Địa chỉ email"
    assert by_key["auth.email"]["module_slug"] == "auth"
    assert by_key["password"]["module_slug"] == "auth"


def test_edit_public_string_keeps_published_export(client):
    project = _make_project(client, "Working Copy")
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
    assert created["status"] == "public"
    assert created["has_unpublished_changes"] is False
    assert created["pending_delete"] is False

    r = client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "Lưu ngay", "translations": {"en": "Save now"}},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["status"] == "public"
    assert updated["has_unpublished_changes"] is True
    assert updated["source_text"] == "Lưu ngay"
    assert updated["published_source_text"] == "Lưu"
    assert updated["published_key"] == "save"
    en = next(item for item in updated["translations"] if item["locale"] == "en")
    assert en["value"] == "Save now"
    assert en["published_value"] == "Save"

    public = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}).json()
    draft = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "draft"}).json()
    assert public["vi"]["save"] == "Lưu"
    assert public["en"]["save"] == "Save"
    assert draft["vi"]["save"] == "Lưu ngay"
    assert draft["en"]["save"] == "Save now"

    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )
    public = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}).json()
    assert public["vi"]["save"] == "Lưu ngay"
    assert public["en"]["save"] == "Save now"
    refreshed = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert refreshed["has_unpublished_changes"] is False


def test_delete_public_string_is_pending_until_publish(client):
    project = _make_project(client, "Pending Delete")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "bye", "source_text": "Tạm biệt", "status": "public", "translations": {"en": "Bye"}},
    ).json()
    sid = created["id"]

    r = client.delete(f"/api/projects/{pid}/strings/{sid}")
    assert r.status_code == 204
    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["pending_delete"] is True
    assert row["has_unpublished_changes"] is True
    assert row["status"] == "public"

    draft = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "draft"}).json()
    public = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}).json()
    assert "bye" not in draft["vi"]
    assert public["vi"]["bye"] == "Tạm biệt"
    assert public["en"]["bye"] == "Bye"

    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "discard_delete", "string_ids": [sid]},
    )
    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["pending_delete"] is False

    client.delete(f"/api/projects/{pid}/strings/{sid}")
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )
    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 0
    tombstone = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert tombstone["deleted_at"] is not None
    assert tombstone["pending_delete"] is False
    public = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}
    ).json()
    assert "bye" not in public["vi"]

    deleted = client.get(f"/api/projects/{pid}/strings", params={"deleted": True}).json()
    assert deleted["total"] == 1
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "restore", "string_ids": [sid]},
    )
    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 1
    public = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}
    ).json()
    assert public["vi"]["bye"] == "Tạm biệt"


def test_sync_state_lists_pending_remove_hidden_from_draft_export(client):
    project = _make_project(client, "Sync State")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "draft", "name": "Draft"},
    ).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "123ewfewf",
            "source_text": "sfdsfds",
            "status": "public",
            "module_id": module["id"],
        },
    ).json()
    sid = created["id"]
    assert client.delete(f"/api/projects/{pid}/strings/{sid}").status_code == 204

    draft = client.get(
        f"/api/projects/{pid}/export", params={"layout": "modular", "stage": "draft"}
    ).json()
    draft_vi = (draft.get("modules") or {}).get("draft", {}).get("vi", {})
    assert "123ewfewf" not in draft_vi

    state = client.get(
        f"/api/projects/{pid}/sync-state",
        params={"layout": "modular", "stage": "draft"},
    )
    assert state.status_code == 200, state.text
    body = state.json()
    assert body["stage"] == "draft"
    assert body["layout"] == "modular"
    assert body["base_language"] == "vi"
    assert "draft/123ewfewf" not in body["exported"]
    assert body["pending_remove"] == ["draft/123ewfewf"]
    assert body["tombstones"] == []

    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "publish", "string_ids": [sid]},
    )
    after = client.get(
        f"/api/projects/{pid}/sync-state",
        params={"layout": "modular", "stage": "draft"},
    ).json()
    assert after["pending_remove"] == []
    assert after["tombstones"] == ["draft/123ewfewf"]


def test_never_published_delete_is_soft(client):
    project = _make_project(client, "Soft Draft")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "draft_key", "source_text": "Nháp"},
    ).json()
    sid = created["id"]
    assert client.delete(f"/api/projects/{pid}/strings/{sid}").status_code == 204
    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 0
    row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert row["deleted_at"] is not None
    draft = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "draft"}
    ).json()
    assert "draft_key" not in draft["vi"]
    again = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "draft_key", "source_text": "Nháp 2"},
    )
    assert again.status_code == 201, again.text
    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] != sid
    assert listed["items"][0]["source_text"] == "Nháp 2"


def test_unpublish_omits_from_public_export_immediately(client):
    project = _make_project(client, "Unpublish Now")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "ok", "source_text": "OK", "status": "public"},
    ).json()
    client.patch(f"/api/projects/{pid}/strings/{created['id']}", json={"status": "draft"})
    public = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}).json()
    draft = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "draft"}).json()
    assert "ok" not in public["vi"]
    assert draft["vi"]["ok"] == "OK"


def test_import_and_ai_apply_do_not_promote(client):
    project = _make_project(client, "No Auto Publish", targets=["en", "ja"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}, "status": "public"},
    ).json()

    overlay = json.dumps({"save": "Saved"}).encode()
    r = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "en", "dry_run": False},
        files={"file": ("en.json", overlay, "application/json")},
    )
    assert r.status_code == 200, r.text
    string = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert by_locale["en"] == "Saved"
    assert string["status"] == "public"
    assert string["has_unpublished_changes"] is True
    public = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}).json()
    assert public["en"]["save"] == "Save"

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": created["id"],
                    "translations": {"en": "AI Save", "ja": "保存"},
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    string = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    by_locale = {t["locale"]: t["value"] for t in string["translations"]}
    assert by_locale["en"] == "Saved"
    assert by_locale["ja"] == "保存"
    assert string["status"] == "public"
    public = client.get(
        f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}
    ).json()
    assert public["en"]["save"] == "Save"
    assert public["ja"]["save"] == ""


def test_excel_update_does_not_flip_status(client):
    project = _make_project(client, "Excel Status")
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hello", "source_text": "Xin chào", "translations": {"en": "Hello"}, "status": "public"},
    )
    exported = client.get(f"/api/projects/{pid}/export", params={"format": "xlsx", "stage": "all"})
    r = client.post(
        f"/api/projects/{pid}/import",
        files={
            "file": (
                "bundle.xlsx",
                exported.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r.status_code == 200, r.text
    string = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert string["status"] == "public"


def test_revert_edit_does_not_change_published_snapshot(client):
    project = _make_project(client, "Revert Edit")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}, "status": "public"},
    ).json()
    sid = created["id"]
    client.patch(f"/api/projects/{pid}/strings/{sid}", json={"source_text": "Lưu 2"})
    items = client.get(f"/api/projects/{pid}/activities").json()["items"]
    update = next(a for a in items if a["action"] == "update" and a["entity_type"] == "string")
    r = client.post(f"/api/projects/{pid}/activities/{update['id']}/revert")
    assert r.status_code == 200, r.text
    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert string["source_text"] == "Lưu"
    assert string["status"] == "public"
    public = client.get(f"/api/projects/{pid}/export", params={"layout": "flat", "stage": "public"}).json()
    assert public["vi"]["save"] == "Lưu"


def test_discard_changes_restores_published_working_copy(client):
    project = _make_project(client, "Discard")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}, "status": "public"},
    ).json()
    sid = created["id"]
    client.patch(f"/api/projects/{pid}/strings/{sid}", json={"key": "save_v2", "source_text": "Lưu 2"})
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "discard_changes", "string_ids": [sid]},
    )
    assert r.status_code == 200, r.text
    string = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert string["key"] == "save"
    assert string["source_text"] == "Lưu"
    assert string["has_unpublished_changes"] is False


def test_list_filter_unpublished_changes(client):
    project = _make_project(client, "Filter Dirty")
    pid = project["id"]
    public = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "a", "source_text": "A", "status": "public"},
    ).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "b", "source_text": "B"},
    )
    client.patch(f"/api/projects/{pid}/strings/{public['id']}", json={"source_text": "A2"})
    r = client.get(f"/api/projects/{pid}/strings", params={"has_unpublished_changes": True})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "a"
