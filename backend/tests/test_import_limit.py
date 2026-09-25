"""Uploads reject oversized files before parsing or writing."""

from __future__ import annotations

from tests.helpers import make_project


def test_import_accepts_exact_limit_and_rejects_one_byte_over(client, monkeypatch):
    from app.routers import sync

    project_id = make_project(client, "Import Limit")["id"]
    payload = b'{"hello":"Hello"}'
    monkeypatch.setattr(sync, "MAX_IMPORT_BYTES", len(payload))

    accepted = client.post(
        f"/api/projects/{project_id}/import",
        files={"file": ("en.json", payload, "application/json")},
        params={"locale": "en", "dry_run": "true"},
    )
    assert accepted.status_code == 200, accepted.text

    rejected = client.post(
        f"/api/projects/{project_id}/import",
        files={"file": ("en.json", payload + b" ", "application/json")},
        params={"locale": "en"},
    )
    assert rejected.status_code == 413, rejected.text
    assert client.get(f"/api/projects/{project_id}/strings").json()["total"] == 0
