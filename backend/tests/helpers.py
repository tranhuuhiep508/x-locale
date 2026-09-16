"""Shared test helpers for backend API integration tests."""

from __future__ import annotations

import json


def make_project(client, name="Test Project", targets=None, layout="modular"):
    r = client.post(
        "/api/projects",
        json={
            "name": name,
            "base_language": "vi",
            "target_languages": targets or ["en"],
            "layout": layout,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def preview_publish(client, project_id, string_ids=None, filt=None):
    body: dict = {}
    if string_ids is not None:
        body["string_ids"] = string_ids
    if filt is not None:
        body["filter"] = filt
    r = client.post(f"/api/projects/{project_id}/strings/publish-preview", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def publish_strings(client, project_id, string_ids):
    preview = preview_publish(client, project_id, string_ids=string_ids)
    r = client.post(
        f"/api/projects/{project_id}/strings/batch",
        json={
            "action": "publish",
            "string_ids": string_ids,
            "fingerprint": preview["fingerprint"],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def json_upload(payload: dict, name: str = "vi.json"):
    return {"file": (name, json.dumps(payload).encode(), "application/json")}


_make_project = make_project
_json_upload = json_upload
_publish_strings = publish_strings

