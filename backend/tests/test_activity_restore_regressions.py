"""Actual-state previews, undo auditing, and atomic restore validation."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import Base, get_db
from app.main import app
from app.models import Activity
from app.services.activity_state import (
    is_key_integrity_error,
    project_snapshot,
    restore_transaction,
    snapshots_match,
)
from tests.helpers import make_project, publish_strings
from tests.pg import open_engine


def setup_string(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    created = client.post(
        f"{root}/strings",
        json={"key": "a", "source_text": "A1", "translations": {"en": "Hello"}},
    )
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    original = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"]
    return pid, sid, root, original


def values(client, root, sid):
    return {
        t["locale"]: t["value"] for t in client.get(f"{root}/strings/{sid}").json()["translations"]
    }


def add_french(client, root, sid, value="Bonjour"):
    assert client.patch(root, json={"target_languages": ["en", "fr"]}).status_code == 200
    assert (
        client.put(f"{root}/strings/{sid}/translations/fr", json={"value": value}).status_code
        == 200
    )


def edit_batch(client, root):
    response = client.post(f"{root}/strings/import", json={"strings": {"a": "A2"}})
    assert response.status_code == 200, response.text
    return response.json()["batch_id"]


def test_history_preview_preserves_public_and_pending_delete(client):
    pid, sid, root, original = setup_string(client)
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A2"})
    publish_strings(client, pid, [sid])
    client.delete(f"{root}/strings/{sid}")
    public_before = client.get(f"{root}/export", params={"stage": "public"}).json()
    preview = client.get(f"{root}/strings/{sid}/activities/{original}/restore/preview").json()
    assert preview["can_restore"] and preview["pending_delete"]
    assert [row["field"] for row in preview["changes"]] == ["source_text"]
    assert preview["changes"][0]["before"] == "A2"
    assert preview["changes"][0]["after"] == "A1"
    restored = client.post(f"{root}/strings/{sid}/activities/{original}/restore")
    assert restored.status_code == 200, restored.text
    live = client.get(f"{root}/strings/{sid}").json()
    assert live["source_text"] == "A1" and live["status"] == "public" and live["pending_delete"]
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == public_before


def test_history_clears_added_locale_even_when_it_is_the_only_difference(client):
    pid, sid, root, _ = setup_string(client)
    publish_strings(client, pid, [sid])
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A2"})
    version = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"]
    add_french(client, root, sid)
    publish_strings(client, pid, [sid])
    preview = client.get(f"{root}/strings/{sid}/activities/{version}/restore/preview").json()
    assert preview["can_restore"] and not preview["already_matches"]
    assert len(preview["changes"]) == 1
    assert preview["changes"][0]["locale"] == "fr"
    assert preview["changes"][0]["before"] == "Bonjour" and preview["changes"][0]["after"] is None
    before = client.get(f"{root}/export", params={"stage": "public"}).json()
    restored = client.post(f"{root}/strings/{sid}/activities/{version}/restore")
    assert restored.status_code == 200, restored.text
    live = client.get(f"{root}/strings/{sid}").json()
    fr = next(t for t in live["translations"] if t["locale"] == "fr")
    assert fr["value"] == "" and fr["published_value"] == "Bonjour"
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == before
    assert client.get(f"{root}/strings/{sid}/activities/{version}/restore/preview").json()[
        "already_matches"
    ]


@pytest.mark.parametrize("value,conflicts", [("Bonjour", 1), ("", 0)])
def test_added_locale_conflict_in_ui_batch_undo(client, value, conflicts):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    batch = client.post(f"{root}/strings/import", json={"strings": {"a": "A1"}}).json()["batch_id"]
    sid = client.get(f"{root}/strings").json()["items"][0]["id"]
    add_french(client, root, sid, value)
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert preview["can_revert"] and preview["conflict_count"] == conflicts
    assert preview["requires_force"] == bool(conflicts)
    response = client.post(f"{root}/activities/batch/{batch}/revert")
    assert response.status_code == (409 if conflicts else 200), response.text
    if conflicts:
        assert client.get(f"{root}/strings/{sid}").json()["deleted_at"] is None


def test_forced_undo_records_live_values_and_restore_last_edit_recovers_them(client):
    _, sid, root, _ = setup_string(client)
    batch = edit_batch(client, root)
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A3"})
    response = client.post(f"{root}/activities/batch/{batch}/revert", params={"force": True})
    assert response.status_code == 200, response.text
    history = client.get(f"{root}/strings/{sid}/activities").json()["items"]
    assert len(history) == 4  # create, import, edit, exactly one undo marker
    change = next(c for c in history[0]["changed"] if c["field"] == "source_text")
    assert change["before"] == "A3" and change["after"] == "A1"
    assert history[0]["revert_of_id"]
    restored = client.post(
        f"{root}/strings/batch", json={"action": "restore_last_history", "string_ids": [sid]}
    )
    assert restored.status_code == 200, restored.text
    assert client.get(f"{root}/strings/{sid}").json()["source_text"] == "A3"


@pytest.mark.parametrize("published", [False, True])
def test_create_undo_marker_contains_real_tombstone_or_pending_delete(client, published):
    pid, sid, root, original = setup_string(client)
    if published:
        publish_strings(client, pid, [sid])
    response = client.post(f"{root}/activities/{original}/revert", params={"force": published})
    assert response.status_code == 200, response.text
    marker_id = response.json()["reverted_by_id"]
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        marker = db.get(Activity, uuid.UUID(marker_id))
        assert marker.after["id"] == sid and marker.after["project_id"] == pid
        assert marker.before["source_text"] == marker.after["source_text"] == "A1"
        assert bool(marker.after["pending_delete"]) == published
        assert bool(marker.after["deleted_at"]) != published
    finally:
        generator.close()


def test_force_undo_warns_about_later_publication_and_resets_snapshot(client):
    pid, sid, root, _ = setup_string(client)
    batch = edit_batch(client, root)
    add_french(client, root, sid)
    publish_strings(client, pid, [sid])
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert preview["affects_published"] and preview["requires_force"] and preview["can_revert"]
    undone = client.post(f"{root}/activities/batch/{batch}/revert", params={"force": True})
    assert undone.status_code == 200, undone.text
    live = client.get(f"{root}/strings/{sid}").json()
    assert live["status"] == "draft"
    assert all(t["published_value"] is None for t in live["translations"])
    assert values(client, root, sid)["fr"] == ""


def reused_key(client):
    pid, sid, root, original = setup_string(client)
    client.patch(f"{root}/strings/{sid}", json={"key": "b"})
    rename = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"]
    client.post(f"{root}/strings", json={"key": "a", "source_text": "Other"})
    return pid, sid, root, original, rename


def test_history_collision_preview_and_execution_are_handled(client):
    _, sid, root, original, _ = reused_key(client)
    preview = client.get(f"{root}/strings/{sid}/activities/{original}/restore/preview").json()
    assert not preview["can_restore"] and "already used" in preview["blocked_reason"]
    result = client.post(f"{root}/strings/{sid}/activities/{original}/restore")
    assert result.status_code == 409 and result.json()["detail"]["code"] == "key_conflict"
    assert result.json()["detail"]["key"] == "a"
    assert client.get(f"{root}/strings/{sid}").json()["key"] == "b"
    assert len(client.get(f"{root}/strings/{sid}/activities").json()["items"]) == 2


def test_rename_undo_collision_cannot_be_forced(client):
    _, sid, root, _, rename = reused_key(client)
    preview = client.get(f"{root}/activities/{rename}/revert/preview").json()
    assert not preview["can_revert"] and "already used" in preview["items"][0]["blocked_reason"]
    for force in [False, True]:
        result = client.post(f"{root}/activities/{rename}/revert", params={"force": force})
        assert result.status_code == 409 and result.json()["detail"]["code"] == "key_conflict"
    assert client.get(f"{root}/strings/{sid}").json()["key"] == "b"


def test_restore_last_edit_collision_is_atomic(client):
    _, sid, root, _, _ = reused_key(client)
    result = client.post(
        f"{root}/strings/batch", json={"action": "restore_last_history", "string_ids": [sid]}
    )
    assert result.status_code == 409 and result.json()["detail"]["code"] == "key_conflict"
    assert client.get(f"{root}/strings/{sid}").json()["key"] == "b"


def test_key_created_after_preview_returns_conflict(client):
    _, sid, root, original = setup_string(client)
    client.patch(f"{root}/strings/{sid}", json={"key": "b"})
    assert client.get(f"{root}/strings/{sid}/activities/{original}/restore/preview").json()[
        "can_restore"
    ]
    client.post(f"{root}/strings", json={"key": "a", "source_text": "Other"})
    assert client.post(f"{root}/strings/{sid}/activities/{original}/restore").status_code == 409


def test_database_collision_race_is_translated_and_rolled_back(client, monkeypatch):
    from app.services import activities

    _, sid, root, original, _ = reused_key(client)
    monkeypatch.setattr(activities, "check_key_available", lambda *args: None)
    result = client.post(f"{root}/strings/{sid}/activities/{original}/restore")
    assert result.status_code == 409 and result.json()["detail"]["code"] == "key_conflict"
    assert client.get(f"{root}/strings/{sid}").json()["key"] == "b"
    assert len(client.get(f"{root}/strings/{sid}/activities").json()["items"]) == 2


def test_batch_collision_rolls_back_earlier_inverse_and_markers(client):
    _, sid, root, _, _ = reused_key(client)
    client.post(f"{root}/strings", json={"key": "c", "source_text": "C1"})
    imported = client.post(
        f"{root}/strings/import", json={"strings": {"b": "B2", "c": "C2"}}
    ).json()
    # Give the b edit a historical key now owned by the separate a row. c runs first.
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        rows = db.query(Activity).filter(Activity.batch_id == uuid.UUID(imported["batch_id"])).all()
        for row in rows:
            if row.string_id == uuid.UUID(sid):
                row.before = {**row.before, "key": "a"}
                row.created_at = datetime.now(UTC) - timedelta(seconds=1)
            else:
                row.created_at = datetime.now(UTC)
        db.commit()
    finally:
        generator.close()
    before = client.get(f"{root}/strings").json()["items"]
    result = client.post(
        f"{root}/activities/batch/{imported['batch_id']}/revert", params={"force": True}
    )
    assert result.status_code == 409 and result.json()["detail"]["code"] == "key_conflict"
    assert client.get(f"{root}/strings").json()["items"] == before
    rows = client.get(f"{root}/activities", params={"batch_id": imported["batch_id"]}).json()[
        "items"
    ]
    assert all(row["reverted_by_id"] is None for row in rows)
    assert (
        client.get(f"{root}/activities/feed", params={"event_type": "revert"}).json()["total"] == 0
    )


def test_repeated_string_operations_in_one_batch_have_clean_preview(client):
    _, sid, root, _ = setup_string(client)
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A2"})
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A3"})
    batch = uuid.uuid4()
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        for row in db.query(Activity).filter(
            Activity.string_id == uuid.UUID(sid), Activity.action == "update"
        ):
            row.batch_id = batch
            row.batch_kind = "import"
        db.commit()
    finally:
        generator.close()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert preview["can_revert"] and preview["conflict_count"] == 0
    assert client.post(f"{root}/activities/batch/{batch}/revert").status_code == 200
    assert client.get(f"{root}/strings/{sid}").json()["source_text"] == "A1"


def test_batch_key_validation_accounts_for_keys_released_by_earlier_inverse_steps(client):
    _, sid, root, _ = setup_string(client)
    client.patch(f"{root}/strings/{sid}", json={"key": "renamed"})
    created = client.post(f"{root}/strings", json={"key": "a", "source_text": "Other"}).json()
    batch = uuid.uuid4()
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        rename = (
            db.query(Activity)
            .filter(Activity.string_id == uuid.UUID(sid), Activity.action == "update")
            .one()
        )
        create = db.query(Activity).filter(Activity.string_id == uuid.UUID(created["id"])).one()
        for row in (rename, create):
            row.batch_id = batch
            row.batch_kind = "batch"
        db.commit()
    finally:
        generator.close()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert preview["can_revert"] and preview["conflict_count"] == 0
    response = client.post(f"{root}/activities/batch/{batch}/revert")
    assert response.status_code == 200, response.text
    assert client.get(f"{root}/strings/{sid}").json()["key"] == "a"
    assert client.get(f"{root}/strings/{created['id']}").json()["deleted_at"] is not None


def test_snapshot_compatibility_and_missing_vs_empty_fields():
    engine = open_engine()
    Base.metadata.create_all(engine)
    current = {
        "translations": {"en": "Hello", "fr": "Bonjour"},
        "published_translations": {"en": "", "fr": "Bonjour"},
        "module_id": None,
        "tag_ids": [],
        "tag_names": [],
    }
    with Session(engine) as db:
        assert project_snapshot(db, uuid.uuid4(), current, {}) == current
        legacy = {"translations": [{"locale": "en", "value": "Old"}]}
        projected = project_snapshot(db, uuid.uuid4(), current, legacy)
        assert projected["translations"] == {"en": "Old", "fr": ""}
        assert projected["published_translations"] == current["published_translations"]
        empty = project_snapshot(db, uuid.uuid4(), current, {"translations": {}})
        assert empty["translations"] == {"en": "", "fr": ""}
        published = project_snapshot(
            db, uuid.uuid4(), current, {"published_translations": {"en": ""}}, full_state=True
        )
        assert published["published_translations"] == {"en": "", "fr": None}
    assert snapshots_match({"translations": {"en": "", "fr": ""}}, {"translations": {"en": ""}})
    assert not snapshots_match(
        {"translations": {"en": "", "fr": "Bonjour"}}, {"translations": {"en": ""}}
    )
    assert snapshots_match(
        {"published_at": "2026-10-03T00:00:00"}, {"published_at": "2026-10-03T00:00:00+00:00"}
    )
    assert not snapshots_match(
        {"published_translations": {"en": ""}}, {"published_translations": {"en": None}}
    )


def test_key_integrity_error_matches_postgres_unique_violation():
    class Orig(Exception):
        def __init__(self, sqlstate: str, constraint_name: str, message: str) -> None:
            super().__init__(message)
            self.sqlstate = sqlstate
            self.diag = type("Diag", (), {"constraint_name": constraint_name})()

    def wrapped(orig: Exception) -> IntegrityError:
        return IntegrityError("INSERT", {}, orig)

    assert is_key_integrity_error(wrapped(Orig("23505", "uq_project_key_alive", "duplicate key")))
    assert not is_key_integrity_error(wrapped(Orig("23505", "strings_pkey", "duplicate key")))
    legacy_text = "UNIQUE constraint failed: strings.project_id, strings.key"
    assert not is_key_integrity_error(wrapped(Orig("", "", legacy_text)))


def test_unrelated_integrity_errors_are_not_mislabeled():
    engine = open_engine()
    with Session(engine) as db:
        with pytest.raises(IntegrityError):
            with restore_transaction(db):
                raise IntegrityError("stmt", {}, ValueError("foreign key violation"))


def test_deleted_string_undo_blocks_reused_key(client):
    _, sid, root, _ = setup_string(client)
    client.delete(f"{root}/strings/{sid}")
    deleted = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"]
    client.post(f"{root}/strings", json={"key": "a", "source_text": "Other"})
    preview = client.get(f"{root}/activities/{deleted}/revert/preview").json()
    assert not preview["can_revert"]
    result = client.post(f"{root}/activities/{deleted}/revert", params={"force": True})
    assert result.status_code == 409 and result.json()["detail"]["code"] == "key_conflict"
    assert client.get(f"{root}/strings/{sid}").json()["deleted_at"] is not None


def test_blocker_beyond_preview_item_cap_is_aggregated(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    client.post(f"{root}/strings/import", json={"strings": {f"k{i}": "Before" for i in range(25)}})
    batch = client.post(
        f"{root}/strings/import", json={"strings": {f"k{i}": "After" for i in range(25)}}
    ).json()["batch_id"]
    client.post(f"{root}/strings", json={"key": "taken", "source_text": "Other"})
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        row = (
            db.query(Activity)
            .filter(Activity.batch_id == uuid.UUID(batch))
            .order_by(Activity.created_at.asc(), Activity.id.asc())
            .first()
        )
        row.before = {**row.before, "key": "taken"}
        row.created_at = datetime.now(UTC) - timedelta(seconds=10)
        db.commit()
    finally:
        generator.close()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert len(preview["items"]) == 20 and preview["total"] == 25
    assert all(item["blocked_reason"] is None for item in preview["items"])
    assert not preview["can_revert"] and "taken" in preview["blocked_reason"]


def test_guard_checks_published_values_and_timestamp(client):
    pid, sid, root, _ = setup_string(client)
    publish_strings(client, pid, [sid])
    batch = edit_batch(client, root)
    # Change only published state, leaving every working value and status unchanged.
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        from app.models import StringEntry

        entry = db.get(StringEntry, uuid.UUID(sid))
        entry.translations[0].published_value = "Different public value"
        entry.published_at = datetime.now(UTC) + timedelta(seconds=1)
        db.commit()
    finally:
        generator.close()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert preview["requires_force"] and preview["affects_published"]
    assert client.post(f"{root}/activities/batch/{batch}/revert").status_code == 409


def test_undo_warns_when_published_null_changes_to_empty(client):
    pid, sid, root, _ = setup_string(client)
    client.put(f"{root}/strings/{sid}/translations/en", json={"value": ""})
    publish_strings(client, pid, [sid])
    batch = edit_batch(client, root)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        from app.models import StringEntry

        entry = db.get(StringEntry, uuid.UUID(sid))
        entry.translations[0].published_value = None
        db.commit()
    finally:
        generator.close()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert preview["requires_force"] and preview["affects_published"]
    response = client.post(f"{root}/activities/batch/{batch}/revert", params={"force": True})
    assert response.status_code == 200, response.text
    live = client.get(f"{root}/strings/{sid}").json()
    assert next(t for t in live["translations"] if t["locale"] == "en")["published_value"] == ""


def test_history_preview_resolves_deleted_module_and_tag(client):
    _, sid, root, original = setup_string(client)
    module = client.post(f"{root}/modules", json={"slug": "old", "name": "Old"}).json()
    tag = client.post(f"{root}/tags", json={"name": "Old tag"}).json()
    client.patch(
        f"{root}/strings/{sid}",
        json={"module_id": module["id"], "tag_ids": [tag["id"]], "source_text": "A2"},
    )
    version = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"]
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A3"})
    client.delete(f"{root}/modules/{module['id']}")
    client.delete(f"{root}/tags/{tag['id']}")
    preview = client.get(f"{root}/strings/{sid}/activities/{version}/restore/preview").json()
    assert preview["can_restore"]
    assert [row["field"] for row in preview["changes"]] == ["source_text"]
    assert client.post(f"{root}/strings/{sid}/activities/{version}/restore").status_code == 200
    live = client.get(f"{root}/strings/{sid}").json()
    assert live["module_id"] is None and live["tags"] == []
