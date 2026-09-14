"""Export, import, and sync state integration tests."""

from __future__ import annotations

import json
import uuid

from tests.helpers import _json_upload, _make_project, publish_strings


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

    overlay = json.dumps({"save": "Saved"}).encode()
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
    assert body["diff"]["create"] == [
        {"key": "auth/password", "source_text": "Mật khẩu"}
    ]
    assert body["diff"]["update"] == [
        {"key": "auth/auth.email", "source_text": "Địa chỉ email"}
    ]

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

    publish_strings(client, pid, [sid])
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
    publish_strings(client, pid, [sid])
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
    assert body["exported"] == []
    assert body["pending_remove"] == ["draft/123ewfewf"]
    assert body["tombstones"] == []

    publish_strings(client, pid, [sid])
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


def test_flat_json_import_keeps_dotted_key_unassigned(client):
    project = _make_project(client, "Flat No Split", layout="flat")
    pid = project["id"]
    client.post(f"/api/projects/{pid}/modules", json={"slug": "common", "name": "Common"})
    r = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "vi"},
        files={
            "file": (
                "vi.json",
                json.dumps({"common.save": "Lưu"}).encode(),
                "application/json",
            )
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    item = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert item["key"] == "common.save"
    assert item["module_id"] is None
    assert item["source_text"] == "Lưu"


def test_modular_json_import_assigns_selected_module(client):
    project = _make_project(client, "Modular Pick")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}
    ).json()
    r = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "vi", "module_id": module["id"]},
        files={
            "file": (
                "vi.json",
                json.dumps({"common.save": "Lưu"}).encode(),
                "application/json",
            )
        },
    )
    assert r.status_code == 200, r.text
    item = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert item["key"] == "common.save"
    assert item["module_slug"] == "auth"


def test_flat_json_import_rejects_module_id(client):
    project = _make_project(client, "Flat Reject Module", layout="flat")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}
    ).json()
    r = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "vi", "module_id": module["id"]},
        files={
            "file": (
                "vi.json",
                json.dumps({"hello": "Xin chào"}).encode(),
                "application/json",
            )
        },
    )
    assert r.status_code == 400, r.text


def test_strings_import_does_not_split_dotted_key(client):
    project = _make_project(client, "Push No Split")
    pid = project["id"]
    client.post(f"/api/projects/{pid}/modules", json={"slug": "common", "name": "Common"})
    r = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"common.save": "Lưu"}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    item = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert item["key"] == "common.save"
    assert item["module_id"] is None


