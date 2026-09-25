"""String module assignments must stay inside their project."""

from __future__ import annotations

import uuid

import pytest

from tests.helpers import make_project


@pytest.fixture()
def projects_with_foreign_module(client):
    first = make_project(client, "Module Scope First")
    second = make_project(client, "Module Scope Second")
    module = client.post(
        f"/api/projects/{second['id']}/modules",
        json={"slug": "foreign", "name": "Foreign"},
    )
    assert module.status_code == 201, module.text
    return first["id"], module.json()["id"]


@pytest.mark.parametrize("module_kind", ["foreign", "missing"])
def test_create_rejects_module_outside_project(client, projects_with_foreign_module, module_kind):
    project_id, foreign_id = projects_with_foreign_module
    module_id = foreign_id if module_kind == "foreign" else str(uuid.uuid4())

    response = client.post(
        f"/api/projects/{project_id}/strings",
        json={"key": "save", "source_text": "Lưu", "module_id": module_id},
    )

    assert response.status_code == 404, response.text
    assert client.get(f"/api/projects/{project_id}/strings").json()["total"] == 0


@pytest.mark.parametrize("module_kind", ["foreign", "missing"])
def test_update_rejects_module_outside_project(client, projects_with_foreign_module, module_kind):
    project_id, foreign_id = projects_with_foreign_module
    module_id = foreign_id if module_kind == "foreign" else str(uuid.uuid4())
    created = client.post(
        f"/api/projects/{project_id}/strings",
        json={"key": "save", "source_text": "Lưu"},
    )
    string_id = created.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}/strings/{string_id}",
        json={"source_text": "Changed", "module_id": module_id},
    )

    assert response.status_code == 404, response.text
    current = client.get(f"/api/projects/{project_id}/strings/{string_id}").json()
    assert current["source_text"] == "Lưu"
    assert current["module_id"] is None


@pytest.mark.parametrize("module_kind,expected_status", [("foreign", 404), ("missing", 404), ("malformed", 400)])
def test_batch_move_rejects_invalid_module_without_writes(
    client, projects_with_foreign_module, module_kind, expected_status
):
    project_id, foreign_id = projects_with_foreign_module
    module_id = {
        "foreign": foreign_id,
        "missing": str(uuid.uuid4()),
        "malformed": "not-a-uuid",
    }[module_kind]
    created = client.post(
        f"/api/projects/{project_id}/strings",
        json={"key": "save", "source_text": "Lưu"},
    )
    string_id = created.json()["id"]

    response = client.post(
        f"/api/projects/{project_id}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [string_id],
            "payload": {"module_id": module_id},
        },
    )

    assert response.status_code == expected_status, response.text
    assert client.get(f"/api/projects/{project_id}/strings/{string_id}").json()["module_id"] is None
