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


def test_workspace_excludes_deleted_and_other_projects(client):
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


def atomic_payload(batch, value="Reviewed"):
    return {
        "fingerprint": batch["fingerprint"],
        "items": [
            {
                "string_id": row["id"],
                "expected_source_text": row["source_text"],
                "translations": {"en": value},
                "scores": {"en": 91},
            }
            for row in batch["items"]
        ],
    }


@pytest.mark.parametrize("pending_delete", [False, True])
def test_cli_mixed_publication_history_preserves_public_and_lifecycle(client, pending_delete):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {"greeting": "Greeting"})
    batch = workspace(client, pid, pushed["batch_id"])
    sid = batch["items"][0]["id"]
    published = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/publish",
        json=atomic_payload(batch, "Welcome"),
    )
    assert published.status_code == 200, published.text
    version = client.get(f"{root}/strings/{sid}/activities").json()["items"][0]
    assert (
        version["event_type"] == "string.saved_and_published" and version["is_history_restorable"]
    )
    assert (
        client.patch(
            f"{root}/strings/{sid}",
            json={"translations": {"en": "Good morning"}, "status": "public"},
        ).status_code
        == 200
    )
    # A locale added after the version is cleared only in the working copy.
    assert client.patch(root, json={"target_languages": ["en", "fr"]}).status_code == 200
    assert (
        client.patch(
            f"{root}/strings/{sid}", json={"translations": {"fr": "Bonjour"}, "status": "public"}
        ).status_code
        == 200
    )
    if pending_delete:
        assert client.delete(f"{root}/strings/{sid}").status_code == 204
    public_before = client.get(f"{root}/export", params={"stage": "public"}).json()
    restore_url = f"{root}/strings/{sid}/activities/{version['id']}/restore"
    assert client.get(f"{restore_url}/preview").json()["can_restore"]
    restored = client.post(restore_url)
    assert restored.status_code == 200, restored.text
    live = client.get(f"{root}/strings/{sid}").json()
    assert live["status"] == "public" and live["pending_delete"] == pending_delete
    assert live["deleted_at"] is None
    assert {t["locale"]: t["value"] for t in live["translations"]} == {"en": "Welcome", "fr": ""}
    assert {t["locale"]: t["published_value"] for t in live["translations"]} == {
        "en": "Good morning",
        "fr": "Bonjour",
    }
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == public_before


def test_atomic_completion_saves_and_publishes_more_than_one_apply_chunk(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(101)})
    batch = workspace(client, pid, pushed["batch_id"])
    assert all(t["value"] == "" for row in batch["items"] for t in row["translations"])
    result = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=atomic_payload(batch)
    )
    assert result.status_code == 200, result.text
    assert result.json()["affected"] == 101
    action_id = result.json()["batch_id"]
    assert action_id != pushed["batch_id"]
    rows = client.get(f"{root}/activities", params={"batch_id": action_id, "page_size": 200}).json()
    assert rows["total"] == 101
    assert all(row["event_type"] == "string.saved_and_published" for row in rows["items"])
    assert (
        client.get(
            f"{root}/activities", params={"batch_id": action_id, "event_type": "string.published"}
        ).json()["total"]
        == 101
    )
    card = next(
        item
        for item in client.get(
            f"{root}/activities/feed", params={"event_type": "string.published"}
        ).json()["items"]
        if item["batch_id"] == action_id
    )
    assert card["summary"] == "Saved and published 101 strings"
    assert card["children_count"] == 101 and card["children"] == []
    assert card["counts"] == {"created": 0, "updated": 0, "deleted": 0, "published": 101}
    detail = client.get(f"{root}/activities/{rows['items'][0]['id']}").json()
    assert {change["scope"] for change in detail["changed"]} == {"draft", "published"}
    preview = client.get(f"{root}/activities/batch/{action_id}/revert/preview").json()
    assert preview["total"] == 101 and preview["affects_published"]
    assert preview["can_revert"] and not preview["requires_force"]
    current = workspace(client, pid, pushed["batch_id"])
    assert all(row["status"] == "public" for row in current["items"])
    assert all(
        t["value"] == t["published_value"] == "Reviewed"
        for row in current["items"]
        for t in row["translations"]
    )
    reverted = client.post(f"{root}/activities/batch/{result.json()['batch_id']}/revert")
    assert reverted.status_code == 200, reverted.text
    after = workspace(client, pid, pushed["batch_id"])
    assert all(
        row["status"] == "draft"
        and row["published_key"] is None
        and all(t["value"] == "" and t["published_value"] is None for t in row["translations"])
        for row in after["items"]
    )
    reverted_detail = client.get(f"{root}/activities/{detail['id']}").json()
    marker = client.get(f"{root}/activities/{reverted_detail['reverted_by']['id']}").json()
    assert marker["revert_of"]["id"] == detail["id"]
    assert marker["batch_id"] == reverted.json()["batch_id"]
    assert marker["event_type"] == "string.restored"


