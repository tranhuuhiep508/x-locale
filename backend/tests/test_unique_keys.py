"""Live string keys are unique across a project."""

from __future__ import annotations

import io

from openpyxl import Workbook

from app.excel import FLAT_SHEET, UNASSIGNED_SHEET
from tests.helpers import json_upload, make_project, publish_strings


def _modules(client, pid):
    return client.get(f"/api/projects/{pid}/modules").json()


def _strings(client, pid):
    return client.get(f"/api/projects/{pid}/strings").json()["items"]


def _xlsx(sheets: dict[str, list[tuple[str, str]]]) -> bytes:
    wb = Workbook()
    first = True
    for name, rows in sheets.items():
        ws = wb.active if first else wb.create_sheet(name)
        if first:
            ws.title = name
            first = False
        ws.append(["key", "vi"])
        for key, value in rows:
            ws.append([key, value])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload_xlsx(client, pid, content: bytes, *, dry_run: bool = False):
    params = {"dry_run": "true"} if dry_run else None
    return client.post(
        f"/api/projects/{pid}/import",
        params=params,
        files={
            "file": (
                "book.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


def test_create_rejects_same_key_in_another_module_and_same_module(client):
    project = make_project(client, "Unique Create")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    home = client.post(f"/api/projects/{pid}/modules", json={"slug": "home", "name": "Home"}).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    assert created.status_code == 201, created.text

    same = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu lại", "module_id": auth["id"]},
    )
    assert same.status_code == 409, same.text
    assert same.json()["detail"] == "String 'save' already exists"

    other = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu nhà", "module_id": home["id"]},
    )
    assert other.status_code == 409, other.text
    assert other.json()["detail"] == "String 'save' already exists"
    assert len(_strings(client, pid)) == 1


def test_pending_delete_still_holds_the_key(client):
    project = make_project(client, "Pending Holds Key")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "status": "public"},
    ).json()
    publish_strings(client, pid, [created["id"]])
    deleted = client.delete(f"/api/projects/{pid}/strings/{created['id']}")
    assert deleted.status_code == 204, deleted.text
    row = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert row["pending_delete"] is True
    assert row["deleted_at"] is None

    again = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Khác"},
    )
    assert again.status_code == 409, again.text


def test_rename_conflicts_but_module_move_does_not(client):
    project = make_project(client, "Unique Rename")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    home = client.post(f"/api/projects/{pid}/modules", json={"slug": "home", "name": "Home"}).json()
    first = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    ).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "cancel", "source_text": "Hủy", "module_id": home["id"]},
    )

    renamed = client.patch(
        f"/api/projects/{pid}/strings/{first['id']}",
        json={"key": "cancel"},
    )
    assert renamed.status_code == 409, renamed.text
    assert renamed.json()["detail"] == "String 'cancel' already exists"
    assert client.get(f"/api/projects/{pid}/strings/{first['id']}").json()["key"] == "save"

    moved = client.patch(
        f"/api/projects/{pid}/strings/{first['id']}",
        json={"module_id": home["id"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["module_id"] == home["id"]
    assert moved.json()["key"] == "save"


def test_tombstone_in_another_module_allows_create(client):
    project = make_project(client, "Tombstone Recreate")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    home = client.post(f"/api/projects/{pid}/modules", json={"slug": "home", "name": "Home"}).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    ).json()
    assert client.delete(f"/api/projects/{pid}/strings/{created['id']}").status_code == 204
    tomb = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert tomb["deleted_at"] is not None

    again = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu nhà", "module_id": home["id"]},
    )
    assert again.status_code == 201, again.text
    assert again.json()["module_id"] == home["id"]
    assert again.json()["source_text"] == "Lưu nhà"


def test_modular_import_rejects_key_owned_by_another_module(client):
    project = make_project(client, "Modular Cross")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    assert created.status_code == 201, created.text

    imported = client.post(
        f"/api/projects/{pid}/import",
        files=json_upload(
            {"modules": {"home": {"vi": {"save": "Khác"}}}},
            name="modules.json",
        ),
    )
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' already exists in module 'auth'"
    row = _strings(client, pid)[0]
    assert row["source_text"] == "Lưu"
    assert row["module_id"] == auth["id"]
    assert {m["slug"] for m in _modules(client, pid)} == {"auth"}


def test_modular_import_rejects_key_in_two_modules(client):
    project = make_project(client, "Modular Dup Payload")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/import",
        files=json_upload(
            {
                "modules": {
                    "auth": {"vi": {"save": "A"}},
                    "home": {"vi": {"save": "B"}},
                },
                "unassigned": {"vi": {"other": "C"}},
            },
            name="modules.json",
        ),
    )
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' appears in more than one module"
    assert _strings(client, pid) == []
    assert _modules(client, pid) == []


