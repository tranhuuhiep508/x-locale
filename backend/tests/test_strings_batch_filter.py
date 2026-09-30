"""Catalog membership for an activity batch (XLOCALE-34)."""

from __future__ import annotations

import uuid

import pytest

from tests.helpers import make_project, preview_publish, publish_strings


def _keys(response) -> list[str]:
    assert response.status_code == 200, response.text
    body = response.json()
    return [item["key"] for item in body["items"]]


def _import_pair(client, pid: str) -> str:
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {"login": "Đăng nhập", "welcome": "Chào mừng"}},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == 2
    return imported.json()["batch_id"]


def test_list_strings_by_batch_id(client):
    project = make_project(client, "Batch Filter")
    pid = project["id"]
    batch_id = _import_pair(client, pid)

    listed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    assert listed.json()["total"] == 2
    assert _keys(listed) == ["login", "welcome"]

    # A later edit is a different batch and must not drop or duplicate members.
    client.patch(
        f"/api/projects/{pid}/strings/{listed.json()['items'][0]['id']}",
        json={"source_text": "Đăng nhập lại"},
    )
    again = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    assert again.json()["total"] == 2
    assert _keys(again) == ["login", "welcome"]


def test_unknown_or_other_project_batch_is_empty(client):
    project = make_project(client, "Batch Owner")
    other = make_project(client, "Other Project")
    batch_id = _import_pair(client, project["id"])

    missing = client.get(
        f"/api/projects/{project['id']}/strings",
        params={"batch_id": str(uuid.uuid4())},
    )
    assert missing.status_code == 200
    assert missing.json()["total"] == 0
    assert missing.json()["items"] == []

    foreign = client.get(
        f"/api/projects/{other['id']}/strings",
        params={"batch_id": batch_id},
    )
    assert foreign.status_code == 200
    assert foreign.json()["total"] == 0
    assert foreign.json()["items"] == []

    invalid = client.get(
        f"/api/projects/{project['id']}/strings",
        params={"batch_id": "not-a-uuid"},
    )
    assert invalid.status_code == 422


def test_batch_filter_includes_soft_deleted_and_pending_delete(client):
    project = make_project(client, "Batch Tombstones")
    pid = project["id"]
    batch_id = _import_pair(client, pid)
    rows = {
        item["key"]: item
        for item in client.get(f"/api/projects/{pid}/strings", params={"page_size": 50}).json()["items"]
    }

    deleted = client.delete(f"/api/projects/{pid}/strings/{rows['login']['id']}")
    assert deleted.status_code == 204

    publish_strings(client, pid, [rows["welcome"]["id"]])
    queued = client.delete(f"/api/projects/{pid}/strings/{rows['welcome']['id']}")
    assert queued.status_code == 204

    live = client.get(f"/api/projects/{pid}/strings")
    assert _keys(live) == ["welcome"]
    assert live.json()["items"][0]["pending_delete"] is True

    reviewed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    assert reviewed.json()["total"] == 2
    by_key = {item["key"]: item for item in reviewed.json()["items"]}
    assert by_key["login"]["deleted_at"]
    assert by_key["welcome"]["pending_delete"] is True

    only_live = client.get(
        f"/api/projects/{pid}/strings",
        params={"batch_id": batch_id, "deleted": False},
    )
    assert _keys(only_live) == ["welcome"]

    only_deleted = client.get(
        f"/api/projects/{pid}/strings",
        params={"batch_id": batch_id, "deleted": True},
    )
    assert _keys(only_deleted) == ["login"]

    not_pending = client.get(
        f"/api/projects/{pid}/strings",
        params={"batch_id": batch_id, "pending_delete": False},
    )
    assert _keys(not_pending) == ["login"]


def test_batch_id_ands_with_module_tag_and_q(client):
    project = make_project(client, "Batch And")
    pid = project["id"]
    auth = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "auth", "name": "Auth"},
    ).json()
    home = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "home", "name": "Home"},
    ).json()
    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "priority", "color": "#f00"},
    ).json()
    batch_id = _import_pair(client, pid)
    rows = {
        item["key"]: item
        for item in client.get(
            f"/api/projects/{pid}/strings",
            params={"batch_id": batch_id},
        ).json()["items"]
    }
    client.patch(
        f"/api/projects/{pid}/strings/{rows['login']['id']}",
        json={"module_id": auth["id"], "tag_ids": [tag["id"]]},
    )
    client.patch(
        f"/api/projects/{pid}/strings/{rows['welcome']['id']}",
        json={"module_id": home["id"]},
    )

    by_module = client.get(
        f"/api/projects/{pid}/strings",
        params={"batch_id": batch_id, "module": auth["id"]},
    )
    assert _keys(by_module) == ["login"]

    by_tag = client.get(
        f"/api/projects/{pid}/strings",
        params={"batch_id": batch_id, "tag": tag["id"]},
    )
    assert _keys(by_tag) == ["login"]

    by_q = client.get(
        f"/api/projects/{pid}/strings",
        params={"batch_id": batch_id, "q": "welcome"},
    )
    assert _keys(by_q) == ["welcome"]

    # Advanced conflict pairs (module + unassigned_module, etc.) are not on master yet.
    # When they land in string_query they still 400 before this membership clause.