@pytest.mark.parametrize("action", ["publish", "draft"])
@pytest.mark.parametrize("problem", ["source", "outside", "duplicate", "deleted", "locale"])
def test_atomic_completion_validates_entire_request_before_writing(client, problem, action):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {"a": "A", "b": "B"})
    batch = workspace(client, pid, pushed["batch_id"])
    payload = atomic_payload(batch)
    if problem == "source":
        payload["items"][-1]["expected_source_text"] = "Unreviewed source"
    elif problem == "outside":
        payload["items"][-1]["string_id"] = str(uuid.uuid4())
    elif problem == "duplicate":
        payload["items"].append(payload["items"][0])
    elif problem == "locale":
        payload["items"][-1]["translations"] = {"fr": "Not configured"}
    else:
        client.delete(f"{root}/strings/{batch['items'][-1]['id']}")
    before = client.get(f"{root}/activities").json()["total"]
    response = client.post(f"{root}/cli-push-batches/{pushed['batch_id']}/{action}", json=payload)
    assert response.status_code in (400, 409), response.text
    row = client.get(f"{root}/strings/{batch['items'][0]['id']}").json()
    assert row["status"] == "draft"
    assert all(t["value"] == "" and t["published_value"] is None for t in row["translations"])
    assert client.get(f"{root}/activities").json()["total"] == before


def test_collision_rolls_back_translations_publication_and_audit(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    owner = client.post(
        f"{root}/strings", json={"key": "conflict", "source_text": "Original", "status": "public"}
    ).json()
    client.patch(f"{root}/strings/{owner['id']}", json={"key": "renamed"})
    pushed = push(client, pid, {"conflict": "Replacement", "other": "Other"})
    batch = workspace(client, pid, pushed["batch_id"])
    before = client.get(f"{root}/activities").json()["total"]
    response = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=atomic_payload(batch)
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "published_key_conflict"
    after = workspace(client, pid, pushed["batch_id"])
    assert all(
        row["status"] == "draft" and all(t["value"] == "" for t in row["translations"])
        for row in after["items"]
    )
    assert client.get(f"{root}/activities").json()["total"] == before


def test_review_fingerprint_protects_previously_unchanged_public_strings(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {"a": "A"})
    batch = workspace(client, pid, pushed["batch_id"])
    publish_strings(client, pid, [batch["items"][0]["id"]])
    snapshot = workspace(client, pid, pushed["batch_id"])
    row = snapshot["items"][0]
    client.patch(f"{root}/strings/{row['id']}", json={"translations": {"en": "Concurrent"}})
    publish_strings(client, pid, [row["id"]])
    response = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=atomic_payload(snapshot)
    )
    assert response.status_code == 409
    current = client.get(f"{root}/strings/{row['id']}").json()
    assert current["translations"][0]["value"] == "Concurrent"


def test_temporary_generation_does_not_save_catalog_content(client, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(21)})
    before = workspace(client, pid, pushed["batch_id"])
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
    after = workspace(client, pid, pushed["batch_id"])
    assert before == after
    assert client.get(f"{root}/activities").json()["total"] == count


def test_final_completion_can_clear_a_translation_without_early_save(client):
    pid = make_project(client)["id"]
    pushed = push(client, pid, {"a": "A"})
    before = workspace(client, pid, pushed["batch_id"])
    row = before["items"][0]
    root = f"/api/projects/{pid}"
    client.patch(f"{root}/strings/{row['id']}", json={"translations": {"en": "Old"}})
    publish_strings(client, pid, [row["id"]])
    snapshot = workspace(client, pid, pushed["batch_id"])
    payload = atomic_payload(snapshot, "")
    payload["items"][0]["scores"] = {"en": None}
    result = client.post(f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=payload)
    assert result.status_code == 200, result.text
    current = client.get(f"{root}/strings/{row['id']}").json()
    assert (
        current["translations"][0]["value"] == current["translations"][0]["published_value"] == ""
    )


def test_large_proposal_retry_excludes_all_reviewed_cells(client, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(101)})
    before = workspace(client, pid, pushed["batch_id"])
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
    assert workspace(client, pid, pushed["batch_id"]) == before


