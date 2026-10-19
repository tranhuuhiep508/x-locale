"""Base-language edits must never relabel an existing catalog."""

import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import select, text

from app.auth import SESSION_COOKIE, create_session_token
from app.models import StringEntry, User
from app.routers import sync as sync_router
from app.services import strings
from tests.helpers import json_upload, make_project, publish_strings
from tests.test_import_concurrency import BUSY, pause_lock


def test_rejected_base_change_preserves_settings_working_copy_and_public_export(client):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    created = client.post(
        f"{root}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    )
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    publish_strings(client, project["id"], [sid])
    assert client.patch(
        f"{root}/strings/{sid}",
        json={"source_text": "Lưu ngay", "translations": {"en": "Save now"}},
    ).status_code == 200
    settings = client.get(root).json()
    working = client.get(f"{root}/strings/{sid}").json()
    exported = client.get(f"{root}/export", params={"stage": "public"}).json()
    assert exported == {"vi": {"save": "Lưu"}, "en": {"save": "Save"}}
    rejected = client.patch(root, json={
        "name": "Must not save", "base_language": "en", "target_languages": ["vi"],
        "allow_duplicate_keys": True, "translation_context": "Must not save",
    })
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["code"] == "base_language_has_strings"
    assert "Create a new project" in rejected.json()["detail"]["message"]
    assert client.get(root).json() == settings
    assert client.get(f"{root}/strings/{sid}").json() == working
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == exported


def test_empty_project_can_change_base_language(client):
    project = make_project(client)
    response = client.patch(f"/api/projects/{project['id']}", json={
        "base_language": "en", "target_languages": ["vi"],
    })
    assert response.status_code == 200, response.text
    assert response.json()["base_language"] == "en"
    assert response.json()["target_languages"] == ["vi"]


@pytest.mark.parametrize("base", [None, "vi", " vi "])
def test_populated_project_can_update_targets_and_other_settings(client, base):
    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    assert client.post(f"{root}/strings", json={"key": "save", "source_text": "Lưu"}).status_code == 201
    payload = {"name": "Renamed", "target_languages": ["en", "ja"]}
    if base is not None:
        payload["base_language"] = base
    response = client.patch(root, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["base_language"] == "vi"
    assert response.json()["target_languages"] == ["en", "ja"]
    assert response.json()["name"] == "Renamed"


def test_deleted_strings_still_block_base_change(client):
    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    created = client.post(f"{root}/strings", json={"key": "save", "source_text": "Lưu"})
    assert created.status_code == 201
    assert client.delete(f"{root}/strings/{created.json()['id']}").status_code == 204
    assert client.get(root).json()["string_count"] == 0
    assert client.patch(root, json={"base_language": "en"}).status_code == 409


def test_base_change_waits_for_uncommitted_string_then_rejects(client, session_factory):
    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    with session_factory() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        writer.add(StringEntry(project_id=uuid.UUID(project["id"]), key="save", source_text="Lưu"))
        writer.flush()
        blocker = writer.scalar(text("SELECT pg_backend_pid()"))
        changing = pool.submit(client.patch, root, json={"base_language": "en"})
        blocked = False
        try:
            deadline = time.monotonic() + 5
            with session_factory() as observer:
                while time.monotonic() < deadline:
                    blocked = observer.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                        "WHERE :blocker = ANY(pg_blocking_pids(pid)))"
                    ), {"blocker": blocker})
                    if blocked:
                        break
                    observer.rollback()
                    time.sleep(0.02)
        finally:
            writer.commit()
        assert changing.result(timeout=10).status_code == 409
        assert blocked, "settings must wait for the inserting transaction"
    assert client.get(root).json()["base_language"] == "vi"


def test_base_change_rejects_while_import_holds_lock(client, monkeypatch):
    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pause_lock(monkeypatch, sync_router) as (entered, release):
            importing = pool.submit(client.post, f"{root}/strings/import", json={"strings": {"save": "Lưu"}})
            try:
                assert entered.wait(5)
                rejected = client.patch(root, json={"base_language": "en"})
                assert rejected.status_code == 409 and rejected.json() == BUSY
                assert client.get(root).json()["base_language"] == "vi"
            finally:
                release.set()
            assert importing.result(timeout=10).status_code == 200


