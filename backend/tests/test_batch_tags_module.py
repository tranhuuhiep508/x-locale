"""XLOCALE-31: batch move_module, add_tags, and remove_tags."""

from __future__ import annotations

import uuid

from tests.helpers import make_project, publish_strings


def _modules_and_string(client, pid):
    m1 = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "auth", "name": "Auth"}
    ).json()
    m2 = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "home", "name": "Home"}
    ).json()
    s1 = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "login", "source_text": "Đăng nhập", "module_id": m1["id"]},
    ).json()
    s2 = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "welcome", "source_text": "Chào", "module_id": m1["id"]},
    ).json()
    return m1, m2, s1, s2


def test_batch_move_module_updates_module_id(client):
    project = make_project(client, "Batch Move Module")
    pid = project["id"]
    m1, m2, s1, s2 = _modules_and_string(client, pid)

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [s1["id"], s2["id"]],
            "payload": {"module_id": m2["id"]},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 2

    for sid in (s1["id"], s2["id"]):
        row = client.get(f"/api/projects/{pid}/strings/{sid}").json()
        assert row["module_id"] == m2["id"]
        assert row["module_slug"] == "home"


def test_batch_add_tags_merges_and_is_idempotent(client):
    project = make_project(client, "Batch Add Tags")
    pid = project["id"]
    _, _, s1, s2 = _modules_and_string(client, pid)
    t1 = client.post(
        f"/api/projects/{pid}/tags", json={"name": "prio", "color": "#f00"}
    ).json()
    t2 = client.post(
        f"/api/projects/{pid}/tags", json={"name": "ui", "color": "#0f0"}
    ).json()

    client.patch(
        f"/api/projects/{pid}/strings/{s1['id']}",
        json={"tag_ids": [t1["id"]]},
    )

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "add_tags",
            "string_ids": [s1["id"], s2["id"]],
            "payload": {"tag_ids": [t1["id"], t2["id"]]},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] >= 2

    row1 = client.get(f"/api/projects/{pid}/strings/{s1['id']}").json()
    names1 = {t["name"] for t in row1["tags"]}
    assert names1 == {"prio", "ui"}

    again = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "add_tags",
            "string_ids": [s1["id"]],
            "payload": {"tag_ids": [t1["id"], t2["id"]]},
        },
    )
    assert again.status_code == 200, again.text
    assert again.json()["affected"] == 0


def test_batch_remove_tags_only_named_tags_unknown_is_noop(client):
    project = make_project(client, "Batch Remove Tags")
    pid = project["id"]
    _, _, s1, _ = _modules_and_string(client, pid)
    keep = client.post(
        f"/api/projects/{pid}/tags", json={"name": "keep", "color": "#111"}
    ).json()
    drop = client.post(
        f"/api/projects/{pid}/tags", json={"name": "drop", "color": "#222"}
    ).json()
    client.patch(
        f"/api/projects/{pid}/strings/{s1['id']}",
        json={"tag_ids": [keep["id"], drop["id"]]},
    )

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "remove_tags",
            "string_ids": [s1["id"]],
            "payload": {"tag_ids": [drop["id"]]},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1
    names = {t["name"] for t in client.get(f"/api/projects/{pid}/strings/{s1['id']}").json()["tags"]}
    assert names == {"keep"}

    unknown = str(uuid.uuid4())
    noop = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "remove_tags",
            "string_ids": [s1["id"]],
            "payload": {"tag_ids": [unknown]},
        },
    )
    assert noop.status_code == 200, noop.text
    assert noop.json()["affected"] == 0
    names = {t["name"] for t in client.get(f"/api/projects/{pid}/strings/{s1['id']}").json()["tags"]}
    assert names == {"keep"}


def test_batch_move_module_soft_deleted_still_updates_or_skips(client):
    """Document behavior: move_module applies to tombstones when selected by id."""
    project = make_project(client, "Batch Move Deleted")
    pid = project["id"]
    m1, m2, s1, _ = _modules_and_string(client, pid)
    client.delete(f"/api/projects/{pid}/strings/{s1['id']}")

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [s1["id"]],
            "payload": {"module_id": m2["id"]},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1
    tomb = client.get(f"/api/projects/{pid}/strings/{s1['id']}").json()
    assert tomb["deleted_at"] is not None
    assert tomb["module_id"] == m2["id"]


def test_batch_add_tags_skips_unknown_project_tag_ids(client):
    project = make_project(client, "Batch Add Unknown Tag")
    pid = project["id"]
    _, _, s1, _ = _modules_and_string(client, pid)
    real = client.post(
        f"/api/projects/{pid}/tags", json={"name": "real", "color": "#abc"}
    ).json()
    bogus = str(uuid.uuid4())

    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "add_tags",
            "string_ids": [s1["id"]],
            "payload": {"tag_ids": [real["id"], bogus]},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["affected"] == 1
    names = {t["name"] for t in client.get(f"/api/projects/{pid}/strings/{s1['id']}").json()["tags"]}
    assert names == {"real"}


def test_batch_move_module_empty_selection(client):
    project = make_project(client, "Batch Move Empty")
    pid = project["id"]
    r = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "move_module", "string_ids": [], "payload": {"module_id": None}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["affected"] == 0
    assert body["batch_id"]