def test_publish_omits_unchanged_public_strings_from_activity_and_count(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {"a": "A", "b": "B"})
    batch = workspace(client, pid, pushed["batch_id"])
    a_id = next(item["id"] for item in batch["items"] if item["key"] == "a")
    publish_strings(client, pid, [a_id])

    snapshot = workspace(client, pid, pushed["batch_id"])
    b_row = next(item for item in snapshot["items"] if item["key"] == "b")
    payload = {
        "fingerprint": snapshot["fingerprint"],
        "items": [
            {
                "string_id": b_row["id"],
                "expected_source_text": b_row["source_text"],
                "translations": {"en": "B translated"},
            }
        ],
    }
    before_count = client.get(f"{root}/activities").json()["total"]
    result = client.post(f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["affected"] == 1
    after_activities = client.get(f"{root}/activities").json()["items"]
    new_activities = after_activities[: len(after_activities) - before_count]
    assert not any(act.get("string_id") == a_id for act in new_activities)


def test_save_draft_keeps_public_snapshots_and_can_be_undone(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    client.post(
        f"{root}/strings",
        json={
            "key": "existing",
            "source_text": "Old source",
            "translations": {"en": "Old"},
            "status": "public",
        },
    )
    pushed = push(client, pid, {"existing": "New source", "new": "New"})
    before = workspace(client, pid, pushed["batch_id"])
    public_before = client.get(f"{root}/export", params={"stage": "public"}).json()
    saved = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/draft", json=atomic_payload(before)
    )
    assert saved.status_code == 200, saved.text
    action_id = saved.json()["batch_id"]
    assert action_id != pushed["batch_id"]
    rows = client.get(f"{root}/activities", params={"batch_id": action_id}).json()
    assert rows["total"] == 2
    assert all(row["event_type"] == "string.saved_draft" for row in rows["items"])
    translated = client.get(
        f"{root}/activities", params={"event_type": "translation.updated", "batch_id": action_id}
    ).json()
    assert translated["total"] == 2
    card = next(
        item
        for item in client.get(
            f"{root}/activities/feed", params={"event_type": "translation.updated"}
        ).json()["items"]
        if item["batch_id"] == action_id
    )
    assert card["summary"] == "Saved translations as draft · 2 strings"
    assert card["counts"] == {"created": 0, "updated": 2, "deleted": 0, "published": 0}
    after = workspace(client, pid, pushed["batch_id"])
    assert all(
        t["value"] == "Reviewed" and t["confidence"] == 91
        for row in after["items"]
        for t in row["translations"]
    )
    existing = next(row for row in after["items"] if row["key"] == "existing")
    new = next(row for row in after["items"] if row["key"] == "new")
    assert existing["status"] == "public"
    assert existing["published_source_text"] == "Old source"
    assert existing["translations"][0]["published_value"] == "Old"
    assert new["status"] == "draft" and new["published_key"] is None
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == public_before
    stale = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/draft", json=atomic_payload(before)
    )
    assert stale.status_code == 409
    undone = client.post(f"{root}/activities/batch/{saved.json()['batch_id']}/revert")
    assert undone.status_code == 200, undone.text
    restored = workspace(client, pid, pushed["batch_id"])
    assert all(
        t["value"] == ("Old" if row["key"] == "existing" else "")
        for row in restored["items"]
        for t in row["translations"]
    )
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == public_before


def test_large_draft_save_can_clear_values_then_publish_saved_content(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(101)})
    before = workspace(client, pid, pushed["batch_id"])
    saved = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/draft", json=atomic_payload(before)
    )
    assert saved.status_code == 200, saved.text
    current = workspace(client, pid, pushed["batch_id"])
    assert all(
        row["status"] == "draft" and row["published_key"] is None for row in current["items"]
    )
    cleared = atomic_payload(current, "")
    for item in cleared["items"]:
        item["scores"] = {"en": None}
    saved = client.post(f"{root}/cli-push-batches/{pushed['batch_id']}/draft", json=cleared)
    assert saved.status_code == 200, saved.text
    current = workspace(client, pid, pushed["batch_id"])
    assert all(
        t["value"] == "" and t["confidence"] is None
        for row in current["items"]
        for t in row["translations"]
    )
    published = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/publish",
        json={"fingerprint": current["fingerprint"], "items": []},
    )
    assert published.status_code == 200, published.text
    assert published.json()["affected"] == 101
    assert published.json()["batch_id"] not in {pushed["batch_id"], saved.json()["batch_id"]}
    rows = client.get(
        f"{root}/activities", params={"batch_id": published.json()["batch_id"], "page_size": 200}
    ).json()
    assert rows["total"] == 101
    assert all(row["event_type"] == "string.published" for row in rows["items"])
    assert all(
        row["status"] == "public" for row in workspace(client, pid, pushed["batch_id"])["items"]
    )


