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


def json_upload(payload: dict, name: str = "vi.json"):
    return {"file": (name, json.dumps(payload).encode(), "application/json")}


_make_project = make_project
_json_upload = json_upload

