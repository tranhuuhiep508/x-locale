"""Translate missing must stay within the active grid filter scope."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.database import get_db
from app.main import app
from app.models import StringEntry
from tests.helpers import make_project


@pytest.fixture()
def translation_catalog(client):
    project = make_project(client, "Translation filters", targets=["en", "fr"])
    base = f"/api/projects/{project['id']}"
    module = client.post(f"{base}/modules", json={"slug": "common", "name": "Common"}).json()
    tag = client.post(f"{base}/tags", json={"name": "Featured"}).json()
    entries = {}
    for key, extra in {
        "unassigned": {"translations": {"en": "Ready"}, "translation_scores": {"en": 40}},
        "assigned": {"module_id": module["id"], "tag_ids": [tag["id"]]},
        "released": {"status": "public", "translations": {"en": "Ready"}},
        "complete": {"translations": {"en": "Ready", "fr": "Prêt"}},
        "old": {"translations": {"en": "Ready"}},
        "deleted": {},
    }.items():
        response = client.post(f"{base}/strings", json={"key": key, "source_text": key, **extra})
        assert response.status_code == 201, response.text
        entries[key] = response.json()
    client.patch(f"{base}/strings/{entries['released']['id']}", json={"source_text": "Edited"})
    client.delete(f"{base}/strings/{entries['deleted']['id']}")
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        db.execute(
            update(StringEntry)
            .where(StringEntry.id == uuid.UUID(entries["old"]["id"]))
            .values(updated_at=datetime.now(UTC) - timedelta(days=31))
        )
        db.commit()
    finally:
        db_gen.close()
    return base, entries


def test_translation_endpoints_match_grid_with_since_until(
    client, monkeypatch, translation_catalog
):
    since = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    filters = {"since": since}
    base, _ = translation_catalog
    grid = client.get(f"{base}/strings", params=filters)
    assert grid.status_code == 200, grid.text
    expected = {
        item["id"]
        for item in grid.json()["items"]
        if not item["deleted_at"]
        and any(not t["value"].strip() for t in item["translations"] if t["locale"] in {"en", "fr"})
    }

    def fake_batch(source_locale, items, on_progress=None):
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    response = client.post(
        f"{base}/translate/missing",
        json={"locales": ["en", "fr"], **filters},
    )
    assert response.status_code == 200, response.text
    assert {item["string_id"] for item in response.json()["items"]} == expected


@pytest.mark.parametrize("endpoint", ["missing", "proposals", "direct"])
@pytest.mark.parametrize(
    "filters",
    [
        {"unassigned_module": True},
        {"untagged": True},
        {"status": "public"},
        {"never_published": True},
        {"has_unpublished_changes": True},
        {"complete_locale": "en"},
        {"missing_locale": "en"},
        {"missing_any": True},
        {"max_confidence": 40},
        {"updated_within_days": 7},
        {"deleted": True},
        {
            "never_published": True,
            "unassigned_module": True,
            "untagged": True,
            "complete_locale": "en",
            "updated_within_days": 30,
            "max_confidence": 40,
        },
    ],
)
def test_translation_endpoints_intersect_grid_with_missing_cells(
    client, monkeypatch, translation_catalog, filters, endpoint
):
    base, _ = translation_catalog
    grid = client.get(f"{base}/strings", params=filters)
    assert grid.status_code == 200, grid.text
    expected = {
        item["id"]
        for item in grid.json()["items"]
        if not item["deleted_at"]
        and any(not t["value"].strip() for t in item["translations"] if t["locale"] in {"en", "fr"})
    }
    generated = set()

    def fake_batch(source_locale, items, on_progress=None):
        generated.update(str(item.id) for item in items)
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    activities_before = client.get(f"{base}/activities").json()["total"]
    path = "/translate" if endpoint == "direct" else f"/translate/{endpoint}"
    response = client.post(f"{base}{path}", json={"locales": ["en", "fr"], **filters})
    assert response.status_code == 200, response.text
    if endpoint != "direct":
        assert {item["string_id"] for item in response.json()["items"]} == expected
        assert response.json()["total"] == len(expected)
        assert client.get(f"{base}/activities").json()["total"] == activities_before
    if endpoint != "missing":
        assert generated == expected
    else:
        assert not generated


def test_complete_requested_locale_produces_empty_queue(client, translation_catalog):
    base, _ = translation_catalog
    response = client.post(
        f"{base}/translate/missing", json={"locales": ["en"], "complete_locale": "en"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 0
    assert response.json()["items"] == []


def test_filtered_queue_paging_and_apply_refresh(client, translation_catalog):
    base, entries = translation_catalog
    filters = {"unassigned_module": True, "untagged": True, "complete_locale": "en"}
    request = {"locales": ["en", "fr"], "page_size": 1, **filters}
    first = client.post(f"{base}/translate/missing", json=request).json()
    second = client.post(f"{base}/translate/missing", json={**request, "page": 2}).json()
    assert first["total"] == second["total"] == 3
    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["string_id"] != second["items"][0]["string_id"]
    assert entries["complete"]["id"] not in {
        first["items"][0]["string_id"],
        second["items"][0]["string_id"],
    }
    apply = client.post(
        f"{base}/translate/apply",
        json={
            "items": [{"string_id": first["items"][0]["string_id"], "translations": {"fr": "Prêt"}}]
        },
    )
    assert apply.status_code == 200, apply.text
    refreshed = client.post(f"{base}/translate/missing", json={**request, "page": 99}).json()
    assert refreshed["total"] == 2
    assert refreshed["page"] == 2
    assert refreshed["items"][0]["string_id"] != first["items"][0]["string_id"]