@pytest.mark.parametrize("publish", [False, True])
def test_review_noop_creates_no_activities(client, publish):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {"a": "A"})
    endpoint = "publish" if publish else "draft"
    initial = workspace(client, pid, pushed["batch_id"])
    assert (
        client.post(
            f"{root}/cli-push-batches/{pushed['batch_id']}/{endpoint}", json=atomic_payload(initial)
        ).status_code
        == 200
    )
    current = workspace(client, pid, pushed["batch_id"])
    before = client.get(f"{root}/activities").json()["total"]
    assert (
        client.post(
            f"{root}/cli-push-batches/{pushed['batch_id']}/{endpoint}", json=atomic_payload(current)
        ).status_code
        == 200
    )
    assert client.get(f"{root}/activities").json()["total"] == before


def test_mixed_publication_batch_counts_all_members_without_duplicate_rows(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {f"key{i}": "Source" for i in range(101)})
    initial = workspace(client, pid, pushed["batch_id"])
    payload = atomic_payload(initial)
    payload["items"] = payload["items"][-1:]
    completed = client.post(f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=payload)
    assert completed.status_code == 200, completed.text
    bid = completed.json()["batch_id"]
    rows = client.get(f"{root}/activities", params={"batch_id": bid, "page_size": 200}).json()
    assert rows["total"] == 101
    assert sum(row["event_type"] == "string.saved_and_published" for row in rows["items"]) == 1
    assert sum(row["event_type"] == "string.published" for row in rows["items"]) == 100
    card = next(
        item
        for item in client.get(
            f"{root}/activities/feed", params={"event_type": "string.published"}
        ).json()["items"]
        if item["batch_id"] == bid
    )
    assert card["children_count"] == 101
    assert card["counts"] == {"created": 0, "updated": 0, "deleted": 0, "published": 101}
    assert card["summary"] == (
        "Updated 101 strings · Saved and published 1 string · Published 100 strings"
    )


