"""API regressions for shared string-filter correctness."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, update

from app.database import get_db
from app.main import app
from app.models import StringEntry, Translation
from tests.helpers import make_project


@pytest.fixture()
def filter_catalog(client):
    project = make_project(client, "Filter correctness", targets=["en", "fr"])
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "common", "name": "Common"},
    ).json()
    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "tagged", "color": "#123456"},
    ).json()
    values = {
        "absent": (None, None),
        "empty": ("", 0),
        "spaces": ("   ", 0),
        "unscored": ("Text", None),
        "low": ("Low", 0),
        "boundary": ("  Boundary  ", 50),
        "above": ("Above", 51),
        "other_locale": ("   ", 0),
    }
    entries = {}
    for key, (value, _) in values.items():
        payload = {
            "key": key,
            "source_text": key,
            "translations": {"en": value} if value is not None else {},
        }
        if key == "other_locale":
            payload["translations"]["fr"] = "Autre"
        if key == "low":
            payload.update(module_id=module["id"], tag_ids=[tag["id"]])
        response = client.post(f"/api/projects/{pid}/strings", json=payload)
        assert response.status_code == 201, response.text
        entries[key] = response.json()

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        db.execute(
            delete(Translation).where(
                Translation.string_id == uuid.UUID(entries["absent"]["id"])
            )
        )
        for key, (_, score) in values.items():
            if key != "absent":
                db.execute(
                    update(Translation)
                    .where(
                        Translation.string_id == uuid.UUID(entries[key]["id"]),
                        Translation.locale == "en",
                    )
                    .values(confidence=score)
                )
        db.execute(
            update(Translation)
            .where(
                Translation.string_id == uuid.UUID(entries["other_locale"]["id"]),
                Translation.locale == "fr",
            )
            .values(confidence=80)
        )
        db.commit()
    finally:
        db_gen.close()
    return project, module, tag, entries


def assert_filter_parity(client, pid, filters, expected_ids):
    params = {
        {"module_id": "module", "tag_id": "tag"}.get(key, key): value
        for key, value in filters.items()
    }
    listed = client.get(f"/api/projects/{pid}/strings", params=params)
    assert listed.status_code == 200, listed.text
    assert {item["id"] for item in listed.json()["items"]} == expected_ids
    assert listed.json()["total"] == len(expected_ids)

    preview = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"filter": filters},
    )
    assert preview.status_code == 200, preview.text
    assert {item["id"] for item in preview.json()["items"]} == expected_ids

    tag_response = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "reviewed", "color": "#654321"},
    )
    assert tag_response.status_code == 201, tag_response.text
    tag_id = tag_response.json()["id"]
    batch = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "add_tags",
            "filter": filters,
            "payload": {"tag_ids": [tag_id]},
        },
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["affected"] == len(expected_ids)
    after = client.get(f"/api/projects/{pid}/strings").json()["items"]
    assert {
        item["id"]
        for item in after
        if any(tag["id"] == tag_id for tag in item["tags"])
    } == expected_ids


@pytest.mark.parametrize(
    ("threshold", "expected"),
    [
        (0, {"low"}),
        (50, {"low", "boundary"}),
        (100, {"low", "boundary", "above", "other_locale"}),
    ],
)
def test_confidence_filter_parity(client, filter_catalog, threshold, expected):
    project, _, _, entries = filter_catalog
    assert_filter_parity(
        client,
        project["id"],
        {"max_confidence": threshold},
        {entries[key]["id"] for key in expected},
    )


@pytest.mark.parametrize("missing_filter", ["missing_locale", "missing_any"])
def test_empty_and_absent_translations_count_as_missing(client, filter_catalog, missing_filter):
    project, _, _, entries = filter_catalog
    filters = {missing_filter: "en" if missing_filter == "missing_locale" else True}
    if missing_filter == "missing_any":
        expected = set(entries)
    else:
        expected = {"absent", "empty", "spaces", "other_locale"}
    response = client.get(f"/api/projects/{project['id']}/strings", params=filters)
    assert response.status_code == 200, response.text
    assert {item["key"] for item in response.json()["items"]} == expected


@pytest.mark.parametrize(
    "filters",
    [
        {"missing_locale": "fr", "complete_locale": "en"},
        {"missing_any": True, "complete_locale": "en"},
    ],
)
def test_cross_locale_filter_parity(client, filter_catalog, filters):
    project, _, _, entries = filter_catalog
    expected = {"low", "boundary", "above", "unscored"}
    assert_filter_parity(
        client, project["id"], filters, {entries[key]["id"] for key in expected}
    )


def test_false_organization_flags_allow_specific_filters(client, filter_catalog):
    project, module, tag, entries = filter_catalog
    assert_filter_parity(
        client,
        project["id"],
        {
            "module_id": module["id"],
            "unassigned_module": False,
            "tag_id": tag["id"],
            "untagged": False,
            "missing_any": False,
            "complete_locale": "en",
        },
        {entries["low"]["id"]},
    )


def assert_filter_conflict(client, pid, filters, fields):
    base = f"/api/projects/{pid}"
    before = client.get(f"{base}/strings").json()
    activities_before = client.get(f"{base}/activities").json()
    params = {
        {"module_id": "module", "tag_id": "tag"}.get(key, key): value
        for key, value in filters.items()
    }
    responses = [
        client.get(f"{base}/strings", params=params),
        client.post(f"{base}/strings/publish-preview", json={"filter": filters}),
        client.post(
            f"{base}/strings/batch",
            json={"action": "delete", "filter": filters},
        ),
    ]
    for response in responses:
        assert response.status_code == 400, response.text
        detail = response.json()["detail"]
        assert all(field in detail for field in fields)
    assert client.get(f"{base}/strings").json() == before
    assert client.get(f"{base}/strings", params={"deleted": True}).json()["total"] == 0
    assert client.get(f"{base}/activities").json() == activities_before


@pytest.mark.parametrize("kind", ["module", "tag", "locale"])
def test_conflicts_rejected_across_filtered_endpoints(client, filter_catalog, kind):
    project, module, tag, _ = filter_catalog
    filters, fields = {
        "module": (
            {"module_id": module["id"], "unassigned_module": True},
            ("module", "unassigned_module"),
        ),
        "tag": (
            {"tag_id": tag["id"], "untagged": True},
            ("tag", "untagged"),
        ),
        "locale": (
            {"missing_locale": "en", "complete_locale": "en"},
            ("missing_locale", "complete_locale"),
        ),
    }[kind]
    assert_filter_conflict(client, project["id"], filters, fields)


def test_missing_any_conflict_with_single_target(client):
    project = make_project(client, "Single target conflict", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "ready", "source_text": "Ready", "translations": {"en": "Ready"}},
    )
    assert created.status_code == 201, created.text
    assert_filter_conflict(
        client,
        pid,
        {"missing_any": True, "complete_locale": "en"},
        ("missing_any", "complete_locale"),
    )


def test_explicit_ids_take_precedence_over_conflicting_filter(client, filter_catalog):
    project, module, _, entries = filter_catalog
    pid = project["id"]
    body = {
        "string_ids": [entries["low"]["id"]],
        "filter": {"module_id": module["id"], "unassigned_module": True},
    }
    preview = client.post(f"/api/projects/{pid}/strings/publish-preview", json=body)
    assert preview.status_code == 200, preview.text
    assert [item["id"] for item in preview.json()["items"]] == body["string_ids"]
    batch = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={**body, "action": "publish", "fingerprint": preview.json()["fingerprint"]},
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["affected"] == 1
    rows = client.get(f"/api/projects/{pid}/strings").json()["items"]
    assert {item["id"] for item in rows if item["status"] == "public"} == set(body["string_ids"])


def test_translation_only_edit_enters_recent_update_windows(client):
    project = make_project(client, "Translation recency")
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "old", "source_text": "Old", "translations": {"en": "Before"}},
    )
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        db.execute(
            update(StringEntry)
            .where(StringEntry.id == uuid.UUID(sid))
            .values(updated_at=datetime.now(UTC) - timedelta(days=31))
        )
        db.commit()
    finally:
        db_gen.close()

    for days in (7, 30):
        response = client.get(
            f"/api/projects/{pid}/strings", params={"updated_within_days": days}
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 0

    edited = client.put(
        f"/api/projects/{pid}/strings/{sid}/translations/en",
        json={"value": "After"},
    )
    assert edited.status_code == 200, edited.text
    for days in (7, 30):
        response = client.get(
            f"/api/projects/{pid}/strings", params={"updated_within_days": days}
        )
        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()["items"]] == [sid]
        assert response.json()["items"][0]["source_text"] == "Old"
