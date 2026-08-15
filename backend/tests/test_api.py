"""Smoke tests for core API flows."""

from __future__ import annotations

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


def test_snapshot_restore(client):
    r = client.post(
        "/api/projects",
        json={"name": "Snap", "target_languages": ["en"]},
    )
    pid = r.json()["id"]
    r = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
    )
    sid = r.json()["id"]

    r = client.post(
        f"/api/projects/{pid}/snapshots",
        json={"name": "v1", "description": "first"},
    )
    assert r.status_code == 201, r.text
    snap_id = r.json()["id"]

    # Mutate
    client.put(
        f"/api/projects/{pid}/strings/{sid}/translations/en",
        json={"value": "Hello"},
    )
    client.patch(
        f"/api/projects/{pid}/strings/{sid}",
        json={"source_text": "CHANGED"},
    )

    r = client.post(f"/api/projects/{pid}/snapshots/{snap_id}/restore")
    assert r.status_code == 200, r.text

    r = client.get(f"/api/projects/{pid}/strings/{sid}")
    assert r.json()["source_text"] == "Xin chào"


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
    assert after["translations"]["en"] == "Save"


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
    assert restored["tags"][0]["id"] == tag["id"]
    assert restored["translations"][0]["value"] == "Cancel"

    after_revert = client.get(f"/api/projects/{pid}/activities").json()["items"]
    new_rows = [a for a in after_revert if a["id"] not in {x["id"] for x in items}]
    assert len(new_rows) == 1
    assert new_rows[0]["batch_kind"] == "revert"
    assert new_rows[0]["summary"] == "Reverted delete of 'cancel'"
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
    assert new_rows[0]["summary"] == "Reverted update of 'ok'"
    assert not any("Reverted:" in a["summary"] for a in new_rows)

    creates = [
        a
        for a in client.get(f"/api/projects/{pid}/activities").json()["items"]
        if a["action"] == "create" and a["entity_type"] == "string" and a["string_id"] == sid
    ]
    r = client.post(f"/api/projects/{pid}/activities/{creates[0]['id']}/revert")
    assert r.status_code == 200, r.text
    r = client.get(f"/api/projects/{pid}/strings/{sid}")
    assert r.status_code == 404


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
    for expected in (
        "Reverted update of 'cancel'",
        "Redid update of 'cancel'",
        "Reverted update of 'cancel'",
    ):
        r = client.post(f"/api/projects/{pid}/activities/{current_id}/revert")
        assert r.status_code == 200, r.text
        latest = next(
            a
            for a in client.get(f"/api/projects/{pid}/activities").json()["items"]
            if a["revert_of_id"] == current_id
        )
        assert latest["summary"] == expected
        assert "Reverted:" not in latest["summary"]
        summaries.append(latest["summary"])
        current_id = latest["id"]

    assert summaries == [
        "Reverted update of 'cancel'",
        "Redid update of 'cancel'",
        "Reverted update of 'cancel'",
    ]


def test_translate_preview_does_not_persist(client, monkeypatch):
    project = _make_project(client, "Preview", targets=["en", "ja"])
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    )

    def fake_translate(source_text, source_locale, target_locale, context=None):
        return f"{target_locale}:{source_text}"

    monkeypatch.setattr("app.routers.translate.translate_text", fake_translate)

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
