"""CLI push batches reuse catalog publication and translation review."""

import time

import pytest

from app.config import settings
from tests.helpers import make_project


def review(client, pid, bid):
    response = client.post(
        f"/api/projects/{pid}/strings/publish-preview",
        json={"filter": {"batch_id": bid, "deleted": False, "pending_delete": False}},
    )
    assert response.status_code == 200, response.text
    return response.json()


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
    batch = review(client, pid, result["batch_id"])
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
    fresh = review(client, pid, result["batch_id"])
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


def test_temporary_generation_does_not_save_catalog_content(client, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(21)})
    before = review(client, pid, pushed["batch_id"])
    count = client.get(f"{root}/activities").json()["total"]
    generated = client.post(
        f"{root}/translate/proposals",
        json={
            "batch_id": pushed["batch_id"],
            "scope": "strings",
            "overwrite": True,
            "locales": ["en"],
        },
    )
    assert generated.status_code == 200, generated.text
    assert generated.json()["job_id"]
    after = review(client, pid, pushed["batch_id"])
    assert before == after
    assert client.get(f"{root}/activities").json()["total"] == count


def test_large_proposal_retry_excludes_all_reviewed_cells(client, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(101)})
    before = review(client, pid, pushed["batch_id"])
    response = client.post(
        f"{root}/translate/proposals",
        json={
            "scope": "strings",
            "batch_id": pushed["batch_id"],
            "locales": ["en", "ja"],
            "overwrite": True,
            "exclude_cells": {row["id"]: ["en"] for row in before["items"]},
        },
    )
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]
    assert job_id
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"completed", "failed"}:
            break
        time.sleep(0.05)
    assert job["status"] == "completed", job
    items = job["result"]["items"]
    assert len(items) == 101
    assert all(set(item["translations"]) == {"ja"} for item in items)
    assert review(client, pid, pushed["batch_id"]) == before


def test_catalog_review_excludes_other_batches_and_projects(client):
    pid = make_project(client)["id"]
    other = make_project(client, "Other")["id"]
    push(client, pid, {"unrelated": "Before"})
    pushed = push(client, pid, {"selected": "After"})
    bid = pushed["batch_id"]
    assert [row["key"] for row in review(client, pid, bid)["items"]] == ["selected"]
    assert review(client, other, bid)["items"] == []
    listed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": bid})
    assert listed.status_code == 200, listed.text
    assert [row["key"] for row in listed.json()["items"]] == ["selected"]
