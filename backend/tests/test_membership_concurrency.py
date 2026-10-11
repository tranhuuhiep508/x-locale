"""Membership invariants with overlapping requests and separate DB connections."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier, Event, Lock

import pytest

from app import auth
from app.auth import SESSION_COOKIE, create_session_token
from app.models import MemberRole, Project, ProjectMember, User
from app.services import members as members_service
from app.services import projects as projects_service
from tests.helpers import make_project
from tests.test_project_members import _add_user, _as, _session


@pytest.fixture()
def concurrent_client(client):
    """Same client. The session engine opens a connection per request."""
    return client


def _editor(client):
    project = make_project(client, "Concurrent keys")
    editor = _add_user("concurrent-editor@example.com")
    response = client.post(
        f"/api/projects/{project['id']}/members",
        json={"email": editor["email"], "role": "editor"},
    )
    assert response.status_code == 201, response.text
    # Use an actual session: bypass updates last_login_at before authorization,
    # which would obscure the lock contention this test is meant to exercise.
    generator, db = _session()
    try:
        admin = db.query(User).filter_by(oidc_issuer="x-locale-dev").one()
        client.cookies.set(SESSION_COOKIE, create_session_token(admin))
    finally:
        generator.close()
    return project, editor


def test_removal_before_key_insert_rechecks_membership(concurrent_client, monkeypatch):
    client = concurrent_client
    project, editor = _editor(client)
    pid = project["id"]
    old_key = client.post(
        f"/api/projects/{pid}/api-keys", json={"name": "old"}, cookies=_as(editor)
    ).json()["key"]
    authorized, resume = Event(), Event()
    original = projects_service.create_api_key

    def paused_create(db, project_id, payload, user):
        authorized.set()
        assert resume.wait(5)
        return original(db, project_id, payload, user)

    monkeypatch.setattr(projects_service, "create_api_key", paused_create)
    with ThreadPoolExecutor(max_workers=1) as pool:
        creating = pool.submit(
            client.post,
            f"/api/projects/{pid}/api-keys",
            json={"name": "racing"},
            cookies=_as(editor),
        )
        try:
            assert authorized.wait(5)
            removed = client.delete(f"/api/projects/{pid}/members/{editor['id']}")
            assert removed.status_code == 204, removed.text
        finally:
            resume.set()
        issued = creating.result(timeout=5)
    assert issued.status_code == 404, issued.text
    assert issued.json()["detail"] == "Project not found"
    assert client.get(f"/api/projects/{pid}", cookies=_as(editor)).status_code == 404
    assert (
        client.get(f"/api/projects/{pid}/strings", headers={"X-API-Key": old_key}).status_code
        == 401
    )
    assert client.get(f"/api/projects/{pid}/api-keys").json() == []


def test_key_insert_before_removal_is_revoked(concurrent_client, monkeypatch):
    client = concurrent_client
    project, editor = _editor(client)
    pid = project["id"]
    creating, resume, removing, removed = Event(), Event(), Event(), Event()
    original_generate = projects_service.generate_api_key
    original_lock = auth.lock_project

    def paused_generate():
        creating.set()
        assert resume.wait(5)
        return original_generate()

    def removal_lock(db, project_id):
        removing.set()
        return original_lock(db, project_id)

    def remove():
        response = client.delete(f"/api/projects/{pid}/members/{editor['id']}")
        removed.set()
        return response

    monkeypatch.setattr(projects_service, "generate_api_key", paused_generate)
    monkeypatch.setattr(auth, "lock_project", removal_lock)
    with ThreadPoolExecutor(max_workers=2) as pool:
        issuing = pool.submit(
            client.post,
            f"/api/projects/{pid}/api-keys",
            json={"name": "racing"},
            cookies=_as(editor),
        )
        try:
            assert creating.wait(5)
            deleting = pool.submit(remove)
            assert removing.wait(5)
            assert not removed.wait(0.2)
        finally:
            resume.set()
        key = issuing.result(timeout=5)
        deletion = deleting.result(timeout=5)
    assert key.status_code == 201, key.text
    assert deletion.status_code == 204, deletion.text
    assert (
        client.get(
            f"/api/projects/{pid}/strings", headers={"X-API-Key": key.json()["key"]}
        ).status_code
        == 401
    )


def test_concurrent_self_demotions_preserve_last_admin(concurrent_client, monkeypatch):
    client = concurrent_client
    project = make_project(client, "Concurrent demotions")
    pid = project["id"]
    creator = client.get("/api/auth/me").json()
    admins = [_add_user(f"concurrent-admin-{i}@example.com") for i in range(2)]
    for admin in admins:
        assert (
            client.post(
                f"/api/projects/{pid}/members",
                json={"email": admin["email"], "role": "admin"},
            ).status_code
            == 201
        )
    assert client.delete(f"/api/projects/{pid}/members/{creator['id']}").status_code == 204
    starting, second_counted, count_lock = Barrier(2), Event(), Lock()
    counts = []
    original_lock = auth.lock_project
    original_count = members_service._admin_count

    def simultaneous_lock(db, project_id):
        starting.wait(timeout=5)
        return original_lock(db, project_id)

    def overlapping_count(db, project_id):
        count = original_count(db, project_id)
        with count_lock:
            counts.append(count)
            first = len(counts) == 1
        if first:
            # Without serialization, both requests read two before either saves.
            second_counted.wait(0.2)
        else:
            second_counted.set()
        return count

    monkeypatch.setattr(auth, "lock_project", simultaneous_lock)
    monkeypatch.setattr(members_service, "_admin_count", overlapping_count)

    def demote(admin):
        return client.patch(
            f"/api/projects/{pid}/members/{admin['id']}",
            json={"role": "editor"},
            cookies=_as(admin),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(demote, admins))
    assert sorted(response.status_code for response in results) == [200, 400]
    assert counts == [2, 1]
    refused = next(response for response in results if response.status_code == 400)
    assert refused.json()["detail"] == members_service.LAST_ADMIN
    members = client.get(f"/api/projects/{pid}/members", cookies=_as(admins[0])).json()
    assert sum(member["role"] == "admin" for member in members) == 1


def test_lock_preserves_timestamp_and_refreshes_cached_role(concurrent_client):
    project = make_project(concurrent_client, "Cached role")
    generator, db = _session()
    try:
        stored = db.query(Project).filter_by(slug=project["slug"]).one()
        stored.updated_at = datetime(2000, 1, 1, tzinfo=UTC)
        db.commit()
        db.refresh(stored)
        member = db.query(ProjectMember).filter_by(project_id=stored.id).one()
        timestamp = stored.updated_at
        other_generator, other = _session()
        try:
            other.query(ProjectMember).filter_by(id=member.id).update({"role": MemberRole.editor})
            other.commit()
        finally:
            other_generator.close()
        assert member.role == MemberRole.admin
        members_service.lock_project(db, stored.id)
        assert members_service._get_member(db, stored.id, member.user_id).role == MemberRole.editor
        db.commit()
        db.refresh(stored)
        assert stored.updated_at == timestamp
    finally:
        generator.close()


def _coadmin(client):
    project, admin = _editor(client)
    assert (
        client.patch(
            f"/api/projects/{project['id']}/members/{admin['id']}", json={"role": "admin"}
        ).status_code
        == 200
    )
    return project, admin


def _revoke_admin(client, project, admin, revocation):
    path = f"/api/projects/{project['id']}/members/{admin['id']}"
    if revocation == "remove":
        response = client.delete(path)
        assert response.status_code == 204, response.text
    else:
        response = client.patch(path, json={"role": "editor"})
        assert response.status_code == 200, response.text
    return response


@pytest.mark.parametrize("revocation", ["remove", "demote"])
def test_admin_write_before_revocation_cannot_restore_access(
    concurrent_client, monkeypatch, revocation
):
    client = concurrent_client
    project, admin = _coadmin(client)
    pid = project["id"]
    authorized, resume, revoking, revoked = Event(), Event(), Event(), Event()

    if revocation == "remove":
        original = members_service.add_member

        def paused_add(*args, **kwargs):
            authorized.set()
            assert resume.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(members_service, "add_member", paused_add)

        def restore():
            return client.post(
                f"/api/projects/{pid}/members",
                json={"email": admin["email"], "role": "admin"},
                cookies=_as(admin),
            )
    else:
        original = members_service.set_member_role

        def paused_promote(db, project_id, user_id, role):
            if role == MemberRole.admin:
                authorized.set()
                assert resume.wait(5)
            return original(db, project_id, user_id, role)

        monkeypatch.setattr(members_service, "set_member_role", paused_promote)

        def restore():
            return client.patch(
                f"/api/projects/{pid}/members/{admin['id']}",
                json={"role": "admin"},
                cookies=_as(admin),
            )

    def revoke():
        revoking.set()
        response = _revoke_admin(client, project, admin, revocation)
        revoked.set()
        return response

    with ThreadPoolExecutor(max_workers=2) as pool:
        restoring = pool.submit(restore)
        try:
            assert authorized.wait(5)
            revocation_request = pool.submit(revoke)
            assert revoking.wait(5)
            # An unprotected write lets revocation finish here, then resurrects
            # Admin access when resumed. A protected one holds revocation back.
            assert not revoked.wait(0.2)
        finally:
            resume.set()
        response = restoring.result(timeout=5)
        revocation_request.result(timeout=5)
    assert response.status_code == (409 if revocation == "remove" else 200), response.text
    after = client.get(f"/api/projects/{pid}", cookies=_as(admin))
    if revocation == "remove":
        assert after.status_code == 404
    else:
        assert after.status_code == 200
        assert after.json()["role"] == "editor"


@pytest.mark.parametrize("revocation", ["remove", "demote"])
@pytest.mark.parametrize("action", ["add_member", "promote", "settings", "delete"])
def test_revocation_before_admin_lock_denies_every_admin_write(
    concurrent_client, monkeypatch, revocation, action
):
    client = concurrent_client
    project, admin = _coadmin(client)
    pid = project["id"]
    waiting, resume = Event(), Event()
    original_lock = auth.lock_project

    def paused_lock(db, project_id):
        if (db.info.get("activity") or {}).get("actor_id") == admin["id"]:
            waiting.set()
            assert resume.wait(5)
        return original_lock(db, project_id)

    monkeypatch.setattr(auth, "lock_project", paused_lock)

    def write():
        cookies = _as(admin)
        if action == "add_member":
            return client.post(
                f"/api/projects/{pid}/members",
                json={"email": admin["email"], "role": "admin"},
                cookies=cookies,
            )
        if action == "promote":
            return client.patch(
                f"/api/projects/{pid}/members/{admin['id']}",
                json={"role": "admin"},
                cookies=cookies,
            )
        if action == "settings":
            return client.patch(
                f"/api/projects/{pid}",
                json={"name": "Unauthorized rename"},
                cookies=cookies,
            )
        return client.request(
            "DELETE",
            f"/api/projects/{pid}",
            json={"confirm_slug": project["slug"]},
            cookies=cookies,
        )

    with ThreadPoolExecutor(max_workers=1) as pool:
        writing = pool.submit(write)
        try:
            assert waiting.wait(5)
            _revoke_admin(client, project, admin, revocation)
        finally:
            resume.set()
        response = writing.result(timeout=5)
    assert response.status_code == (404 if revocation == "remove" else 403), response.text
    stored = client.get(f"/api/projects/{pid}")
    assert stored.status_code == 200
    assert stored.json()["name"] == project["name"]
    after = client.get(f"/api/projects/{pid}", cookies=_as(admin))
    if revocation == "remove":
        assert after.status_code == 404
    else:
        assert after.json()["role"] == "editor"


@pytest.mark.parametrize("revocation", ["remove", "demote"])
def test_api_key_revoke_rechecks_current_membership_and_role(
    concurrent_client, monkeypatch, revocation
):
    client = concurrent_client
    project, admin = _coadmin(client)
    pid = project["id"]
    key = client.post(f"/api/projects/{pid}/api-keys", json={"name": "Other admin's key"}).json()
    authorized, resume = Event(), Event()
    original = projects_service.revoke_api_key

    def paused_revoke(*args, **kwargs):
        authorized.set()
        assert resume.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(projects_service, "revoke_api_key", paused_revoke)
    with ThreadPoolExecutor(max_workers=1) as pool:
        revoking = pool.submit(
            client.delete,
            f"/api/projects/{pid}/api-keys/{key['id']}",
            cookies=_as(admin),
        )
        try:
            assert authorized.wait(5)
            _revoke_admin(client, project, admin, revocation)
        finally:
            resume.set()
        response = revoking.result(timeout=5)
    assert response.status_code == (404 if revocation == "remove" else 403), response.text
    assert (
        client.get(f"/api/projects/{pid}/strings", headers={"X-API-Key": key["key"]}).status_code
        == 200
    )
