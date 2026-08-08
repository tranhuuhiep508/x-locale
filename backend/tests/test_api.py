"""Smoke tests for core API flows."""

from __future__ import annotations


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
    assert len(string["translations"]) == 1
    assert string["translations"][0]["locale"] == "en"
    assert string["translations"][0]["status"] == "draft"

    # Upsert translation
    r = client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/en",
        json={"value": "Save", "status": "public"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["translations"][0]["value"] == "Save"
    assert r.json()["translations"][0]["status"] == "public"

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
    assert r.json()["affected"] >= 1

    r = client.get(f"/api/projects/{pid}/strings/{sid}")
    statuses = {t["locale"]: t["status"] for t in r.json()["translations"]}
    assert statuses["en"] == "public"


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

    client.put(
        f"/api/projects/{pid}/strings/{s1['id']}/translations/en",
        json={"value": "Log in", "status": "public"},
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

    # status=public finds fully published records
    r = client.get(f"/api/projects/{pid}/strings", params={"status": "public"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "login"

    # status=draft finds records that still have draft translations
    r = client.get(f"/api/projects/{pid}/strings", params={"status": "draft"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "welcome"

    # missing locale filter
    r = client.get(f"/api/projects/{pid}/strings", params={"missing_locale": "en"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["key"] == "welcome"

