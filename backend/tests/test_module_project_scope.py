"""XLOCALE-35: string module_id must belong to the same project."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Module, Project, StringEntry, TranslationStatus
from app.services.catalog import to_module_out
from tests.helpers import make_project

FOREIGN_SLUG = "secret-b"


def _projects_and_modules(client):
    project_a = make_project(client, "Project A")
    project_b = make_project(client, "Project B")
    module_a = client.post(
        f"/api/projects/{project_a['id']}/modules",
        json={"slug": "auth", "name": "Auth"},
    ).json()
    module_b = client.post(
        f"/api/projects/{project_b['id']}/modules",
        json={"slug": FOREIGN_SLUG, "name": "Secret"},
    ).json()
    return project_a, project_b, module_a, module_b


def _string_in(client, project_id, module_id, key="login"):
    created = client.post(
        f"/api/projects/{project_id}/strings",
        json={"key": key, "source_text": "Đăng nhập", "module_id": module_id},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["module_slug"] == "auth"
    assert FOREIGN_SLUG not in created.text
    return body


def test_create_rejects_foreign_and_unknown_module(client):
    project_a, _, module_a, module_b = _projects_and_modules(client)
    pid = project_a["id"]

    foreign = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "login", "source_text": "Đăng nhập", "module_id": module_b["id"]},
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "Unknown module"
    assert FOREIGN_SLUG not in foreign.text

    unknown = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "login", "source_text": "Đăng nhập", "module_id": str(uuid.uuid4())},
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["detail"] == "Unknown module"

    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 0
    assert all(item["module_slug"] != FOREIGN_SLUG for item in listed["items"])
    assert all(item["module_id"] != module_b["id"] for item in listed["items"])

    own = _string_in(client, pid, module_a["id"])
    assert own["module_id"] == module_a["id"]


def test_update_rejects_foreign_module_and_keeps_string_out(client):
    project_a, _, module_a, module_b = _projects_and_modules(client)
    pid = project_a["id"]
    created = _string_in(client, pid, module_a["id"])

    foreign = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"module_id": module_b["id"]},
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "Unknown module"
    assert FOREIGN_SLUG not in foreign.text

    unknown = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"module_id": str(uuid.uuid4())},
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["detail"] == "Unknown module"

    row = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert row["module_id"] == module_a["id"]
    assert row["module_slug"] == "auth"
    assert row["module_slug"] != FOREIGN_SLUG


def test_move_module_rejects_foreign_module_and_keeps_string_out(client):
    project_a, _, module_a, module_b = _projects_and_modules(client)
    pid = project_a["id"]
    created = _string_in(client, pid, module_a["id"])

    foreign = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [created["id"]],
            "payload": {"module_id": module_b["id"]},
        },
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "Unknown module"
    assert FOREIGN_SLUG not in foreign.text

    unknown = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [created["id"]],
            "payload": {"module_id": str(uuid.uuid4())},
        },
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["detail"] == "Unknown module"

    row = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert row["module_id"] == module_a["id"]
    assert row["module_slug"] == "auth"
    assert row["module_slug"] != FOREIGN_SLUG


def test_null_module_id_still_allowed_on_create_update_and_move(client):
    project_a, _, module_a, _ = _projects_and_modules(client)
    pid = project_a["id"]

    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "plain", "source_text": "Xin chào", "module_id": None},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["module_id"] is None
    assert body["module_slug"] is None

    assigned = _string_in(client, pid, module_a["id"], key="login")
    cleared = client.patch(
        f"/api/projects/{pid}/strings/{assigned['id']}",
        json={"module_id": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["module_id"] is None
    assert cleared.json()["module_slug"] is None

    again = _string_in(client, pid, module_a["id"], key="again")
    moved = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [again["id"]],
            "payload": {"module_id": None},
        },
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["affected"] == 1
    row = client.get(f"/api/projects/{pid}/strings/{again['id']}").json()
    assert row["module_id"] is None
    assert row["module_slug"] is None


def test_to_module_out_counts_only_strings_in_the_module_project():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        project_a = Project(
            name="A",
            slug="project-a",
            base_language="vi",
            target_languages=["en"],
        )
        project_b = Project(
            name="B",
            slug="project-b",
            base_language="vi",
            target_languages=["en"],
        )
        module_a = Module(project=project_a, slug="auth", name="Auth")
        db.add_all([project_a, project_b, module_a])
        db.flush()

        db.add_all(
            [
                StringEntry(
                    project_id=project_a.id,
                    module_id=module_a.id,
                    key="own",
                    source_text="Own",
                    status=TranslationStatus.draft,
                ),
                StringEntry(
                    project_id=project_b.id,
                    module_id=module_a.id,
                    key="leak",
                    source_text="Leak",
                    status=TranslationStatus.draft,
                ),
                StringEntry(
                    project_id=project_a.id,
                    module_id=module_a.id,
                    key="gone",
                    source_text="Gone",
                    status=TranslationStatus.draft,
                    deleted_at=datetime.now(UTC),
                ),
            ]
        )
        db.commit()
        db.refresh(module_a)

        out = to_module_out(db, module_a)
        assert out.string_count == 1
        assert out.slug == "auth"
