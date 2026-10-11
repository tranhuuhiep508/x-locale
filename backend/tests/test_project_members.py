"""Project membership roles, delete confirmation, and migration backfill."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, create_session_token
from app.main import app as fastapi_app
from app.models import (
    Activity,
    ApiKey,
    Job,
    JobStatus,
    MemberRole,
    Module,
    Project,
    ProjectMember,
    StringEntry,
    Tag,
    User,
)
from app.services.members import LAST_ADMIN
from app.services.projects import OWN_KEY_ONLY
from tests.helpers import make_project

CONFIRM = "confirm_slug must exactly match the project slug"


def _project_route_cases() -> list[tuple[str, str]]:
    """Every method on every route whose path contains ``{project_id}``.

    FastAPI keeps included routers unflattened, so walk those routers and
    prefix each path with the include prefix (``/api``).
    """
    cases: list[tuple[str, str]] = []
    for route in fastapi_app.routes:
        if type(route).__name__ != "_IncludedRouter":
            path = getattr(route, "path", "")
            methods = getattr(route, "methods", None)
            if path and "{project_id}" in path and methods:
                cases.extend((method, path) for method in sorted(methods))
            continue
        prefix = route.include_context.prefix.rstrip("/")
        for child in route.original_router.routes:
            path = getattr(child, "path", "")
            methods = getattr(child, "methods", None)
            if not path or "{project_id}" not in path or not methods:
                continue
            full = f"{prefix}{path}"
            cases.extend((method, full) for method in sorted(methods))
    if not cases:
        raise RuntimeError("expected project routes on the app")
    return cases


def _cross_project_member_cases() -> list[tuple[str, str]]:
    """Member PATCH/DELETE routes, taken from the same ``{project_id}`` walk."""
    cases = [
        (method, path)
        for method, path in _project_route_cases()
        if method in {"PATCH", "DELETE"} and "/members" in path
    ]
    if not cases:
        raise RuntimeError("expected member PATCH/DELETE routes")
    return cases


def _fill_project_path(path: str, project_id: str) -> str:
    def replace(match: re.Match[str]) -> str:
        if match.group(1) == "project_id":
            return project_id
        return str(uuid.uuid4())

    return re.sub(r"\{([^{}]+)\}", replace, path)


def _session():
    from app.database import get_db
    from app.main import app

    generator = app.dependency_overrides[get_db]()
    return generator, next(generator)


def _add_user(email: str, name: str = "Member") -> dict[str, str]:
    generator, db = _session()
    try:
        user = User(email=email, name=name, oidc_issuer="test", oidc_sub=email)
        db.add(user)
        db.commit()
        db.refresh(user)
        return {
            "id": str(user.id),
            "email": user.email,
            "token": create_session_token(user),
        }
    finally:
        generator.close()


def _as(user: dict[str, str]) -> dict[str, str]:
    return {SESSION_COOKIE: user["token"]}


def _delete(client, path: str, body: dict | None = None, **kwargs):
    if body is not None:
        kwargs["json"] = body
    return client.request("DELETE", path, **kwargs)


def _members(client, project_id: str, cookies: dict | None = None) -> list[dict]:
    response = client.get(f"/api/projects/{project_id}/members", cookies=cookies)
    assert response.status_code == 200, response.text
    return response.json()


def test_creator_becomes_admin_and_created_by_is_audit_only(client):
    me = client.get("/api/auth/me").json()
    project = make_project(client, "Owned")
    members = _members(client, project["id"])
    assert members == [
        {
            "user_id": me["id"],
            "email": me["email"],
            "name": me["name"],
            "role": "admin",
            "created_at": members[0]["created_at"],
        }
    ]
    assert project["role"] == "admin"

    renamed = client.patch(f"/api/projects/{project['id']}", json={"name": "Renamed"}).json()
    assert renamed["name"] == "Renamed"
    assert renamed["role"] == "admin"

    generator, db = _session()
    try:
        stored = db.get(Project, uuid.UUID(project["id"]))
        assert stored is not None
        assert str(stored.created_by) == me["id"]
        assert stored.name == "Renamed"
    finally:
        generator.close()


def test_non_member_is_hidden_with_404(client):
    project = make_project(client, "Secret")
    outsider = _add_user("outsider@example.com", "Outsider")
    cookies = _as(outsider)
    pid = project["id"]
    slug = project["slug"]

    listed = client.get("/api/projects", cookies=cookies)
    assert listed.status_code == 200
    assert listed.json() == []
    assert any(row["id"] == pid for row in client.get("/api/projects").json())

    denied = client.patch(f"/api/projects/{pid}", json={"name": "Hijack"}, cookies=cookies)
    assert denied.status_code == 404
    deleted = _delete(
        client,
        f"/api/projects/{slug}",
        {"confirm_slug": slug},
        cookies=cookies,
    )
    assert deleted.status_code == 404
    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "dev@localhost", "role": "admin"},
        cookies=cookies,
    )
    assert added.status_code == 404


@pytest.mark.parametrize(
    ("method", "route_path"),
    _project_route_cases(),
    ids=[f"{method} {path}" for method, path in _project_route_cases()],
)
def test_non_member_every_project_route_is_404(client, method, route_path):
    """Reads and writes. A body is sent for every method that accepts one."""
    project = make_project(client, "Hidden routes")
    outsider = _add_user("route-outsider@example.com")
    path = _fill_project_path(route_path, project["id"])
    kwargs: dict = {"cookies": _as(outsider)}
    if method not in {"GET", "HEAD"}:
        kwargs["json"] = {}
    response = client.request(method, path, **kwargs)
    assert response.status_code == 404, f"{method} {path} -> {response.status_code} {response.text}"
    if method != "HEAD":
        assert response.json()["detail"] == "Project not found"


def test_route_walk_includes_catalog_writes():
    cases = set(_project_route_cases())
    required = [
        ("GET", "/api/projects/{project_id}/strings"),
        ("POST", "/api/projects/{project_id}/strings"),
        ("POST", "/api/projects/{project_id}/import"),
        ("POST", "/api/projects/{project_id}/strings/import"),
        ("POST", "/api/projects/{project_id}/translate"),
        ("GET", "/api/projects/{project_id}/export"),
        ("PATCH", "/api/projects/{project_id}/members/{user_id}"),
        ("DELETE", "/api/projects/{project_id}/members/{user_id}"),
    ]
    missing = [item for item in required if item not in cases]
    assert missing == []
    assert {"GET", "POST", "PATCH", "DELETE"} <= {method for method, _ in cases}


@pytest.mark.parametrize(
    ("method", "route_path"),
    _cross_project_member_cases(),
    ids=[f"{method} {path}" for method, path in _cross_project_member_cases()],
)
def test_cross_project_member_write_is_404(client, method, route_path):
    """A member of project A gets 404 on project B's member PATCH and DELETE."""
    foreign = make_project(client, "Project B")
    member = _add_user("member-of-a@example.com", "Member A")
    own = client.post(
        "/api/projects",
        json={
            "name": "Project A",
            "base_language": "vi",
            "target_languages": ["en"],
            "layout": "modular",
        },
        cookies=_as(member),
    )
    assert own.status_code == 201, own.text
    path = _fill_project_path(route_path, foreign["id"])
    response = client.request(method, path, json={}, cookies=_as(member))
    assert response.status_code == 404, f"{method} {path} -> {response.status_code} {response.text}"
    assert response.json()["detail"] == "Project not found"


