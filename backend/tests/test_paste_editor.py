"""Add many paste: preview rows, then save as draft or publish them in one transaction."""

import pytest

from app.config import settings
from tests.helpers import make_project, publish_strings


def review(client, pid, rows, **extra):
    response = client.post(
        f"/api/projects/{pid}/strings/paste-review", json={"rows": rows, **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()


def save(client, pid, rows, fingerprint, action="draft", **extra):
    return client.post(
        f"/api/projects/{pid}/strings/paste-save",
        json={"rows": rows, "fingerprint": fingerprint, "action": action, **extra},
    )


def by_key(client, pid):
    items = client.get(f"/api/projects/{pid}/strings").json()["items"]
    return {item["key"]: item for item in items}


def values(entry, field="value"):
    return {t["locale"]: t[field] for t in entry["translations"]}


def test_review_projects_creates_and_updates_without_writing(client):
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    client.post(f"{root}/strings", json={"key": "hello", "source_text": "Chào"})
    before = client.get(f"{root}/activities").json()["total"]
    result = review(
        client,
        pid,
        [
            {"key": "hello", "source_text": "Xin chào"},
            {"key": "bye", "source_text": "Tạm biệt", "translations": {"en": "Bye"}},
        ],
    )
    items = {item["key"]: item for item in result["items"]}
    assert items["hello"]["mode"] == "update"
    assert items["hello"]["entry"]["source_text"] == "Xin chào"
    assert items["bye"]["mode"] == "create"
    assert items["bye"]["entry"]["status"] == "draft"
    # Every configured target is listed so review shows locales that would export empty.
    assert values(items["bye"]["entry"]) == {"en": "Bye", "ja": ""}
    assert set(by_key(client, pid)) == {"hello"}
    assert by_key(client, pid)["hello"]["source_text"] == "Chào"
    assert client.get(f"{root}/activities").json()["total"] == before


def test_draft_save_keeps_public_snapshot_and_groups_one_batch(client):
    pid = make_project(client, targets=["en", "ja"], layout="flat")["id"]
    root = f"/api/projects/{pid}"
    hello = client.post(
        f"{root}/strings",
        json={"key": "hello", "source_text": "Chào", "translations": {"en": "Hi"}},
    ).json()
    publish_strings(client, pid, [hello["id"]])
    tag = client.post(f"{root}/tags", json={"name": "paste"}).json()
    rows = [
        {"key": "hello", "source_text": "Xin chào", "translations": {"en": "Hello"}},
        {
            "key": "bye",
            "source_text": "Tạm biệt",
            "translations": {"en": "Bye", "ja": "さようなら"},
        },
    ]
    fingerprint = review(client, pid, rows, tag_ids=[tag["id"]])["fingerprint"]
    # Reviewed edits after the preview save with the same catalog fingerprint.
    rows[1]["translations"]["en"] = "Goodbye"
    rows[1]["translation_scores"] = {"en": 88}
    response = save(client, pid, rows, fingerprint, tag_ids=[tag["id"]])
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["created"], result["updated"], result["published"]) == (1, 1, 0)

    current = by_key(client, pid)
    assert current["hello"]["status"] == "public"
    assert current["hello"]["source_text"] == "Xin chào"
    assert current["hello"]["published_source_text"] == "Chào"
    assert values(current["hello"], "published_value")["en"] == "Hi"
    assert current["bye"]["status"] == "draft"
    assert values(current["bye"]) == {"en": "Goodbye", "ja": "さようなら"}
    assert {t["id"] for t in current["bye"]["tags"]} == {tag["id"]}
    assert {t["id"] for t in current["hello"]["tags"]} == {tag["id"]}
    public = client.get(f"{root}/export", params={"stage": "public", "locale": "en"}).json()
    assert public["en"] == {"hello": "Hi"}

    rows_ = client.get(f"{root}/activities", params={"batch_id": result["batch_id"]}).json()
    assert rows_["total"] == 2
    assert all(row["batch_kind"] == "import" for row in rows_["items"])
    preview = client.get(f"{root}/activities/batch/{result['batch_id']}/revert/preview").json()
    assert preview["can_revert"]


def test_publish_saves_and_promotes_exactly_the_pasted_strings(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    other = client.post(f"{root}/strings", json={"key": "other", "source_text": "Khác"}).json()
    rows = [{"key": "a", "source_text": "A", "translations": {"en": "A en"}}]
    fingerprint = review(client, pid, rows)["fingerprint"]
    response = save(client, pid, rows, fingerprint, action="publish")
    assert response.status_code == 200, response.text
    assert response.json()["published"] == 1
    current = by_key(client, pid)
    assert current["a"]["status"] == "public"
    assert values(current["a"], "published_value") == {"en": "A en"}
    assert client.get(f"{root}/strings/{other['id']}").json()["status"] == "draft"
    feed = client.get(f"{root}/activities/feed").json()["items"]
    card = next(c for c in feed if c["batch_id"] == response.json()["batch_id"])
    assert card["batch_kind"] == "import" and card["is_undoable"]
    assert card["children_count"] == 1


@pytest.mark.parametrize("action", ["draft", "publish"])
def test_stale_catalog_rejects_without_partial_writes(client, action):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    hello = client.post(f"{root}/strings", json={"key": "hello", "source_text": "Chào"}).json()
    rows = [{"key": "hello", "source_text": "Xin chào"}, {"key": "new", "source_text": "Mới"}]
    fingerprint = review(client, pid, rows)["fingerprint"]
    client.patch(f"{root}/strings/{hello['id']}", json={"translations": {"en": "Concurrent"}})
    before = client.get(f"{root}/activities").json()["total"]
    response = save(client, pid, rows, fingerprint, action=action)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "publish_fingerprint_mismatch"
    assert set(by_key(client, pid)) == {"hello"}
    assert by_key(client, pid)["hello"]["source_text"] == "Chào"
    assert client.get(f"{root}/activities").json()["total"] == before


def test_key_created_elsewhere_after_review_is_stale(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    rows = [{"key": "fresh", "source_text": "Mới"}]
    fingerprint = review(client, pid, rows)["fingerprint"]
    client.post(f"{root}/strings", json={"key": "fresh", "source_text": "Khác"})
    assert save(client, pid, rows, fingerprint).status_code == 409
    assert by_key(client, pid)["fresh"]["source_text"] == "Khác"


def test_target_language_paste_keeps_source_and_creates_with_key(client):
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    client.post(f"{root}/strings", json={"key": "hello", "source_text": "Xin chào"})
    rows = [
        {"key": "hello", "translations": {"en": "Hello"}},
        {"key": "only.en", "translations": {"en": "Only English"}},
    ]
    result = review(client, pid, rows)
    items = {item["key"]: item for item in result["items"]}
    assert items["hello"]["entry"]["source_text"] == "Xin chào"
    assert items["only.en"]["entry"]["source_text"] == "only.en"
    assert save(client, pid, rows, result["fingerprint"]).status_code == 200
    current = by_key(client, pid)
    assert current["hello"]["source_text"] == "Xin chào"
    assert values(current["hello"])["en"] == "Hello"
    assert current["only.en"]["source_text"] == "only.en"


def test_publication_failure_rolls_back_every_row(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    owner = client.post(
        f"{root}/strings", json={"key": "conflict", "source_text": "Original", "status": "public"}
    ).json()
    client.patch(f"{root}/strings/{owner['id']}", json={"key": "renamed"})
    rows = [{"key": "conflict", "source_text": "New"}, {"key": "other", "source_text": "O"}]
    fingerprint = review(client, pid, rows)["fingerprint"]
    before = client.get(f"{root}/activities").json()["total"]
    response = save(client, pid, rows, fingerprint, action="publish")
    assert response.status_code == 409, response.text
    assert set(by_key(client, pid)) == {"renamed"}
    assert client.get(f"{root}/activities").json()["total"] == before


def test_duplicate_keys_match_only_the_chosen_module(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    assert client.patch(root, json={"allow_duplicate_keys": True}).status_code == 200
    auth, home = (
        client.post(f"{root}/modules", json={"slug": slug, "name": slug}).json()["id"]
        for slug in ("auth", "home")
    )
    owner = client.post(
        f"{root}/strings", json={"key": "title", "module_id": auth, "source_text": "Auth"}
    ).json()
    rows = [{"key": "title", "source_text": "Home"}]
    result = review(client, pid, rows, module_id=home)
    assert result["items"][0]["mode"] == "create"
    response = save(client, pid, rows, result["fingerprint"], module_id=home)
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1
    assert client.get(f"{root}/strings/{owner['id']}").json()["source_text"] == "Auth"
    titles = [s for s in client.get(f"{root}/strings").json()["items"] if s["key"] == "title"]
    assert {(s["module_id"], s["source_text"]) for s in titles} == {(auth, "Auth"), (home, "Home")}
    # The same paste into the owner's module updates it in place.
    result = review(client, pid, [{"key": "title", "source_text": "Auth 2"}], module_id=auth)
    assert result["items"][0]["mode"] == "update"


def test_request_validation(client):
    pid = make_project(client)["id"]
    url = f"/api/projects/{pid}/strings/paste-review"
    assert client.post(url, json={"rows": []}).status_code == 422
    too_many = [{"key": f"k{i}", "source_text": "S"} for i in range(101)]
    assert client.post(url, json={"rows": too_many}).status_code == 422
    dupes = [{"key": "k", "source_text": "A"}, {"key": "k", "source_text": "B"}]
    assert client.post(url, json={"rows": dupes}).status_code == 422
    bad_locale = [{"key": "k", "source_text": "A", "translations": {"fr": "x"}}]
    assert client.post(url, json={"rows": bad_locale}).status_code == 400


def test_translate_preview_batch_translates_unsaved_rows(client, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    before = client.get(f"{root}/activities").json()["total"]
    response = client.post(
        f"{root}/translate/preview-batch",
        json={
            "items": [
                {"id": "a", "source_text": "Xin chào", "locales": ["en", "ja"]},
                {"id": "b", "source_text": "Tạm biệt", "locales": ["ja"]},
            ]
        },
    )
    assert response.status_code == 200, response.text
    items = {item["id"]: item for item in response.json()["items"]}
    assert set(items["a"]["translations"]) == {"en", "ja"}
    assert set(items["b"]["translations"]) == {"ja"}
    assert client.get(f"{root}/strings").json()["total"] == 0
    assert client.get(f"{root}/activities").json()["total"] == before