def test_combined_undo_conflict_preserves_state_until_force_confirmation(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    pushed = push(client, pid, {"a": "A"})
    initial = workspace(client, pid, pushed["batch_id"])
    sid = initial["items"][0]["id"]
    completed = client.post(
        f"{root}/cli-push-batches/{pushed['batch_id']}/publish", json=atomic_payload(initial)
    ).json()
    assert (
        client.patch(f"{root}/strings/{sid}", json={"translations": {"en": "Later"}}).status_code
        == 200
    )
    before = client.get(f"{root}/strings/{sid}").json()
    count = client.get(f"{root}/activities").json()["total"]
    endpoint = f"{root}/activities/batch/{completed['batch_id']}/revert"
    preview = client.get(f"{endpoint}/preview").json()
    assert preview["requires_force"] and preview["affects_published"]
    assert client.post(endpoint).status_code == 409
    assert client.get(f"{root}/strings/{sid}").json() == before
    assert client.get(f"{root}/activities").json()["total"] == count
    assert client.post(endpoint, params={"force": True}).status_code == 200
    restored = client.get(f"{root}/strings/{sid}").json()
    assert restored["status"] == "draft" and restored["published_key"] is None
    assert all(t["value"] == "" and t["published_value"] is None for t in restored["translations"])


def paste(client, pid, values, locale="vi", **params):
    """Import a pasted JSON map the way the Add many dialog does."""
    response = client.post(
        f"/api/projects/{pid}/import",
        params={"locale": locale, "status": "draft", "partial": "true", **params},
        files=json_upload(values, f"{locale}.json"),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_pasted_import_batch_opens_workspace_saves_draft_then_publishes(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    existing = client.post(
        f"{root}/strings",
        json={"key": "hello", "source_text": "Chào", "translations": {"en": "Hi"}},
    ).json()
    publish_strings(client, pid, [existing["id"]])
    outside = client.post(f"{root}/strings", json={"key": "outside", "source_text": "Ngoài"}).json()
    imported = paste(client, pid, {"hello": "Xin chào", "bye": "Tạm biệt"})
    batch = workspace(client, pid, imported["batch_id"])
    assert batch["batch_kind"] == "import"
    assert (batch["created_count"], batch["updated_count"]) == (1, 1)
    assert {row["key"] for row in batch["items"]} == {"hello", "bye"}
    public_before = client.get(f"{root}/export", params={"stage": "public"}).json()

    url = f"{root}/cli-push-batches/{imported['batch_id']}"
    draft = client.post(f"{url}/draft", json=atomic_payload(batch, "Draft"))
    assert draft.status_code == 200, draft.text
    assert draft.json()["batch_id"] not in {imported["batch_id"], None}
    assert client.get(f"{root}/export", params={"stage": "public"}).json() == public_before
    saved = workspace(client, pid, imported["batch_id"])
    by_key = {row["key"]: row for row in saved["items"]}
    assert by_key["bye"]["status"] == "draft"
    assert by_key["hello"]["status"] == "public"
    assert by_key["hello"]["published_source_text"] == "Chào"
    assert by_key["hello"]["translations"][0]["value"] == "Draft"

    published = client.post(f"{url}/publish", json=atomic_payload(saved, "Reviewed"))
    assert published.status_code == 200, published.text
    action_id = published.json()["batch_id"]
    assert action_id not in {imported["batch_id"], draft.json()["batch_id"]}
    current = {row["key"]: row for row in workspace(client, pid, imported["batch_id"])["items"]}
    assert all(row["status"] == "public" for row in current.values())
    assert current["hello"]["published_source_text"] == "Xin chào"
    assert client.get(f"{root}/strings/{outside['id']}").json()["status"] == "draft"

    # The import and the later publication stay separate, separately undoable actions.
    feed = client.get(f"{root}/activities/feed").json()["items"]
    kinds = {card["batch_id"]: card["batch_kind"] for card in feed}
    assert kinds[imported["batch_id"]] == "import"
    assert kinds[action_id] == "batch"
    preview = client.get(f"{root}/activities/batch/{action_id}/revert/preview").json()
    assert preview["can_revert"] and preview["affects_published"]


def test_target_locale_paste_and_excel_import_batches_open_workspace(client):
    from io import BytesIO

    from openpyxl import Workbook

    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    client.post(f"{root}/strings", json={"key": "hello", "source_text": "Xin chào"})
    pasted = paste(client, pid, {"hello": "Hello"}, locale="en")
    batch = workspace(client, pid, pasted["batch_id"])
    assert batch["batch_kind"] == "import"
    row = batch["items"][0]
    assert row["source_text"] == "Xin chào"
    assert {t["locale"]: t["value"] for t in row["translations"]}["en"] == "Hello"

    book = Workbook()
    sheet = book.active
    sheet.title = "common"
    sheet.append(["key", "vi", "en"])
    sheet.append(["bye", "Tạm biệt", "Bye"])
    buf = BytesIO()
    book.save(buf)
    excel = client.post(
        f"{root}/import",
        files={
            "file": (
                "book.xlsx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert excel.status_code == 200, excel.text
    batch = workspace(client, pid, excel.json()["batch_id"])
    assert batch["batch_kind"] == "excel_import"
    assert [row["key"] for row in batch["items"]] == ["bye"]


def test_workspace_rejects_non_import_batches_and_noop_or_dry_run_imports(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    imported = paste(client, pid, {"a": "A"})
    batch = workspace(client, pid, imported["batch_id"])
    published = client.post(
        f"{root}/cli-push-batches/{imported['batch_id']}/publish", json=atomic_payload(batch)
    )
    assert published.status_code == 200, published.text
    publication = published.json()["batch_id"]
    assert client.get(f"{root}/cli-push-batches/{publication}").status_code == 404
    for result in (paste(client, pid, {"a": "A"}), paste(client, pid, {"z": "Z"}, dry_run=True)):
        assert client.get(f"{root}/cli-push-batches/{result['batch_id']}").status_code == 404


def test_stale_import_review_writes_nothing(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    imported = paste(client, pid, {"a": "A"})
    batch = workspace(client, pid, imported["batch_id"])
    row = batch["items"][0]
    client.patch(f"{root}/strings/{row['id']}", json={"translations": {"en": "Concurrent"}})
    publish_strings(client, pid, [row["id"]])
    before = client.get(f"{root}/activities").json()["total"]
    for action in ("draft", "publish"):
        response = client.post(
            f"{root}/cli-push-batches/{imported['batch_id']}/{action}",
            json=atomic_payload(batch),
        )
        assert response.status_code == 409, response.text
    assert client.get(f"{root}/activities").json()["total"] == before
    current = client.get(f"{root}/strings/{row['id']}").json()
    assert current["translations"][0]["value"] == "Concurrent"