def test_modular_import_rejects_unassigned_collision(client):
    project = make_project(client, "Unassigned Collision")
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu"},
    )
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"modules": {"auth": {"vi": {"save": "Khác"}}}},
    )
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' already exists in module 'unassigned'"
    assert _modules(client, pid) == []
    assert _strings(client, pid)[0]["source_text"] == "Lưu"


def test_json_import_with_module_id_uses_modular_check(client):
    project = make_project(client, "Named Json")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    home = client.post(f"/api/projects/{pid}/modules", json={"slug": "home", "name": "Home"}).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    imported = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": "vi", "module_id": home["id"]},
        files=json_upload({"save": "Khác"}),
    )
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' already exists in module 'auth'"
    row = _strings(client, pid)[0]
    assert row["source_text"] == "Lưu"
    assert row["module_id"] == auth["id"]


def test_flat_import_updates_existing_key_without_moving_module(client):
    project = make_project(client, "Flat Update")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"save": "Đã lưu"}},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["updated"] == 1
    assert imported.json()["created"] == 0
    rows = _strings(client, pid)
    assert len(rows) == 1
    assert rows[0]["source_text"] == "Đã lưu"
    assert rows[0]["module_id"] == auth["id"]


def test_flat_import_refuses_to_insert_a_second_live_row(client, monkeypatch):
    project = make_project(client, "Flat Second")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )

    def _miss(self, key, *, module_id):
        del self, key, module_id
        return None

    monkeypatch.setattr("app.services.sync._ImportIndex.lookup", _miss)
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"save": "Khác", "other": "Mới"}},
    )
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' already exists"
    rows = _strings(client, pid)
    assert len(rows) == 1
    assert rows[0]["key"] == "save"
    assert rows[0]["source_text"] == "Lưu"
    assert rows[0]["module_id"] == auth["id"]


def test_excel_modular_sheet_rejects_key_from_another_module(client):
    project = make_project(client, "Excel Cross")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    content = _xlsx({"home": [("save", "Khác")]})
    dry = _upload_xlsx(client, pid, content, dry_run=True)
    assert dry.status_code == 409, dry.text
    assert dry.json()["detail"] == "String 'save' already exists in module 'auth'"

    applied = _upload_xlsx(client, pid, content)
    assert applied.status_code == 409, applied.text
    row = _strings(client, pid)[0]
    assert row["source_text"] == "Lưu"
    assert row["module_id"] == auth["id"]
    assert {m["slug"] for m in _modules(client, pid)} == {"auth"}


def test_excel_workbook_rejects_same_key_on_two_sheets(client):
    project = make_project(client, "Excel Two Sheets")
    pid = project["id"]
    content = _xlsx({"auth": [("save", "A")], "home": [("save", "B")]})
    imported = _upload_xlsx(client, pid, content)
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' appears in more than one module"
    assert _strings(client, pid) == []
    assert _modules(client, pid) == []


def test_excel_flat_updates_existing_row_in_place(client):
    project = make_project(client, "Excel Flat Update", layout="flat")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    imported = _upload_xlsx(client, pid, _xlsx({FLAT_SHEET: [("save", "Đã lưu")]}))
    assert imported.status_code == 200, imported.text
    rows = _strings(client, pid)
    assert len(rows) == 1
    assert rows[0]["source_text"] == "Đã lưu"
    assert rows[0]["module_id"] == auth["id"]


def test_excel_unassigned_sheet_names_existing_module(client):
    project = make_project(client, "Excel Unassigned")
    pid = project["id"]
    auth = client.post(f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": auth["id"]},
    )
    imported = _upload_xlsx(client, pid, _xlsx({UNASSIGNED_SHEET: [("save", "Khác")]}))
    assert imported.status_code == 409, imported.text
    assert imported.json()["detail"] == "String 'save' already exists in module 'auth'"
