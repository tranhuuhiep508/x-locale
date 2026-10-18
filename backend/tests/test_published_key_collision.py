"""Published snapshots must stay unique for the project's public export."""

from __future__ import annotations

import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Thread

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.models import Activity, Project, StringEntry, Translation
from app.schemas import BatchRequest, StringUpdate
from app.services import strings as strings_service
from app.services.sync import import_flat_strings
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
    real = strings_service.lock_publication

    def enter_together(db, project_id):
        # The guard locks again after the flush. Only the first call waits.
        if db.info.get("publish_lock_entered"):
            return real(db, project_id)
        db.info["publish_lock_entered"] = True
        barrier.wait(5)
        return real(db, project_id)

    monkeypatch.setattr(strings_service, "lock_publication", enter_together)

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


def _limit_lock_wait(db) -> None:
    db.execute(text("SET LOCAL lock_timeout = '3s'"))
    db.execute(text("SET LOCAL statement_timeout = '8s'"))


def _publication_waiter(session_factory, project_id) -> bool:
    params = {
        "namespace": strings_service._PUBLISH_LOCK_NAMESPACE,
        "project_uuid": project_id,
    }
    with session_factory() as db:
        return bool(
            db.scalar(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM pg_locks
                        WHERE locktype = 'advisory'
                          AND classid = CAST(:namespace AS oid)
                          AND objid = hashtext(:project_uuid)::oid
                          AND NOT granted
                    )
                    """
                ),
                params,
            )
        )


def _wait_until_publication_blocks(session_factory, project_id) -> None:
    """Poll the lock manager until the publisher is waiting. A fixed sleep can miss it."""
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if _publication_waiter(session_factory, project_id):
            return
        time.sleep(0.01)
    raise AssertionError("publisher never waited on the publication lock")


def _import_while_publish_blocks(session_factory, monkeypatch, project_id, publish) -> None:
    """Import holds the publication lock, publish blocks on it, then import updates the row."""
    import_holding = Event()
    release_import = Event()
    real_guard = strings_service.guard_published_keys

    def pause_after_import_lock(db, project, overlay=None):
        real_guard(db, project, overlay)
        if overlay is None:
            return None
        import_holding.set()
        if not release_import.wait(5):
            raise TimeoutError("import stayed paused after the publication lock")
        return None

    monkeypatch.setattr(strings_service, "guard_published_keys", pause_after_import_lock)
    errors: dict[str, BaseException] = {}

    def run_import() -> None:
        try:
            with session_factory() as db:
                _limit_lock_wait(db)
                project = db.get(Project, uuid.UUID(project_id))
                assert project is not None
                import_flat_strings(
                    db,
                    project,
                    {"save": "Imported"},
                    dry_run=False,
                    status=strings_service.TranslationStatus.public,
                )
                db.commit()
        except BaseException as exc:
            errors["import"] = exc

    def run_publish() -> None:
        try:
            with session_factory() as db:
                _limit_lock_wait(db)
                project = db.get(Project, uuid.UUID(project_id))
                assert project is not None
                publish(db, project)
        except BaseException as exc:
            errors["publish"] = exc

    importer = Thread(target=run_import, name="public-import")
    publisher = Thread(target=run_publish, name="public-publish")
    importer.start()
    try:
        assert import_holding.wait(5), "import did not acquire the publication lock"
        publisher.start()
        _wait_until_publication_blocks(session_factory, project_id)
        release_import.set()
        importer.join(15)
        publisher.join(15)
    finally:
        release_import.set()
        importer.join(15)
        publisher.join(15)
    assert not importer.is_alive()
    assert not publisher.is_alive()
    if errors:
        detail = "\n".join(
            f"{name}: {type(exc).__module__}.{type(exc).__name__}: {exc}"
            for name, exc in errors.items()
        )
        raise AssertionError(f"publication transactions did not both commit:\n{detail}")


@pytest.mark.parametrize("writer", ["update", "batch"])
def test_public_import_does_not_deadlock_with_a_publish(
    client, session_factory, monkeypatch, writer
):
    project, root = _project(client, f"Lock order {writer}")
    created = _create(client, root, "save", source="Lưu")
    assert created.status_code == 201, created.text
    string_id = uuid.UUID(created.json()["id"])

    def publish(db, project_row):
        if writer == "update":
            strings_service.update_string(
                db,
                project_row,
                string_id,
                StringUpdate(status=strings_service.TranslationStatus.public),
            )
            return
        entries = strings_service.load_string_entries(db, project_row.id, [string_id])
        fingerprint = strings_service.compute_publish_fingerprint(entries)
        try:
            strings_service.apply_batch(
                db,
                project_row,
                BatchRequest(action="publish", string_ids=[string_id], fingerprint=fingerprint),
            )
        except HTTPException as exc:
            # The import commits a new source while this publish waits on the lock.
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            if exc.status_code == 409 and detail.get("code") == "publish_fingerprint_mismatch":
                return
            raise

    _import_while_publish_blocks(session_factory, monkeypatch, project["id"], publish)


def _module_pair(client, root, modules):
    if modules in ("none", "unassigned"):
        return None, None
    if modules == "same":
        module_id = _module(client, root, "auth")
        return module_id, module_id
    return _module(client, root, "auth"), _module(client, root, "home")


def _publish_rename_and_unpublish(client, root, *, module_id):
    """Publish `save`, rename it without republishing, then unpublish.

    The rename leaves `published_key` as `save`, so a second `save` cannot be
    published yet. Unpublish is what frees that public key.
    """
    created = _create(client, root, "save", module_id=module_id, source="Lưu", status="public")
    assert created.status_code == 201, created.text
    string_id = created.json()["id"]
    renamed = client.patch(f"{root}/strings/{string_id}", json={"key": "save_new"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["published_key"] == "save"
    unpublished = client.post(
        f"{root}/strings/batch",
        json={"action": "unpublish", "string_ids": [string_id]},
    )
    assert unpublished.status_code == 200, unpublished.text
    history = client.get(f"{root}/strings/{string_id}/activities")
    assert history.status_code == 200, history.text
    activity = next(
        item for item in history.json()["items"] if item["event_type"] == "string.unpublished"
    )
    return string_id, unpublished.json()["batch_id"], activity["id"]


def _restore_published_snapshot(client, root, operation, batch_id, activity_id):
    if operation == "undo":
        return client.post(f"{root}/activities/batch/{batch_id}/revert")
    return client.post(f"{root}/activities/{activity_id}/revert")


@pytest.mark.parametrize("operation", ["undo", "revert"])
@pytest.mark.parametrize(
    ("layout", "modules", "collides"),
    [
        ("modular", "same", True),
        ("modular", "unassigned", True),
        ("modular", "different", False),
        ("flat", "none", True),
        ("flat", "different", True),
    ],
)
def test_undo_and_revert_published_snapshot_collisions(
    client, session_factory, operation, layout, modules, collides
):
    """Restoring a published snapshot must not make the public export ambiguous.

    Undo is the batch revert. Revert is the single activity. Both copy
    `published_key` back onto the string. Same published module (and the
    unassigned bucket) collide; two modules do not, on a modular project.
    A flat project collides across modules.
    """
    project, root = _project(client, f"{operation}-{layout}-{modules}", layout=layout)
    first_module, second_module = _module_pair(client, root, modules)
    string_id, batch_id, activity_id = _publish_rename_and_unpublish(
        client, root, module_id=first_module
    )
    replacement = _create(
        client, root, "save", module_id=second_module, source="Khác", status="public"
    )
    assert replacement.status_code == 201, replacement.text
    before_export = _export(client, root)
    assert before_export.status_code == 200, before_export.text
    assert _save_count(before_export.json()) == 1
    before_rows = _stored_rows(session_factory, project["id"])

    restored = _restore_published_snapshot(client, root, operation, batch_id, activity_id)
    exported = _export(client, root)
    if collides:
        assert restored.status_code == 409, (
            f"{operation} returned {restored.status_code}: {restored.text}; "
            f"public export then {exported.status_code}: {exported.text}"
        )
        _assert_conflict(restored)
        assert exported.status_code == 200, exported.text
        assert exported.json() == before_export.json()
        assert _stored_rows(session_factory, project["id"]) == before_rows
        live = client.get(f"{root}/strings/{string_id}").json()
        assert live["status"] == "draft"
        assert live["key"] == "save_new"
        assert live["published_key"] == "save"
        return

    assert restored.status_code == 200, restored.text
    assert exported.status_code == 200, exported.text
    assert _save_count(exported.json()) == 2
    live = client.get(f"{root}/strings/{string_id}").json()
    assert live["status"] == "public"
    assert live["published_key"] == "save"


def test_batch_publish_keeps_a_commit_that_lands_while_it_waits(client, session_factory):
    """A publish that commits while batch publish waits must not be overwritten."""
    project, root = _project(client, "Stale batch publish")
    created = _create(client, root, "save", source="Lưu")
    assert created.status_code == 201, created.text
    string_id = uuid.UUID(created.json()["id"])
    project_id = uuid.UUID(project["id"])
    with session_factory() as db:
        entries = strings_service.load_string_entries(db, project_id, [string_id])
        fingerprint = strings_service.compute_publish_fingerprint(entries)

    winner_holding = Event()
    release_winner = Event()
    errors: dict[str, BaseException] = {}

    def run_winner() -> None:
        try:
            with session_factory() as db:
                _limit_lock_wait(db)
                project_row = db.get(Project, project_id)
                assert project_row is not None
                strings_service.lock_publication(db, project_row.id)
                winner_holding.set()
                if not release_winner.wait(5):
                    raise TimeoutError("winner stayed paused on the publication lock")
                strings_service.update_string(
                    db,
                    project_row,
                    string_id,
                    StringUpdate(
                        source_text="Fresh",
                        status=strings_service.TranslationStatus.public,
                    ),
                )
        except BaseException as exc:
            errors["winner"] = exc

    def run_batch() -> None:
        try:
            with session_factory() as db:
                _limit_lock_wait(db)
                project_row = db.get(Project, project_id)
                assert project_row is not None
                strings_service.apply_batch(
                    db,
                    project_row,
                    BatchRequest(
                        action="publish",
                        string_ids=[string_id],
                        fingerprint=fingerprint,
                    ),
                )
        except BaseException as exc:
            errors["batch"] = exc

    winner = Thread(target=run_winner, name="fresh-publish")
    batch = Thread(target=run_batch, name="stale-batch")
    winner.start()
    try:
        assert winner_holding.wait(5), "winner did not acquire the publication lock"
        batch.start()
        _wait_until_publication_blocks(session_factory, project["id"])
        release_winner.set()
        winner.join(15)
        batch.join(15)
    finally:
        release_winner.set()
        winner.join(15)
        batch.join(15)
    assert not winner.is_alive()
    assert not batch.is_alive()
    if errors.get("winner"):
        exc = errors["winner"]
        raise AssertionError(
            f"winning publish failed: {type(exc).__module__}.{type(exc).__name__}: {exc}"
        )
    with session_factory() as db:
        row = db.get(StringEntry, string_id)
    assert row is not None
    assert row.source_text == "Fresh"
    assert row.published_source_text == "Fresh", (
        f"batch publish wrote the stale snapshot {row.published_source_text!r} "
        f"over the commit; source_text={row.source_text!r}; "
        f"batch_error={errors.get('batch')!r}"
    )
    assert row.status == strings_service.TranslationStatus.public
    mismatch = errors.get("batch")
    assert isinstance(mismatch, HTTPException)
    assert mismatch.status_code == 409
    assert mismatch.detail["code"] == "publish_fingerprint_mismatch"
