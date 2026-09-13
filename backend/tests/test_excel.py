"""Comprehensive unit and integration tests for app.excel."""

from __future__ import annotations

import io

from openpyxl import Workbook, load_workbook

from app.excel import (
    FLAT_SHEET,
    UNASSIGNED_SHEET,
    build_template_workbook,
    build_workbook,
)
from app.models import (
    Module,
    Project,
    ProjectLayout,
    StringEntry,
    Tag,
    Translation,
    TranslationStatus,
)


def _make_project(client, name="Excel Test Project", layout="flat", base="vi", targets=None):
    if targets is None:
        targets = ["en"]
    r = client.post(
        "/api/projects",
        json={
            "name": name,
            "layout": layout,
            "base_language": base,
            "target_languages": targets,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_build_workbook_flat_structure():
    project = Project(
        name="Flat App",
        slug="flat-app",
        base_language="vi",
        target_languages=["en", "ja"],
        layout=ProjectLayout.flat,
    )
    tag = Tag(name="v1")
    t_en = Translation(locale="en", value="Save")
    entry = StringEntry(
        key="btn.save",
        source_text="Lưu",
        description="Save button label",
        status=TranslationStatus.draft,
        tags=[tag],
        translations=[t_en],
    )

    wb_bytes = build_workbook(project, [entry], stage="draft")
    wb = load_workbook(io.BytesIO(wb_bytes))

    assert FLAT_SHEET in wb.sheetnames
    assert "_meta" in wb.sheetnames

    ws = wb[FLAT_SHEET]
    headers = [cell for cell in next(ws.iter_rows(values_only=True))]
    assert headers == ["key", "description", "tags", "vi", "en", "ja"]

    rows = list(ws.iter_rows(values_only=True))
    assert len(rows) == 2  # header + 1 row
    row = rows[1]
    assert row[0] == "btn.save"
    assert row[1] == "Save button label"
    assert row[2] == "v1"
    assert row[3] == "Lưu"
    assert row[4] == "Save"
    assert row[5] in ("", None)  # missing ja is empty


def test_build_workbook_modular_structure():
    project = Project(
        name="Modular App",
        slug="modular-app",
        base_language="vi",
        target_languages=["en"],
        layout=ProjectLayout.modular,
    )
    mod_auth = Module(slug="auth", name="Authentication")
    mod_home = Module(slug="home", name="Home Page")

    entry_auth = StringEntry(
        key="login",
        source_text="Đăng nhập",
        module=mod_auth,
        status=TranslationStatus.draft,
        translations=[],
    )
    entry_home = StringEntry(
        key="welcome",
        source_text="Chào mừng",
        module=mod_home,
        status=TranslationStatus.draft,
        translations=[],
    )
    entry_unassigned = StringEntry(
        key="common.ok",
        source_text="Đồng ý",
        module=None,
        status=TranslationStatus.draft,
        translations=[],
    )

    wb_bytes = build_workbook(project, [entry_auth, entry_home, entry_unassigned], stage="draft")
    wb = load_workbook(io.BytesIO(wb_bytes))

    assert "auth" in wb.sheetnames
    assert "home" in wb.sheetnames
    assert UNASSIGNED_SHEET in wb.sheetnames

    auth_rows = list(wb["auth"].iter_rows(values_only=True))
    assert auth_rows[1][0] == "login"

    home_rows = list(wb["home"].iter_rows(values_only=True))
    assert home_rows[1][0] == "welcome"

    unassigned_rows = list(wb[UNASSIGNED_SHEET].iter_rows(values_only=True))
    assert unassigned_rows[1][0] == "common.ok"


def test_build_workbook_public_stage_snapshot_isolation():
    project = Project(
        name="Public App",
        slug="public-app",
        base_language="vi",
        target_languages=["en"],
        layout=ProjectLayout.flat,
    )

    # 1. Draft string -> must be omitted
    draft_entry = StringEntry(
        key="draft_key",
        source_text="Bản nháp",
        status=TranslationStatus.draft,
        translations=[],
    )

    # 2. Public string with edits -> must use published snapshot
    t_live = Translation(
        locale="en",
        value="Working Copy Save",
        published_value="Published Save",
    )
    public_edited = StringEntry(
        key="save",
        source_text="Lưu (Working)",
        status=TranslationStatus.public,
        published_key="save",
        published_source_text="Lưu (Published)",
        translations=[t_live],
    )

    # 3. Pending delete string -> still public until published delete
    pending_delete = StringEntry(
        key="remove_me",
        source_text="Sắp xóa",
        status=TranslationStatus.public,
        published_key="remove_me",
        published_source_text="Vẫn còn trên prod",
        pending_delete=True,
        translations=[],
    )

    wb_bytes = build_workbook(project, [draft_entry, public_edited, pending_delete], stage="public")
    wb = load_workbook(io.BytesIO(wb_bytes))
    rows = list(wb[FLAT_SHEET].iter_rows(values_only=True))

    keys = [r[0] for r in rows[1:]]
    assert "draft_key" not in keys
    assert "save" in keys
    assert "remove_me" in keys

    save_row = next(r for r in rows[1:] if r[0] == "save")
    assert save_row[3] == "Lưu (Published)"  # vi base language
    assert save_row[4] == "Published Save"  # en translation


def test_build_template_workbook_flat_and_modular():
    flat_proj = Project(
        name="Flat Template",
        slug="flat-tpl",
        base_language="vi",
        target_languages=["en"],
        layout=ProjectLayout.flat,
    )
    flat_bytes = build_template_workbook(flat_proj)
    flat_wb = load_workbook(io.BytesIO(flat_bytes))
    assert FLAT_SHEET in flat_wb.sheetnames

    modular_proj = Project(
        name="Modular Template",
        slug="mod-tpl",
        base_language="vi",
        target_languages=["en"],
        layout=ProjectLayout.modular,
    )
    mod_bytes = build_template_workbook(modular_proj)
    mod_wb = load_workbook(io.BytesIO(mod_bytes))
    assert "auth" in mod_wb.sheetnames
    assert "common" in mod_wb.sheetnames
    assert UNASSIGNED_SHEET in mod_wb.sheetnames


def test_import_workbook_dry_run_via_api(client):
    project = _make_project(client, name="Import Dry Run App")
    pid = project["id"]

    wb = Workbook()
    ws = wb.active
    ws.title = FLAT_SHEET
    ws.append(["key", "description", "tags", "vi", "en"])
    ws.append(["new_key_1", "Test desc", "tag1", "Nguồn 1", "Source 1"])
    ws.append(["new_key_2", "", "", "Nguồn 2", "Source 2"])

    buf = io.BytesIO()
    wb.save(buf)
    content = buf.getvalue()

    # Dry-run = True
    r = client.post(
        f"/api/projects/{pid}/import?dry_run=true",
        files={"file": ("test.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["dry_run"] is True
    assert data["created"] == 0
    assert data["diff"]["create_count"] == 2

    # Ensure nothing was actually written to catalog
    catalog = client.get(f"/api/projects/{pid}/strings").json()
    assert catalog["total"] == 0

    # Now apply (dry_run = False)
    r_apply = client.post(
        f"/api/projects/{pid}/import?dry_run=false",
        files={"file": ("test.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r_apply.status_code == 200, r_apply.text
    catalog_applied = client.get(f"/api/projects/{pid}/strings").json()
    assert catalog_applied["total"] == 2
    keys = {s["key"] for s in catalog_applied["items"]}
    assert keys == {"new_key_1", "new_key_2"}


def test_import_workbook_mismatched_project_slug_rejected(client):
    project = _make_project(client, name="Real Project")
    pid = project["id"]

    wb = Workbook()
    ws = wb.active
    ws.title = FLAT_SHEET
    ws.append(["key", "vi", "en"])
    ws.append(["k1", "v1", "e1"])

    meta = wb.create_sheet("_meta")
    meta.append(["key", "value"])
    meta.append(["project_id", "00000000-0000-0000-0000-000000000000"])
    meta.append(["project_slug", "completely-different-project"])

    buf = io.BytesIO()
    wb.save(buf)

    r = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("mismatch.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 400
    assert "belongs to project" in r.text.lower()


def test_import_workbook_skips_sheet_without_key_column(client):
    project = _make_project(client, name="Skip Sheet App")
    pid = project["id"]

    wb = Workbook()
    # Sheet 1: Notes (no key column)
    ws_notes = wb.active
    ws_notes.title = "Notes"
    ws_notes.append(["Title", "Description", "Author"])
    ws_notes.append(["Read me", "Some translation notes", "John"])

    # Sheet 2: strings (has key column)
    ws_strings = wb.create_sheet(FLAT_SHEET)
    ws_strings.append(["key", "vi", "en"])
    ws_strings.append(["valid_key", "Giá trị", "Value"])

    buf = io.BytesIO()
    wb.save(buf)

    r = client.post(
        f"/api/projects/{pid}/import",
        files={"file": ("multi.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    catalog = client.get(f"/api/projects/{pid}/strings").json()
    assert catalog["total"] == 1
    assert catalog["items"][0]["key"] == "valid_key"


def test_build_workbook_sanitizes_formula_injection():
    project = Project(
        name="Security App",
        slug="security-app",
        base_language="vi",
        target_languages=["en"],
        layout=ProjectLayout.flat,
    )
    dangerous_entry = StringEntry(
        key="formula_key",
        source_text="=SUM(A1:A10)",
        description="+cmd|' /C calc'",
        status=TranslationStatus.draft,
        translations=[Translation(locale="en", value="@malicious_link")],
    )
    wb_bytes = build_workbook(project, [dangerous_entry], stage="draft")
    wb = load_workbook(io.BytesIO(wb_bytes))
    rows = list(wb[FLAT_SHEET].iter_rows(values_only=True))
    row = rows[1]
    assert row[1] == "'+cmd|' /C calc'"
    assert row[3] == "'=SUM(A1:A10)"
    assert row[4] == "'@malicious_link"