def test_editor_can_edit_catalog_but_not_settings_delete_or_members(client):
    project = make_project(client, "Catalog")
    pid = project["id"]
    editor = _add_user("editor@example.com", "Editor")
    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "editor@example.com", "role": "editor"},
    )
    assert added.status_code == 201, added.text
    cookies = _as(editor)

    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu"},
        cookies=cookies,
    )
    assert created.status_code == 201, created.text
    assert client.get(f"/api/projects/{pid}/strings", cookies=cookies).status_code == 200
    module = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
        cookies=cookies,
    )
    assert module.status_code == 201, module.text
    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "ui"},
        cookies=cookies,
    )
    assert tag.status_code == 201, tag.text
    assert client.get(f"/api/projects/{pid}/activities", cookies=cookies).status_code == 200
    key = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "editor-key"},
        cookies=cookies,
    )
    assert key.status_code == 201, key.text
    detail = client.get(f"/api/projects/{pid}", cookies=cookies)
    assert detail.status_code == 200
    assert detail.json()["role"] == "editor"
    assert _members(client, pid, cookies)[0]["role"] == "admin"

    settings = client.patch(f"/api/projects/{pid}", json={"name": "Nope"}, cookies=cookies)
    assert settings.status_code == 403
    assert settings.json()["detail"] == "Admin role required"
    delete = _delete(
        client,
        f"/api/projects/{project['slug']}",
        {"confirm_slug": project["slug"]},
        cookies=cookies,
    )
    assert delete.status_code == 403
    for method, path, body in (
        ("post", f"/api/projects/{pid}/members", {"email": "editor@example.com", "role": "admin"}),
        ("patch", f"/api/projects/{pid}/members/{editor['id']}", {"role": "admin"}),
        ("delete", f"/api/projects/{pid}/members/{editor['id']}", None),
    ):
        response = client.request(method, path, json=body, cookies=cookies)
        assert response.status_code == 403, method


