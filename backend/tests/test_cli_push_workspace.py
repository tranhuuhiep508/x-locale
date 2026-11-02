"""CLI batch scope, guarded regeneration, and public snapshot protection."""

import time
import uuid

import pytest

from app.config import settings
from tests.helpers import json_upload, make_project, publish_strings


def push(client, pid, strings, **kwargs):
    response = client.post(
        f"/api/projects/{pid}/strings/import", json={"strings": strings}, **kwargs
    )
    assert response.status_code in (200, 202), response.text
    result = response.json()
    if response.status_code == 202:
        for _ in range(200):
            job = client.get(f"/api/jobs/{result['job_id']}").json()
            if job["status"] in {"completed", "failed"}:
                break
            time.sleep(0.05)
        assert job["status"] == "completed", job
        result = job["result"]
    return result


def workspace(client, pid, bid):
    response = client.get(f"/api/projects/{pid}/cli-push-batches/{bid}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("background", [False, True])
def test_cli_batch_metadata_scope_and_publication(client, monkeypatch, background):
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    old = client.post(
        f"{root}/strings",
        json={
            "key": "changed",
            "source_text": "Cũ",
            "translations": {"en": "Old"},
            "status": "public",
        },
    ).json()
    monkeypatch.setattr(settings, "import_async_threshold", 1 if background else 5000)
    result = push(
        client,
        pid,
        {"changed": "Mới", "new": "Xin chào"},
        headers={"Prefer": "respond-async"} if background else {},
    )
    batch = workspace(client, pid, result["batch_id"])
    assert (batch["created_count"], batch["updated_count"], batch["excluded_count"]) == (1, 1, 0)
    assert {item["key"] for item in batch["items"]} == {"changed", "new"}
    feed = client.get(f"{root}/activities/feed").json()["items"]
    card = next(c for c in feed if c["batch_id"] == result["batch_id"])
    assert card["batch_kind"] == "cli_push"
    assert card["is_undoable"]
    assert "CLI push" in card["summary"]
    assert all(
        row["batch_kind"] == "cli_push"
        for row in client.get(f"{root}/activities", params={"batch_id": result["batch_id"]}).json()[
            "items"
        ]
    )
    assert client.get(f"{root}/strings/{old['id']}").json()["published_source_text"] == "Cũ"
    snapshot_filter = {"batch_id": result["batch_id"], "deleted": False, "pending_delete": False}
    client.patch(f"{root}/strings/{old['id']}", json={"translations": {"en": "Newer"}})
    stale = client.post(
        f"{root}/strings/batch",
        json={
            "action": "publish",
            "filter": snapshot_filter,
            "fingerprint": batch["fingerprint"],
        },
    )
    assert stale.status_code == 409
    assert client.get(f"{root}/strings/{old['id']}").json()["published_source_text"] == "Cũ"
    fresh = workspace(client, pid, result["batch_id"])
    published = client.post(
        f"{root}/strings/batch",
        json={
            "action": "publish",
            "filter": snapshot_filter,
            "fingerprint": fresh["fingerprint"],
        },
    )
    assert published.status_code == 200, published.text
    assert client.get(f"{root}/strings/{old['id']}").json()["published_source_text"] == "Mới"


def test_workspace_excludes_deleted_and_other_projects_and_legacy_import(client):
    pid = make_project(client)["id"]
    result = push(client, pid, {"a": "A", "b": "B"})
    batch = workspace(client, pid, result["batch_id"])
    a, b = batch["items"]
    publish_strings(client, pid, [a["id"]])
    client.delete(f"/api/projects/{pid}/strings/{a['id']}")
    client.delete(f"/api/projects/{pid}/strings/{b['id']}")
    excluded = workspace(client, pid, result["batch_id"])
    assert excluded["items"] == []
    assert excluded["excluded_count"] == 2
    other = make_project(client, "Other")["id"]
    assert (
        client.get(f"/api/projects/{other}/cli-push-batches/{result['batch_id']}").status_code
        == 404
    )
    legacy = client.post(f"/api/projects/{pid}/import", files=json_upload({"old": "Old"})).json()
    assert (
        client.get(f"/api/projects/{pid}/cli-push-batches/{legacy['batch_id']}").status_code == 404
    )
    assert client.get(f"/api/projects/{pid}/cli-push-batches/{uuid.uuid4()}").status_code == 404


def test_noop_and_dry_run_pushes_have_no_workspace(client):
    pid = make_project(client)["id"]
    push(client, pid, {"a": "A"})
    for params in ({}, {"dry_run": True}):
        result = push(client, pid, {"a": "A"}, params=params)
        assert (
            client.get(f"/api/projects/{pid}/cli-push-batches/{result['batch_id']}").status_code
            == 404
        )


def proposal(client, monkeypatch, count=1):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    push(client, pid, {f"key{i}": f"Nguồn {i}" for i in range(count)})
    items = client.get(f"{root}/strings").json()["items"]
    for item in items:
        client.patch(f"{root}/strings/{item['id']}", json={"translations": {"en": "Old"}})
    publish_strings(client, pid, [i["id"] for i in items])

    def fake_batch(source_locale, rows, on_progress=None):
        return {row.id: {locale: "Generated" for locale in row.locales} for row in rows}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    generated = client.post(
        f"{root}/translate/proposals",
        json={
            "scope": "strings",
            "string_ids": [i["id"] for i in items],
            "locales": ["en"],
            "overwrite": True,
        },
    ).json()
    if generated.get("job_id"):
        generated = client.get(f"/api/jobs/{generated['job_id']}").json()["result"]
    payload = {
        "overwrite": True,
        "items": [
            {
                "string_id": row["string_id"],
                "expected_source_text": row["source_text"],
                "translations": row["translations"],
                "expected_translations": row["expected_translations"],
                "scores": {"en": 92},
            }
            for row in generated["items"]
        ],
    }
    return root, payload


@pytest.mark.parametrize("count", [1, 21])
def test_generated_baselines_sync_and_async_overwrite_only_working_copy(client, monkeypatch, count):
    root, payload = proposal(client, monkeypatch, count)
    assert all(item["expected_translations"] == {"en": "Old"} for item in payload["items"])
    response = client.post(f"{root}/translate/apply", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["translated_count"] == count
    row = client.get(f"{root}/strings/{payload['items'][0]['string_id']}").json()
    assert row["translations"][0]["value"] == "Generated"
    assert row["translations"][0]["published_value"] == "Old"
    assert row["translations"][0]["confidence"] == 92
    assert client.post(f"{root}/translate/apply", json=payload).json()["translated_count"] == 0


@pytest.mark.parametrize("change", ["target", "source", "pending_delete", "deleted"])
def test_guarded_apply_conflicts_are_atomic(client, monkeypatch, change):
    root, payload = proposal(client, monkeypatch, 2)
    sid = payload["items"][0]["string_id"]
    if change == "target":
        client.patch(f"{root}/strings/{sid}", json={"translations": {"en": "Human"}})
    elif change == "source":
        client.patch(f"{root}/strings/{sid}", json={"source_text": "Changed"})
    else:
        client.delete(f"{root}/strings/{sid}")
        if change == "deleted":
            publish_strings(client, root.split("/")[-1], [sid])
    response = client.post(f"{root}/translate/apply", json=payload)
    assert response.status_code == 409, response.text
    untouched = client.get(f"{root}/strings/{payload['items'][1]['string_id']}").json()
    assert untouched["translations"][0]["value"] == "Old"


def test_overwrite_requires_baselines_and_legacy_apply_still_skips_existing(client, monkeypatch):
    root, payload = proposal(client, monkeypatch)
    payload["items"][0].pop("expected_translations")
    assert client.post(f"{root}/translate/apply", json=payload).status_code == 422
    payload.pop("overwrite")
    response = client.post(f"{root}/translate/apply", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["translated_count"] == 0