@pytest.mark.parametrize("kind", ["cli", "json"])
def test_import_refreshes_base_changed_after_authorization(client, monkeypatch, kind):
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    entered, release = Event(), Event()
    original = sync_router.acquire_import_lock

    def pause_before_lock(db, project_id):
        entered.set()
        assert release.wait(10)
        original(db, project_id)

    monkeypatch.setattr(sync_router, "acquire_import_lock", pause_before_lock)
    path, kwargs = (
        (f"{root}/strings/import", {"json": {"base_language": "vi", "strings": {"save": "Lưu"}}})
        if kind == "cli" else
        (f"{root}/import", {"files": json_upload({"vi": {"save": "Lưu"}, "en": {"save": "Save"}})})
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        importing = pool.submit(client.post, path, **kwargs)
        try:
            assert entered.wait(5)
            changed = client.patch(root, json={"base_language": "en", "target_languages": ["vi"]})
            assert changed.status_code == 200, changed.text
        finally:
            release.set()
        response = importing.result(timeout=10)
    if kind == "cli":
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "base_language_mismatch"
        assert client.get(root).json()["string_count"] == 0
    else:
        assert response.status_code == 200, response.text
        rows = client.get(f"{root}/strings").json()["items"]
        assert rows[0]["source_text"] == "Save"


@pytest.fixture()
def session_client(client, session_factory):
    # Avoid the dev bypass updating the same user row in overlapping requests.
    client.get("/api/auth/me")
    with session_factory() as db:
        user = db.scalar(select(User).where(User.oidc_issuer == "x-locale-dev"))
        client.cookies.set(SESSION_COOKIE, create_session_token(user))
    return client


@pytest.mark.parametrize("status", ["draft", "public"])
def test_base_change_waits_for_creation_before_first_insert(
    session_client, session_factory, monkeypatch, status
):
    client = session_client
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    entered, release = Event(), Event()
    original = strings.key_owner
    blocker = None

    def pause_before_insert(db, *args, **kwargs):
        nonlocal blocker
        result = original(db, *args, **kwargs)
        blocker = db.scalar(text("SELECT pg_backend_pid()"))
        entered.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(strings, "key_owner", pause_before_insert)
    with ThreadPoolExecutor(max_workers=2) as pool:
        creating = pool.submit(client.post, f"{root}/strings", json={
            "key": "save", "source_text": "Lưu", "translations": {"en": "Save"},
            "status": status,
        })
        try:
            assert entered.wait(5)
            changing = pool.submit(client.patch, root, json={
                "base_language": "en", "target_languages": ["vi"],
            })
            blocked = False
            deadline = time.monotonic() + 5
            with session_factory() as observer:
                while time.monotonic() < deadline:
                    blocked = observer.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                        "WHERE :blocker = ANY(pg_blocking_pids(pid)))"
                    ), {"blocker": blocker})
                    if blocked:
                        break
                    observer.rollback()
                    time.sleep(0.02)
            assert blocked, "settings must wait even before the creator inserts its first string"
        finally:
            release.set()
        created = creating.result(timeout=10)
        assert created.status_code == 201, created.text
        rejected = changing.result(timeout=10)
        assert rejected.status_code == 409, rejected.text
        assert rejected.json()["detail"]["code"] == "base_language_has_strings"
    assert client.get(root).json()["base_language"] == "vi"
    if status == "public":
        assert client.get(f"{root}/export", params={"stage": "public"}).json() == {
            "vi": {"save": "Lưu"}, "en": {"save": "Save"},
        }


def test_creation_rejects_base_changed_after_authorization(session_client, monkeypatch):
    client = session_client
    project = make_project(client, layout="flat")
    root = f"/api/projects/{project['id']}"
    entered, release = Event(), Event()
    original = strings.create_string

    def pause_before_lock(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return original(*args, **kwargs)

    monkeypatch.setattr(strings, "create_string", pause_before_lock)
    with ThreadPoolExecutor(max_workers=1) as pool:
        creating = pool.submit(client.post, f"{root}/strings", json={
            "key": "save", "source_text": "Lưu", "translations": {"en": "Save"},
            "status": "public",
        })
        try:
            assert entered.wait(5)
            changed = client.patch(root, json={"base_language": "en", "target_languages": ["vi"]})
            assert changed.status_code == 200, changed.text
        finally:
            release.set()
        rejected = creating.result(timeout=10)
        assert rejected.status_code == 409, rejected.text
        assert rejected.json()["detail"]["code"] == "base_language_changed"
    assert client.get(root).json()["string_count"] == 0
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == {"en": {}, "vi": {}}
