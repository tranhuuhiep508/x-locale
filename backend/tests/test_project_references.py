"""Public project slugs and legacy UUID references."""

from __future__ import annotations

import uuid

from app.database import get_db
from app.main import app
from app.models import Project


def _project(client, name: str, **extra) -> dict:
    response = client.post(
        "/api/projects",
        json={"name": name, "base_language": "vi", "target_languages": ["en"], **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_slug_and_uuid_reach_the_same_project_and_scoped_routes(client):
    project = _project(client, "Demo App")
    slug, project_id = project["slug"], project["id"]

    assert client.get(f"/api/projects/{slug}").json()["id"] == project_id
    assert client.get(f"/api/projects/{project_id}").json()["slug"] == slug

    module = client.post(
        f"/api/projects/{slug}/modules", json={"slug": "auth", "name": "Authentication"}
    )
    assert module.status_code == 201, module.text
    tag = client.post(f"/api/projects/{slug}/tags", json={"name": "important"})
    assert tag.status_code == 201, tag.text
    entry = client.post(
        f"/api/projects/{slug}/strings",
        json={"key": "login.title", "source_text": "Đăng nhập", "module_id": module.json()["id"]},
    )
    assert entry.status_code == 201, entry.text
    string_id = entry.json()["id"]
    assert client.get(f"/api/projects/{slug}/strings/{string_id}").status_code == 200
    assert client.get(f"/api/projects/{slug}/strings").json()["total"] == 1
    assert client.get(f"/api/projects/{slug}/modules").json()[0]["slug"] == "auth"
    assert client.get(f"/api/projects/{slug}/tags").json()[0]["name"] == "important"
    assert client.get(f"/api/projects/{slug}/activities").status_code == 200
    assert client.get(f"/api/projects/{slug}/sync-state").status_code == 200
    assert client.get(f"/api/projects/{slug}/export").status_code == 200

    updated = client.patch(f"/api/projects/{slug}", json={"name": "Demo Renamed"})
    assert updated.status_code == 200
    assert updated.json()["slug"] == slug
    assert client.patch(f"/api/projects/{slug}", json={"slug": "new-slug"}).status_code == 422
    assert client.get("/api/projects/missing-project").status_code == 404
    assert client.get("/api/projects/not-a-uuid/strings").status_code == 404


def test_api_key_is_bound_to_project_for_slug_and_uuid(client):
    first = _project(client, "First Project")
    second = _project(client, "Second Project")
    response = client.post(f"/api/projects/{first['slug']}/api-keys", json={"name": "CLI"})
    assert response.status_code == 201, response.text
    headers = {"X-API-Key": response.json()["key"]}
    assert client.get(f"/api/projects/{first['slug']}/strings", headers=headers).status_code == 200
    assert client.get(f"/api/projects/{first['id']}/strings", headers=headers).status_code == 200
    assert client.get(f"/api/projects/{second['slug']}/strings", headers=headers).status_code == 404


def test_uuid_shaped_slug_is_normalized_and_existing_ambiguity_is_rejected(client):
    first = _project(client, "First Project")
    second = _project(client, "Second Project", slug=str(uuid.uuid4()))
    assert second["slug"].startswith("p-")

    session_factory = app.dependency_overrides[get_db]
    session_iter = session_factory()
    db = next(session_iter)
    try:
        second_row = db.query(Project).filter(Project.id == uuid.UUID(second["id"])).one()
        second_row.slug = first["id"]
        db.commit()
    finally:
        session_iter.close()

    response = client.get(f"/api/projects/{first['id']}")
    assert response.status_code == 409
    assert response.json()["detail"] == "Ambiguous project reference"