def _editor_with_keys(client, slug: str):
    project = make_project(client, slug)
    pid = project["id"]
    editor = _add_user(f"{slug}@example.com", "Editor")
    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": editor["email"], "role": "editor"},
    )
    assert added.status_code == 201, added.text
    cookies = _as(editor)
    own = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "editor-key"},
        cookies=cookies,
    )
    assert own.status_code == 201, own.text
    admin_key = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "admin-key"},
    )
    assert admin_key.status_code == 201, admin_key.text
    return pid, cookies, own.json(), admin_key.json()


def test_editor_revokes_own_api_key(client):
    pid, cookies, own, _admin_key = _editor_with_keys(client, "own-key")
    assert own["created_by"]
    revoked = _delete(client, f"/api/projects/{pid}/api-keys/{own['id']}", cookies=cookies)
    assert revoked.status_code == 204, revoked.text
    listed = client.get(f"/api/projects/{pid}/api-keys", cookies=cookies).json()
    assert own["id"] not in {row["id"] for row in listed}
    stale = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": own["key"]},
    )
    assert stale.status_code == 401


def test_editor_cannot_revoke_another_users_api_key(client):
    pid, cookies, _own, admin_key = _editor_with_keys(client, "other-key")
    denied = _delete(client, f"/api/projects/{pid}/api-keys/{admin_key['id']}", cookies=cookies)
    assert denied.status_code == 403
    assert denied.json()["detail"] == OWN_KEY_ONLY
    still = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": admin_key["key"]},
    )
    assert still.status_code == 200
    outsider = _add_user("key-outsider@example.com")
    hidden = _delete(
        client,
        f"/api/projects/{pid}/api-keys/{admin_key['id']}",
        cookies=_as(outsider),
    )
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == "Project not found"


def test_admin_revokes_another_users_api_key(client):
    pid, _cookies, own, _admin_key = _editor_with_keys(client, "admin-revoke")
    revoked = _delete(client, f"/api/projects/{pid}/api-keys/{own['id']}")
    assert revoked.status_code == 204, revoked.text
    listed = client.get(f"/api/projects/{pid}/api-keys").json()
    assert own["id"] not in {row["id"] for row in listed}
    stale = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": own["key"]},
    )
    assert stale.status_code == 401


def test_membership_lock_compiles_to_for_no_key_update(client):
    from sqlalchemy.dialects import postgresql

    from app.services.members import _project_lock_query

    generator, db = _session()
    try:
        sql = str(
            _project_lock_query(db, uuid.uuid4()).statement.compile(
                dialect=postgresql.dialect()
            )
        )
    finally:
        generator.close()
    assert "FOR NO KEY UPDATE" in sql