def test_publish_preview_uses_the_same_batch_membership(client):
    project = make_project(client, "Batch Preview")
    pid = project["id"]
    batch_id = _import_pair(client, pid)
    rows = {
        item["key"]: item
        for item in client.get(f"/api/projects/{pid}/strings").json()["items"]
    }
    client.delete(f"/api/projects/{pid}/strings/{rows['login']['id']}")

    listed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    preview = preview_publish(client, pid, filt={"batch_id": batch_id})
    assert {item["id"] for item in preview["items"]} == {
        item["id"] for item in listed.json()["items"]
    }
    assert {item["key"] for item in preview["items"]} == {"login", "welcome"}

    narrowed = preview_publish(
        client,
        pid,
        filt={"batch_id": batch_id, "q": "welcome"},
    )
    assert [item["key"] for item in narrowed["items"]] == ["welcome"]


@pytest.mark.parametrize("use_filter", [False, True])
def test_discard_delete_in_mixed_batch_keeps_tombstones_hidden(client, use_filter):
    project = make_project(client, "Batch Discard Delete", layout="flat")
    pid = project["id"]
    imported = client.post(
        f"/api/projects/{pid}/strings/import",
        json={
            "strings": {
                "live": "Live member",
                "pending": "Pending removal",
                "draft_deleted": "Deleted draft",
                "public_deleted": "Published removal",
            }
        },
    )
    assert imported.status_code == 200, imported.text
    batch_id = imported.json()["batch_id"]
    listed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    assert listed.status_code == 200, listed.text
    rows = {item["key"]: item for item in listed.json()["items"]}

    publish_strings(client, pid, [rows["pending"]["id"], rows["public_deleted"]["id"]])
    for key in ("pending", "draft_deleted", "public_deleted"):
        deleted = client.delete(f"/api/projects/{pid}/strings/{rows[key]['id']}")
        assert deleted.status_code == 204, deleted.text
    publish_strings(client, pid, [rows["public_deleted"]["id"]])

    reviewed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    assert reviewed.status_code == 200, reviewed.text
    before = {item["key"]: item for item in reviewed.json()["items"]}
    assert len(before) == 4
    assert before["pending"]["pending_delete"] is True
    assert before["draft_deleted"]["deleted_at"] is not None
    assert before["public_deleted"]["deleted_at"] is not None
    assert before["public_deleted"]["status"] == "public"

    selection = (
        {"filter": {"batch_id": batch_id}}
        if use_filter
        else {"string_ids": [item["id"] for item in before.values()]}
    )
    discarded = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "discard_delete", **selection},
    )
    assert discarded.status_code == 200, discarded.text
    assert discarded.json()["affected"] == 1

    reviewed = client.get(f"/api/projects/{pid}/strings", params={"batch_id": batch_id})
    assert reviewed.status_code == 200, reviewed.text
    after = {item["key"]: item for item in reviewed.json()["items"]}
    assert after["pending"]["pending_delete"] is False
    for key in ("live", "draft_deleted", "public_deleted"):
        assert after[key] == before[key]

    live = client.get(f"/api/projects/{pid}/strings")
    assert _keys(live) == ["live", "pending"]
    exported = client.get(f"/api/projects/{pid}/export", params={"stage": "public"})
    assert exported.status_code == 200, exported.text
    assert exported.json()["vi"] == {"pending": "Pending removal"}

    repeated = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "discard_delete", **selection},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["affected"] == 0

    # Explicit Restore still revives tombstones when the user requests it.
    restored = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "restore",
            "string_ids": [before[key]["id"] for key in ("draft_deleted", "public_deleted")],
        },
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["affected"] == 2
    live = client.get(f"/api/projects/{pid}/strings")
    assert _keys(live) == ["draft_deleted", "live", "pending", "public_deleted"]
