"""Regression coverage for review gaps in restoration validation and ordering."""

import time
import uuid
from datetime import datetime

import pytest

from app.database import get_db
from app.main import app
from app.models import Activity
from app.services.activities import _sort_feed_rows
from tests.test_activity_restore_regressions import edit_batch, setup_string


def change_snapshot(activity_id, side, field, value):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        row = db.get(Activity, uuid.UUID(activity_id))
        setattr(row, side, {**getattr(row, side), field: value})
        db.commit()
    finally:
        generator.close()


@pytest.mark.parametrize("timezone", ["UTC", "Asia/Bangkok", "Europe/Berlin"])
def test_naive_utc_order_does_not_depend_on_server_timezone(monkeypatch, timezone):
    if not hasattr(time, "tzset"):
        pytest.skip("tzset is unavailable")
    with monkeypatch.context() as context:
        context.setenv("TZ", timezone)
        time.tzset()
        try:
            earlier = Activity(id=uuid.UUID(int=2), created_at=datetime(2026, 3, 29, 2, 30))
            later = Activity(id=uuid.UUID(int=1), created_at=datetime(2026, 3, 29, 3, 15))
            assert _sort_feed_rows([earlier, later]) == [later, earlier]
            later.created_at = earlier.created_at
            assert _sort_feed_rows([later, earlier]) == [earlier, later]
        finally:
            context.undo()
            time.tzset()


@pytest.mark.parametrize("side", ["before", "after"])
@pytest.mark.parametrize("field", ["published_at", "deleted_at"])
@pytest.mark.parametrize("value", ["invalid-date", True, 42, [], {}])
def test_malformed_timestamp_blocks_preview_and_both_execution_modes(client, side, field, value):
    _, sid, root, _ = setup_string(client)
    batch = edit_batch(client, root)
    activity_id = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]["id"]
    change_snapshot(activity_id, side, field, value)
    before = client.get(f"{root}/strings/{sid}").json()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview")
    assert preview.status_code == 200, preview.text
    assert not preview.json()["can_revert"]
    assert field in preview.json()["blocked_reason"]
    for path in (f"activities/{activity_id}", f"activities/batch/{batch}"):
        for force in (False, True):
            response = client.post(f"{root}/{path}/revert", params={"force": force})
            assert response.status_code == 409, response.text
            detail = response.json()["detail"]
            assert detail["code"] == "invalid_snapshot"
            assert detail["activity_id"] == activity_id
            assert detail["field"] == f"{side}.{field}"
    assert client.get(f"{root}/strings/{sid}").json() == before
    assert len(client.get(f"{root}/strings/{sid}/activities").json()["items"]) == 2


def test_invalid_timestamp_outside_preview_cap_rolls_back_all_steps(client):
    _, sid, root, _ = setup_string(client)
    client.post(f"{root}/strings/import", json={"strings": {f"k{i}": "Before" for i in range(25)}})
    batch = client.post(
        f"{root}/strings/import", json={"strings": {f"k{i}": "After" for i in range(25)}}
    ).json()["batch_id"]
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        rows = db.query(Activity).filter(Activity.batch_id == uuid.UUID(batch)).all()
        row = _sort_feed_rows(rows)[-1]
        row.before = {**row.before, "published_at": "bad-date"}
        count_before = db.query(Activity).count()
        db.commit()
    finally:
        generator.close()
    preview = client.get(f"{root}/activities/batch/{batch}/revert/preview").json()
    assert len(preview["items"]) == 20
    assert all(item["blocked_reason"] is None for item in preview["items"])
    assert not preview["can_revert"] and "published_at" in preview["blocked_reason"]
    assert client.post(f"{root}/activities/batch/{batch}/revert", params={"force": True}).status_code == 409
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        assert db.query(Activity).count() == count_before
        assert all(a.reverted_by_id is None for a in db.query(Activity).filter(Activity.batch_id == uuid.UUID(batch)))
    finally:
        generator.close()
    strings = client.get(f"{root}/strings", params={"page_size": 100}).json()["items"]
    assert all(s["source_text"] == "After" for s in strings if s["id"] != sid)


def test_history_ignores_malformed_publication_dates(client):
    _, sid, root, original = setup_string(client)
    client.patch(f"{root}/strings/{sid}", json={"source_text": "A2"})
    for field in ("published_at", "deleted_at"):
        change_snapshot(original, "after", field, "bad-date")
    preview = client.get(f"{root}/strings/{sid}/activities/{original}/restore/preview")
    assert preview.status_code == 200 and preview.json()["can_restore"]
    assert client.post(f"{root}/strings/{sid}/activities/{original}/restore").status_code == 200
    assert client.get(f"{root}/strings/{sid}").json()["source_text"] == "A1"
