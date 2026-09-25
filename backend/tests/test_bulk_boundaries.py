"""Integration checks for the bulk API paths used by the scale benchmark."""

from __future__ import annotations

import io
import json

from openpyxl import Workbook

from tests.helpers import make_project


def test_json_bulk_import_export_catalog_and_activity_feed(client):
    project_id = make_project(client, "Bulk JSON", layout="flat")["id"]
    rows = {f"bulk.{number:04d}": f"Source {number}" for number in range(650)}
    imported = client.post(
        f"/api/projects/{project_id}/import",
        files={"file": ("vi.json", json.dumps(rows).encode(), "application/json")},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == len(rows)
    assert imported.json()["diff"]["create_count"] == len(rows)
    assert len(imported.json()["diff"]["create"]) == 100

    exported = client.get(f"/api/projects/{project_id}/export", params={"stage": "draft", "locale": "vi"})
    assert exported.status_code == 200, exported.text
    assert exported.json()["vi"] == rows

    page = client.get(f"/api/projects/{project_id}/strings", params={"q": "bulk.01", "status": "draft", "page_size": 25})
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 100
    assert len(page.json()["items"]) == 25
    feed = client.get(f"/api/projects/{project_id}/activities/feed", params={"page_size": 20})
    assert feed.status_code == 200, feed.text
    assert feed.json()["total"] >= 1


def test_excel_bulk_import_and_single_locale_export(client):
    project_id = make_project(client, "Bulk Excel", layout="flat")["id"]
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("strings")
    sheet.append(["key", "description", "tags", "vi", "en"])
    for number in range(650):
        sheet.append([f"excel.{number:04d}", "", "", f"Source {number}", f"English {number}"])
    data = io.BytesIO()
    workbook.save(data)
    imported = client.post(
        f"/api/projects/{project_id}/import",
        files={"file": ("bulk.xlsx", data.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == 650
    exported = client.get(f"/api/projects/{project_id}/export", params={"stage": "draft", "locale": "en", "format": "xlsx"})
    assert exported.status_code == 200, exported.text
    assert len(exported.content) > 1000
