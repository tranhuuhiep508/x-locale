"""Inclusive datetime bounds retain the selected day's last microsecond."""

from __future__ import annotations

import uuid
from contextlib import closing
from datetime import datetime

import pytest
from sqlalchemy import update

from app.database import get_db
from app.models import Activity, StringEntry


@pytest.mark.parametrize("endpoint", ["strings", "activities/feed"])
def test_time_range_keeps_full_final_second(client, endpoint):
    project = client.post(
        "/api/projects", json={"name": "Time boundaries", "target_languages": ["en"]}
    )
    assert project.status_code == 201
    pid = project.json()["id"]
    stamps = {
        "before": "2026-01-09T23:59:59.999999Z",
        "start": "2026-01-10T00:00:00.000000Z",
        "fractional": "2026-01-12T23:59:59.500000Z",
        "last": "2026-01-12T23:59:59.999999Z",
        "next": "2026-01-13T00:00:00.000000Z",
    }
    ids = {}
    for key in stamps:
        created = client.post(
            f"/api/projects/{pid}/strings", json={"key": key, "source_text": key}
        )
        assert created.status_code == 201
        ids[key] = uuid.UUID(created.json()["id"])

    with closing(client.app.dependency_overrides[get_db]()) as sessions:
        db = next(sessions)
        for key, value in stamps.items():
            stamp = datetime.fromisoformat(value)
            db.execute(
                update(StringEntry).where(StringEntry.id == ids[key]).values(updated_at=stamp)
            )
            db.execute(
                update(Activity).where(Activity.string_id == ids[key]).values(created_at=stamp)
            )
        db.commit()

    params = {"since": "2026-01-10T00:00:00.000Z", "until": "2026-01-12T23:59:59.999999Z"}
    if endpoint == "activities/feed":
        params["event_type"] = "string.created"
    response = client.get(f"/api/projects/{pid}/{endpoint}", params=params)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    field = "id" if endpoint == "strings" else "string_id"
    assert {row[field] for row in body["items"]} == {
        str(ids[key]) for key in ("start", "fractional", "last")
    }