def test_api_key_cannot_list_create_or_revoke(client):
    project = make_project(client, "Key only")
    other = make_project(client, "Key other")
    pid = project["id"]
    created = client.post(f"/api/projects/{pid}/api-keys", json={"name": "cli"}).json()
    client.cookies.clear()
    headers = {"X-API-Key": created["key"]}
    paths = {
        "get": f"/api/projects/{pid}/api-keys",
        "post": f"/api/projects/{pid}/api-keys",
        "delete": f"/api/projects/{pid}/api-keys/{created['id']}",
    }
    for method, path in paths.items():
        response = client.request(
            method,
            path,
            headers=headers,
            json={"name": "from-key"} if method == "post" else None,
        )
        assert response.status_code == 403, f"{method} {response.status_code} {response.text}"
        assert response.json()["detail"] == "API keys cannot perform this action"

    bogus = {"X-API-Key": "not-a-real-key"}
    for method, path in paths.items():
        response = client.request(method, path, headers=bogus, json={"name": "x"})
        assert response.status_code == 401, f"{method} {response.status_code} {response.text}"
        assert response.json()["detail"] == "Invalid API key"

    foreign = {
        "get": f"/api/projects/{other['id']}/api-keys",
        "post": f"/api/projects/{other['id']}/api-keys",
        "delete": f"/api/projects/{other['id']}/api-keys/{created['id']}",
    }
    for method, path in foreign.items():
        response = client.request(method, path, headers=headers, json={"name": "x"})
        assert response.status_code == 404, f"{method} {response.status_code} {response.text}"
        assert response.json()["detail"] == "Project not found"

    catalog = client.get(f"/api/projects/{pid}/strings", headers=headers)
    assert catalog.status_code == 200, catalog.text


def test_remove_member_keeps_keys_on_other_projects(client):
    project_a = make_project(client, "Project A")
    project_b = make_project(client, "Project B")
    editor = _add_user("cross-key@example.com", "Cross")
    for project in (project_a, project_b):
        added = client.post(
            f"/api/projects/{project['id']}/members",
            json={"email": editor["email"], "role": "editor"},
        )
        assert added.status_code == 201, added.text
    cookies = _as(editor)
    key_a = client.post(
        f"/api/projects/{project_a['id']}/api-keys",
        json={"name": "key-a"},
        cookies=cookies,
    ).json()
    key_b = client.post(
        f"/api/projects/{project_b['id']}/api-keys",
        json={"name": "key-b"},
        cookies=cookies,
    ).json()
    removed = client.delete(f"/api/projects/{project_a['id']}/members/{editor['id']}")
    assert removed.status_code == 204, removed.text
    stale = client.get(
        f"/api/projects/{project_a['id']}/strings",
        headers={"X-API-Key": key_a["key"]},
    )
    assert stale.status_code == 401
    fresh = client.get(
        f"/api/projects/{project_b['id']}/strings",
        headers={"X-API-Key": key_b["key"]},
    )
    assert fresh.status_code == 200, fresh.text


def test_admin_manages_members_by_email(client):
    project = make_project(client, "Team")
    pid = project["id"]
    editor = _add_user("Editor.Person@example.com", "Editor Person")
    unknown = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "missing@example.com", "role": "editor"},
    )
    assert unknown.status_code == 400
    assert unknown.json()["detail"] == "No user with this email has signed in"

    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": " editor.person@example.com ", "role": "editor"},
    )
    assert added.status_code == 201, added.text
    assert added.json()["email"] == "Editor.Person@example.com"
    assert added.json()["role"] == "editor"

    duplicate = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "editor.person@example.com", "role": "admin"},
    )
    assert duplicate.status_code == 409

    promoted = client.patch(
        f"/api/projects/{pid}/members/{editor['id']}",
        json={"role": "admin"},
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"
    demoted = client.patch(
        f"/api/projects/{pid}/members/{editor['id']}",
        json={"role": "editor"},
    )
    assert demoted.status_code == 200
    assert demoted.json()["role"] == "editor"

    other = _add_user("second@example.com")
    ambiguous_email = other["email"]
    generator, db = _session()
    try:
        db.add(
            User(
                email=ambiguous_email.upper(),
                name="Twin",
                oidc_issuer="other",
                oidc_sub="twin",
            )
        )
        db.commit()
    finally:
        generator.close()
    ambiguous = client.post(
        f"/api/projects/{pid}/members",
        json={"email": ambiguous_email, "role": "editor"},
    )
    assert ambiguous.status_code == 409
    assert ambiguous.json()["detail"] == "More than one account uses this email"


def test_last_admin_cannot_be_removed_demoted_or_leave(client):
    project = make_project(client, "Last Admin")
    pid = project["id"]
    me = client.get("/api/auth/me").json()
    editor = _add_user("helper@example.com", "Helper")
    assert (
        client.post(
            f"/api/projects/{pid}/members",
            json={"email": editor["email"], "role": "editor"},
        ).status_code
        == 201
    )

    demote = client.patch(f"/api/projects/{pid}/members/{me['id']}", json={"role": "editor"})
    assert demote.status_code == 400
    assert demote.json()["detail"] == LAST_ADMIN
    sole_key = client.post(f"/api/projects/{pid}/api-keys", json={"name": "sole"}).json()
    leave = client.delete(f"/api/projects/{pid}/members/{me['id']}")
    assert leave.status_code == 400
    assert leave.json()["detail"] == LAST_ADMIN
    still_active = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": sole_key["key"]},
    )
    assert still_active.status_code == 200, still_active.text

    assert (
        client.patch(f"/api/projects/{pid}/members/{editor['id']}", json={"role": "admin"}).status_code
        == 200
    )
    assert client.delete(f"/api/projects/{pid}/members/{me['id']}").status_code == 204
    remaining = _members(client, pid, _as(editor))
    assert [row["role"] for row in remaining] == ["admin"]
    still_last = client.delete(
        f"/api/projects/{pid}/members/{editor['id']}",
        cookies=_as(editor),
    )
    assert still_last.status_code == 400


