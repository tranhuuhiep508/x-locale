"""Published snapshots must stay unique for the project's public export."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import select, text

from app.models import Activity, StringEntry, Translation
from app.services import strings as strings_service
from tests.helpers import json_upload, make_project, preview_publish


def _project(client, name, *, layout="flat", duplicates=False):
    project = make_project(client, name, layout=layout)
    root = f"/api/projects/{project['id']}"
    if duplicates:
        changed = client.patch(root, json={"allow_duplicate_keys": True})
        assert changed.status_code == 200, changed.text
        project = changed.json()
    return project, root


def _module(client, root, slug):
    created = client.post(f"{root}/modules", json={"slug": slug, "name": slug})
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _create(client, root, key, *, module_id=None, source="Lưu", status="draft"):
    body = {"key": key, "source_text": source, "status": status}
    if module_id is not None:
        body["module_id"] = module_id
    return client.post(f"{root}/strings", json=body)


def _publish(client, project_id, string_ids):
    preview = preview_publish(client, project_id, string_ids=string_ids)
    return client.post(
        f"/api/projects/{project_id}/strings/batch",
        json={
            "action": "publish",
            "string_ids": string_ids,
            "fingerprint": preview["fingerprint"],
        },
    )


def _export(client, root, *, stage="public", layout=None):
    params = {"stage": stage}
    if layout is not None:
        params["layout"] = layout
    return client.get(f"{root}/export", params=params)


def _save_count(body):
    if "modules" not in body:
        return int("save" in body.get("vi", {}))
    count = int("save" in body.get("unassigned", {}).get("vi", {}))
    return count + sum("save" in module.get("vi", {}) for module in body["modules"].values())


def _assert_conflict(response):
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "published_key_conflict"
    assert detail["key"] == "save"
    assert "public export" in detail["message"]


def _occupy_save(client, root, *, module_id=None):
    """Publish `save`, then rename the working key so the snapshot still holds it."""
    first = _create(client, root, "save", module_id=module_id, source="Lưu", status="public")
    assert first.status_code == 201, first.text
    renamed = client.patch(f"{root}/strings/{first.json()['id']}", json={"key": "save_new"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["published_key"] == "save"
    return first.json()


def test_reported_sequence_keeps_public_export(client):
    project, root = _project(client, "Reported collision")
    first = _occupy_save(client, root)
    before = _export(client, root)
    assert before.status_code == 200, before.text
    assert before.json()["vi"]["save"] == "Lưu"

    second = _create(client, root, "save", source="Khác")
    assert second.status_code == 201, second.text
    _assert_conflict(_publish(client, project["id"], [second.json()["id"]]))

    exported = _export(client, root)
    assert exported.status_code == 200, exported.text
    assert exported.json()["vi"] == {"save": "Lưu"}
    assert client.get(f"{root}/strings/{first['id']}").json()["published_key"] == "save"
    assert client.get(f"{root}/strings/{second.json()['id']}").json()["status"] == "draft"


def test_create_and_update_with_public_status_reject_collision(client):
    _, root = _project(client, "Direct public")
    _occupy_save(client, root)

    created = _create(client, root, "save", source="Khác", status="public")
    _assert_conflict(created)
    assert [row["key"] for row in client.get(f"{root}/strings").json()["items"]] == ["save_new"]

    other = _create(client, root, "other", source="Khác")
    assert other.status_code == 201, other.text
    updated = client.patch(
        f"{root}/strings/{other.json()['id']}",
        json={"key": "save", "status": "public"},
    )
    _assert_conflict(updated)
    row = client.get(f"{root}/strings/{other.json()['id']}").json()
    assert row["key"] == "other"
    assert row["status"] == "draft"
    assert _export(client, root).json()["vi"] == {"save": "Lưu"}


def _stored_rows(session_factory, project_id):
    """Committed strings, their translations, and activity (history and audit) rows."""
    pid = uuid.UUID(project_id)
    with session_factory() as db:
        strings = db.execute(
            select(StringEntry.__table__)
            .where(StringEntry.project_id == pid)
            .order_by(StringEntry.id)
        ).mappings()
        translations = db.execute(
            select(Translation.__table__)
            .join(StringEntry, Translation.string_id == StringEntry.id)
            .where(StringEntry.project_id == pid)
            .order_by(Translation.id)
        ).mappings()
        activities = db.execute(
            select(Activity.__table__)
            .where(Activity.project_id == pid)
            .order_by(Activity.created_at, Activity.id)
        ).mappings()
        return {
            "strings": [dict(row) for row in strings],
            "translations": [dict(row) for row in translations],
            "activities": [dict(row) for row in activities],
        }


def _held_publish_locks(session_factory, project_id) -> int:
    """Transaction advisory locks disappear when the import session closes."""
    with session_factory() as db:
        return int(
            db.scalar(
                text(
                    """
                    SELECT count(*) FROM pg_locks
                    WHERE locktype = 'advisory'
                      AND classid = CAST(:namespace AS oid)
                      AND objid = hashtext(:project_uuid)::oid
                    """
                ),
                {
                    "namespace": strings_service._PUBLISH_LOCK_NAMESPACE,
                    "project_uuid": project_id,
                },
            )
            or 0
        )


def test_public_import_rejects_collision_and_accepts_a_combined_rename(client, session_factory):
    project, root = _project(client, "Import public")
    _occupy_save(client, root)
    before = _stored_rows(session_factory, project["id"])
    assert before["strings"] and before["activities"]
    collided = json_upload({"save": "Khác"})
    dry_run = client.post(
        f"{root}/import",
        params={"status": "public", "dry_run": True},
        files=collided,
    )
    _assert_conflict(dry_run)
    assert _stored_rows(session_factory, project["id"]) == before
    assert _held_publish_locks(session_factory, project["id"]) == 0
    # A dry run that passes the publication check still must not persist.
    preview = client.post(
        f"{root}/import",
        params={"status": "public", "dry_run": True},
        files=json_upload({"save_new": "Lưu lại"}),
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["dry_run"] is True
    assert preview.json()["updated"] == 0
    assert _stored_rows(session_factory, project["id"]) == before
    assert _held_publish_locks(session_factory, project["id"]) == 0
    rejected = client.post(
        f"{root}/import",
        params={"status": "public"},
        files=collided,
    )
    _assert_conflict(rejected)
    assert _export(client, root).json()["vi"] == {"save": "Lưu"}
    assert _stored_rows(session_factory, project["id"]) == before
    assert _held_publish_locks(session_factory, project["id"]) == 0

    accepted = client.post(
        f"{root}/import",
        params={"status": "public"},
        files=json_upload({"save_new": "Lưu", "save": "Khác"}),
    )
    assert accepted.status_code == 200, accepted.text
    assert _export(client, root).json()["vi"] == {"save_new": "Lưu", "save": "Khác"}
    assert project["layout"] == "flat"


def test_pending_delete_holds_the_key_until_the_batch_removes_it(client):
    project, root = _project(client, "Pending published key")
    first = _occupy_save(client, root)
    assert client.delete(f"{root}/strings/{first['id']}").status_code == 204
    second = _create(client, root, "save", source="Khác")
    assert second.status_code == 201, second.text
    _assert_conflict(_publish(client, project["id"], [second.json()["id"]]))
    assert _export(client, root).json()["vi"]["save"] == "Lưu"

    accepted = _publish(client, project["id"], [first["id"], second.json()["id"]])
    assert accepted.status_code == 200, accepted.text
    exported = _export(client, root)
    assert exported.status_code == 200, exported.text
    assert exported.json()["vi"] == {"save": "Khác"}


def test_republished_rename_and_unpublish_free_the_key(client):
    project, root = _project(client, "Free published key")
    first = _occupy_save(client, root)
    second = _create(client, root, "save", source="Khác")
    assert second.status_code == 201, second.text
    renamed = _publish(client, project["id"], [first["id"], second.json()["id"]])
    assert renamed.status_code == 200, renamed.text
    assert _export(client, root).json()["vi"] == {"save_new": "Lưu", "save": "Khác"}

    project, root = _project(client, "Unpublish frees key")
    first = _occupy_save(client, root)
    unpublished = client.post(
        f"{root}/strings/batch",
        json={"action": "unpublish", "string_ids": [first["id"]]},
    )
    assert unpublished.status_code == 200, unpublished.text
    second = _create(client, root, "save", source="Khác", status="public")
    assert second.status_code == 201, second.text
    assert _export(client, root).json()["vi"] == {"save": "Khác"}


@pytest.mark.parametrize(
    ("layout", "duplicates", "modules", "rejected"),
    [
        ("modular", False, "none", True),
        ("modular", False, "same", True),
        ("modular", False, "different", False),
        ("modular", True, "same", True),
        ("modular", True, "different", False),
        ("flat", True, "different", True),
        ("flat", False, "none", True),
    ],
)
def test_publication_scope_follows_layout_and_duplicate_policy(
    client, layout, duplicates, modules, rejected
):
    project, root = _project(
        client, f"{layout}-{duplicates}-{modules}", layout=layout, duplicates=duplicates
    )
    if modules == "none":
        first_module = second_module = None
    elif modules == "same":
        first_module = second_module = _module(client, root, "auth")
    else:
        first_module = _module(client, root, "auth")
        second_module = _module(client, root, "home")

    _occupy_save(client, root, module_id=first_module)
    second = _create(client, root, "save", module_id=second_module, source="Khác")
    assert second.status_code == 201, second.text
    published = _publish(client, project["id"], [second.json()["id"]])
    exported = _export(client, root)
    assert exported.status_code == 200, exported.text
    if rejected:
        _assert_conflict(published)
        assert _save_count(exported.json()) == 1
    else:
        assert published.status_code == 200, published.text
        assert _save_count(exported.json()) == 2
        flat = _export(client, root, layout="flat")
        assert flat.status_code == 409, flat.text
        assert flat.json()["detail"]["code"] == "ambiguous_key"


def test_concurrent_publications_cannot_both_claim_one_public_key(client, monkeypatch):
    project, root = _project(client, "Concurrent publish", layout="flat", duplicates=True)
    auth = _module(client, root, "auth")
    home = _module(client, root, "home")
    left = _create(client, root, "save", module_id=auth, source="Auth").json()
    right = _create(client, root, "save", module_id=home, source="Home").json()
    barrier = Barrier(2)
    real = strings_service.guard_published_keys

    def enter_together(db, project, overlay=None):
        barrier.wait(5)
        return real(db, project, overlay)

    monkeypatch.setattr(strings_service, "guard_published_keys", enter_together)

    def publish(string_id):
        return _publish(client, project["id"], [string_id])

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [
            future.result(timeout=10)
            for future in (
                pool.submit(publish, left["id"]),
                pool.submit(publish, right["id"]),
            )
        ]

    assert sorted(result.status_code for result in results) == [200, 409]
    conflict = next(result for result in results if result.status_code == 409)
    assert conflict.json()["detail"]["code"] == "published_key_conflict"
    exported = _export(client, root)
    assert exported.status_code == 200, exported.text
    assert list(exported.json()["vi"]) == ["save"]