def test_excel_flat_import_does_not_create_modules(client):
    project = _make_project(client, "Excel Flat", layout="flat")
    pid = project["id"]
    tmpl = client.get(f"/api/projects/{pid}/import-template", params={"format": "xlsx"})
    assert tmpl.status_code == 200, tmpl.text
    r = client.post(
        f"/api/projects/{pid}/import",
        files={
            "file": (
                "t.xlsx",
                tmpl.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r.status_code == 200, r.text
    assert client.get(f"/api/projects/{pid}/modules").json() == []
    items = client.get(f"/api/projects/{pid}/strings").json()["items"]
    keys = {s["key"] for s in items}
    assert "common.save" in keys
    assert "hello" in keys
    assert all(s["module_id"] is None for s in items)


def test_excel_modular_import_uses_sheet_slug(client):
    project = _make_project(client, "Excel Modular")
    pid = project["id"]
    tmpl = client.get(f"/api/projects/{pid}/import-template", params={"format": "xlsx"})
    assert tmpl.status_code == 200, tmpl.text
    r = client.post(
        f"/api/projects/{pid}/import",
        files={
            "file": (
                "t.xlsx",
                tmpl.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r.status_code == 200, r.text
    slugs = {m["slug"] for m in client.get(f"/api/projects/{pid}/modules").json()}
    assert {"auth", "common"} <= slugs
    by_key = {s["key"]: s for s in client.get(f"/api/projects/{pid}/strings").json()["items"]}
    assert by_key["auth.email"]["module_slug"] == "auth"
    assert by_key["common.save"]["module_slug"] == "common"
    assert by_key["hello"]["module_id"] is None


def test_import_template_json_is_flat_key_map(client):
    project = _make_project(client, "Template Json", layout="flat")
    pid = project["id"]
    r = client.get(f"/api/projects/{pid}/import-template", params={"format": "json"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["common.save"] == "Lưu"
    assert data["hello"] == "Xin chào"
    assert all(isinstance(v, str) for v in data.values())


def test_import_diff_key_lists_are_capped(client):
    project = _make_project(client, "Cap Diff", layout="flat")
    pid = project["id"]
    strings = {f"k{i:03d}": f"v{i}" for i in range(120)}
    r = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": strings},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 120
    diff = body["diff"]
    assert diff["create_count"] == 120
    assert len(diff["create"]) == 100
    assert all(
        isinstance(item, dict) and "key" in item and "source_text" in item
        for item in diff["create"]
    )
    assert {item["key"] for item in diff["create"]} <= set(strings)
    assert all(item["source_text"] == strings[item["key"]] for item in diff["create"])
    listed = client.get(f"/api/projects/{pid}/strings", params={"page_size": 200}).json()
    assert listed["total"] == 120


def test_json_import_rejects_invalid_and_nested_values(client):
    project = _make_project(client, "Reject Nested")
    pid = project["id"]

    invalid = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("vi.json", b"{not json", "application/json")},
    )
    assert invalid.status_code == 400
    assert "Invalid JSON" in invalid.json()["detail"]

    nested = client.post(
        f"/api/projects/{pid}/import",
        files=_json_upload({"welcome": {"en": "Hi"}}),
    )
    assert nested.status_code == 400
    assert "strings" in nested.json()["detail"]

    array_value = client.post(
        f"/api/projects/{pid}/import",
        files=_json_upload({"welcome": ["Hi"]}),
    )
    assert array_value.status_code == 400
    assert "strings" in array_value.json()["detail"]


def test_partial_json_import_dry_run_and_apply_with_module_tags(client):
    project = _make_project(client, "Paste Many")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "common", "name": "Common"}
    ).json()
    tag = client.post(
        f"/api/projects/{pid}/tags", json={"name": "ios", "color": "#2563eb"}
    ).json()
    existing = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "module_id": module["id"],
        },
    ).json()

    payload = {"save": "Lưu lại", "add_many_new": "Chuỗi mới"}
    dry = client.post(
        f"/api/projects/{pid}/import",
        params={
            "locale": "vi",
            "dry_run": True,
            "partial": True,
            "status": "draft",
            "module_id": module["id"],
            "tag_ids": tag["id"],
        },
        files=_json_upload(payload),
    )
    assert dry.status_code == 200, dry.text
    body = dry.json()
    assert body["dry_run"] is True
    assert body["created"] == 0
    assert body["updated"] == 0
    assert body["diff"]["create_count"] == 1
    assert body["diff"]["update_count"] == 1
    assert body["diff"]["orphan_count"] == 0
    assert {"key": "add_many_new", "source_text": "Chuỗi mới"} in body["diff"]["create"]
    assert {"key": "save", "source_text": "Lưu lại"} in body["diff"]["update"]

    listed = client.get(f"/api/projects/{pid}/strings", params={"page_size": 50}).json()
    keys = {item["key"] for item in listed["items"]}
    assert "add_many_new" not in keys
    save_row = next(item for item in listed["items"] if item["id"] == existing["id"])
    assert save_row["source_text"] == "Lưu"
    assert save_row["tags"] == []

    empty = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "vi", "dry_run": True, "partial": True},
        files=_json_upload({}),
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["diff"]["create_count"] == 0
    assert empty.json()["diff"]["update_count"] == 0
    assert empty.json()["diff"]["orphan_count"] == 0

    applied = client.post(
        f"/api/projects/{pid}/import",
        params={
            "locale": "vi",
            "dry_run": False,
            "partial": True,
            "status": "draft",
            "module_id": module["id"],
            "tag_ids": tag["id"],
        },
        files=_json_upload(payload),
    )
    assert applied.status_code == 200, applied.text
    result = applied.json()
    assert result["dry_run"] is False
    assert result["created"] == 1
    assert result["updated"] == 1
    assert result["batch_id"]

    listed = client.get(
        f"/api/projects/{pid}/strings", params={"page_size": 50}
    ).json()
    items = listed["items"]
    by_key = {item["key"]: item for item in items}
    created = by_key["add_many_new"]
    updated = by_key["save"]
    assert created["status"] == "draft"
    assert created["module_id"] == module["id"]
    assert created["source_text"] == "Chuỗi mới"
    assert created["tags"][0]["id"] == tag["id"]
    assert updated["source_text"] == "Lưu lại"
    assert updated["tags"][0]["id"] == tag["id"]

    feed = client.get(
        f"/api/projects/{pid}/activities/feed",
        params={"event_type": "import"},
    )
    assert feed.status_code == 200, feed.text
    cards = [
        card
        for card in feed.json()["items"]
        if card["batch_id"] == result["batch_id"]
    ]
    assert len(cards) == 1
    assert cards[0]["kind"] == "batch"
    assert cards[0]["children_count"] == 2


def test_json_import_unknown_tag_is_rejected(client):
    project = _make_project(client, "Bad Tag")
    pid = project["id"]
    r = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "vi", "tag_ids": str(uuid.uuid4()), "partial": True},
        files=_json_upload({"hello": "Xin chào"}),
    )
    assert r.status_code == 400
    assert "Unknown tag" in r.json()["detail"]