def test_confirm_slug_and_cascading_delete(client):
    project = make_project(client, "Doomed")
    pid = project["id"]
    slug = project["slug"]
    assert client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
    ).status_code == 201
    assert client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "ui"},
    ).status_code == 201
    assert client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu"},
    ).status_code == 201
    assert client.post(f"/api/projects/{pid}/api-keys", json={"name": "gone"}).status_code == 201

    missing = _delete(client, f"/api/projects/{slug}")
    assert missing.status_code == 400
    assert missing.json()["detail"] == CONFIRM
    empty = _delete(client, f"/api/projects/{slug}", {})
    assert empty.status_code == 400
    mismatch = _delete(client, f"/api/projects/{slug}", {"confirm_slug": project["name"]})
    assert mismatch.status_code == 400
    assert client.get(f"/api/projects/{slug}").status_code == 200

    deleted = _delete(client, f"/api/projects/{slug}", {"confirm_slug": slug})
    assert deleted.status_code == 204, deleted.text
    assert client.get(f"/api/projects/{slug}").status_code == 404

    generator, db = _session()
    try:
        project_id = uuid.UUID(pid)
        assert db.get(Project, project_id) is None
        assert db.query(ProjectMember).filter(ProjectMember.project_id == project_id).count() == 0
        assert db.query(StringEntry).filter(StringEntry.project_id == project_id).count() == 0
        assert db.query(Module).filter(Module.project_id == project_id).count() == 0
        assert db.query(Tag).filter(Tag.project_id == project_id).count() == 0
        assert db.query(ApiKey).filter(ApiKey.project_id == project_id).count() == 0
        assert db.query(Activity).filter(Activity.project_id == project_id).count() == 0
    finally:
        generator.close()


def test_api_key_cannot_delete_or_manage_members_but_catalog_still_works(client):
    project = make_project(client, "Keyed")
    other = make_project(client, "Other Keyed")
    pid = project["id"]
    key = client.post(f"/api/projects/{pid}/api-keys", json={"name": "cli"}).json()["key"]
    headers = {"X-API-Key": key}

    catalog = client.get(f"/api/projects/{pid}/strings", headers=headers)
    assert catalog.status_code == 200, catalog.text
    bootstrap = client.get("/api/bootstrap", headers=headers)
    assert bootstrap.status_code == 200
    assert bootstrap.json()["slug"] == project["slug"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
        headers=headers,
    )
    assert created.status_code == 201, created.text

    deleted = _delete(
        client,
        f"/api/projects/{project['slug']}",
        {"confirm_slug": project["slug"]},
        headers=headers,
    )
    assert deleted.status_code == 403
    assert deleted.json()["detail"] == "API keys cannot perform this action"
    members = client.get(f"/api/projects/{pid}/members", headers=headers)
    assert members.status_code == 403
    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "dev@localhost", "role": "editor"},
        headers=headers,
    )
    assert added.status_code == 403
    settings = client.patch(
        f"/api/projects/{pid}",
        json={"name": "From key"},
        headers=headers,
    )
    assert settings.status_code == 403
    detail = client.get(f"/api/projects/{pid}", headers=headers)
    assert detail.status_code == 403
    assert detail.json()["detail"] == "API keys cannot perform this action"

    mismatch = _delete(
        client,
        f"/api/projects/{other['slug']}",
        {"confirm_slug": other["slug"]},
        headers=headers,
    )
    assert mismatch.status_code == 404
    assert client.get(f"/api/projects/{other['slug']}/strings", headers=headers).status_code == 404
    assert client.get(f"/api/projects/{project['slug']}").json()["name"] == "Keyed"


def test_multiple_admins_are_allowed(client):
    project = make_project(client, "Shared")
    second = _add_user("coadmin@example.com", "Co Admin")
    added = client.post(
        f"/api/projects/{project['id']}/members",
        json={"email": second["email"], "role": "admin"},
    )
    assert added.status_code == 201
    renamed = client.patch(
        f"/api/projects/{project['id']}",
        json={"name": "Shared by two"},
        cookies=_as(second),
    )
    assert renamed.status_code == 200
    assert renamed.json()["role"] == "admin"


def test_job_lookup_requires_project_membership(client):
    project = make_project(client, "Job scope")
    outsider = _add_user("outsider-jobs@example.com")
    generator, db = _session()
    try:
        job = Job(
            project_id=uuid.UUID(project["id"]),
            kind="translate",
            status=JobStatus.pending,
            payload={"progress": {"phase": "queued", "chunks_done": 0, "chunks_total": 2}},
        )
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        generator.close()

    visible = client.get(f"/api/jobs/{job_id}")
    assert visible.status_code == 200, visible.text
    body = visible.json()
    assert body["id"] == job_id
    assert body["kind"] == "translate"
    assert body["status"] == "pending"

    hidden = client.get(f"/api/jobs/{job_id}", cookies=_as(outsider))
    missing = client.get(f"/api/jobs/{uuid.uuid4()}")
    assert hidden.status_code == 404
    assert missing.status_code == 404
    assert hidden.json()["detail"] == "Job not found"
    assert missing.json()["detail"] == hidden.json()["detail"]


def test_editor_can_poll_a_project_job(client):
    project = make_project(client, "Editor job")
    editor = _add_user("job-editor@example.com", "Job Editor")
    added = client.post(
        f"/api/projects/{project['id']}/members",
        json={"email": "job-editor@example.com", "role": "editor"},
    )
    assert added.status_code == 201, added.text
    generator, db = _session()
    try:
        job = Job(project_id=uuid.UUID(project["id"]), kind="translate", status=JobStatus.pending)
        db.add(job)
        db.commit()
        job_id = str(job.id)
    finally:
        generator.close()

    visible = client.get(f"/api/jobs/{job_id}", cookies=_as(editor))
    assert visible.status_code == 200, visible.text
    assert visible.json()["kind"] == "translate"


def test_removed_member_gets_404_and_old_key_gets_401(client):
    project = make_project(client, "Revoked")
    pid = project["id"]
    editor = _add_user("removed-editor@example.com", "Removed")
    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "removed-editor@example.com", "role": "editor"},
    )
    assert added.status_code == 201, added.text
    created = client.post(
        f"/api/projects/{pid}/api-keys",
        json={"name": "editor-key"},
        cookies=_as(editor),
    )
    assert created.status_code == 201, created.text
    removed = client.delete(f"/api/projects/{pid}/members/{editor['id']}")
    assert removed.status_code == 204, removed.text

    hidden = client.get(f"/api/projects/{pid}/strings", cookies=_as(editor))
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == "Project not found"
    stale = client.get(
        f"/api/projects/{pid}/strings",
        headers={"X-API-Key": created.json()["key"]},
    )
    assert stale.status_code == 401
    assert stale.json()["detail"] == "Invalid API key"


def test_editor_can_translate_publish_and_import(client, monkeypatch):
    project = make_project(client, "Editor catalog")
    pid = project["id"]
    editor = _add_user("catalog-editor@example.com", "Catalog Editor")
    added = client.post(
        f"/api/projects/{pid}/members",
        json={"email": "catalog-editor@example.com", "role": "editor"},
    )
    assert added.status_code == 201, added.text
    cookies = _as(editor)
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu"},
        cookies=cookies,
    )
    assert created.status_code == 201, created.text
    string_id = created.json()["id"]

    def fake_batch(source_locale, items, on_progress=None):
        del source_locale, on_progress
        return {item.id: {locale: f"{locale}-text" for locale in item.locales} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    translated = client.post(
        f"/api/projects/{pid}/translate",
        json={"scope": "strings", "string_ids": [string_id], "locales": ["en"]},
        cookies=cookies,
    )
    assert translated.status_code == 200, translated.text
    assert translated.json()["translated_count"] == 1

    preview = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"string_ids": [string_id]},
        cookies=cookies,
    )
    assert preview.status_code == 200, preview.text
    published = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "publish",
            "string_ids": [string_id],
            "fingerprint": preview.json()["fingerprint"],
        },
        cookies=cookies,
    )
    assert published.status_code == 200, published.text

    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"hello": "Xin chào"}},
        cookies=cookies,
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] >= 1


def test_member_migration_backfill_is_idempotent(throwaway_database, monkeypatch):
    import importlib.util

    from alembic.config import Config

    from alembic import command
    from app.config import settings

    url = throwaway_database
    monkeypatch.setattr(settings, "database_url", url)
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    command.upgrade(config, "n3e50b1c2345")

    owner_id = uuid.uuid4()
    owned_id = uuid.uuid4()
    orphan_id = uuid.uuid4()
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, name, oidc_issuer, oidc_sub, token_version) "
                "VALUES (:id, 'owner@example.com', 'Owner', 'test', 'owner', 0)"
            ),
            {"id": owner_id.hex},
        )
        connection.execute(
            text(
                "INSERT INTO projects "
                "(id, name, slug, base_language, target_languages, layout, created_by) "
                "VALUES (:id, 'Owned', 'owned', 'vi', '[\"en\"]', 'flat', :owner)"
            ),
            {"id": owned_id.hex, "owner": owner_id.hex},
        )
        connection.execute(
            text(
                "INSERT INTO projects "
                "(id, name, slug, base_language, target_languages, layout, created_by) "
                "VALUES (:id, 'Orphan', 'orphan', 'vi', '[\"en\"]', 'flat', NULL)"
            ),
            {"id": orphan_id.hex},
        )

    command.upgrade(config, "head")

    def member_rows() -> list[tuple]:
        with engine.connect() as connection:
            return connection.execute(
                text("SELECT project_id, user_id, role FROM project_members ORDER BY role")
            ).fetchall()

    rows = member_rows()
    assert len(rows) == 1
    assert rows[0][2] == "admin"
    assert str(rows[0][0]).replace("-", "").lower() == owned_id.hex
    assert str(rows[0][1]).replace("-", "").lower() == owner_id.hex
    import sqlalchemy as sa

    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        index_names = {index["name"] for index in inspector.get_indexes("project_members")}
        check_names = {item["name"] for item in inspector.get_check_constraints("project_members")}
    assert "ix_project_members_project_id" not in index_names
    assert "ix_project_members_user_id" in index_names
    assert "ck_project_members_role" in check_names

    with engine.begin() as connection:
        connection.execute(text("UPDATE project_members SET role = 'editor'"))
    spec = importlib.util.spec_from_file_location(
        "project_members_migration",
        backend / "alembic" / "versions" / "o4f61c2d3456_project_members.py",
    )
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        inserted = migration.backfill_project_admins(connection)
    assert inserted == 0
    assert member_rows()[0][2] == "editor"

    with Session(engine) as db:
        assert db.query(ProjectMember).count() == 1
        stored = db.query(ProjectMember).one()
        assert stored.role == MemberRole.editor

    command.downgrade(config, "n3e50b1c2345")
    with engine.connect() as connection:
        assert "project_members" not in sa.inspect(connection).get_table_names()
    command.upgrade(config, "head")
    restored = member_rows()
    assert len(restored) == 1
    assert restored[0][2] == "admin"
    assert str(restored[0][0]).replace("-", "").lower() == owned_id.hex
