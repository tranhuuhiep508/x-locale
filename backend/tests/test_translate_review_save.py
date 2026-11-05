"""AI review: save reviewed rows as draft, or publish exactly the reviewed strings."""

import pytest

from tests.helpers import make_project, publish_strings


@pytest.fixture
def setup(client):
    project = make_project(client, "Review save", targets=["en", "ja", "fr"])
    root = f"/api/projects/{project['id']}"
    public = client.post(
        f"{root}/strings",
        json={"key": "public", "source_text": "Lưu", "translations": {"en": "Save"}},
    ).json()
    publish_strings(client, project["id"], [public["id"]])
    # Pending working-copy change in another locale, not part of the AI review.
    client.patch(f"{root}/strings/{public['id']}", json={"translations": {"fr": "Sauver"}})
    draft = client.post(f"{root}/strings", json={"key": "draft", "source_text": "Hủy"}).json()
    other = client.post(f"{root}/strings", json={"key": "other", "source_text": "Khác"}).json()
    return root, public, draft, other


def items(public, draft):
    return [
        {
            "string_id": public["id"],
            "expected_source_text": "Lưu",
            "translations": {"ja": "保存"},
            "scores": {"ja": 90},
        },
        {
            "string_id": draft["id"],
            "expected_source_text": "Hủy",
            "translations": {"en": "Cancel", "ja": ""},
            "scores": {"en": 80},
        },
    ]


def total_activities(client, root):
    return client.get(f"{root}/activities").json()["total"]


def get(client, root, entry):
    row = client.get(f"{root}/strings/{entry['id']}").json()
    row["by_locale"] = {t["locale"]: t for t in row["translations"]}
    return row


def test_review_is_read_only_and_shows_full_public_state(client, setup):
    root, public, draft, _ = setup
    before = total_activities(client, root)
    response = client.post(f"{root}/translate/review", json={"items": items(public, draft)})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["fingerprint"]
    by_key = {row["key"]: row for row in body["items"]}
    assert set(by_key) == {"public", "draft"}
    locales = {t["locale"]: t for t in by_key["public"]["translations"]}
    # Pending edits in other locales of the same string are visible before publication.
    assert locales["fr"]["value"] == "Sauver" and locales["fr"]["published_value"] in (None, "")
    assert locales["ja"]["value"] == "保存"
    assert by_key["public"]["has_unpublished_changes"]
    # Missing configured locales are materialized empty so the consequence is visible.
    draft_locales = {t["locale"]: t["value"] for t in by_key["draft"]["translations"]}
    assert draft_locales == {"en": "Cancel", "fr": "", "ja": ""}
    assert total_activities(client, root) == before
    assert get(client, root, public)["by_locale"].get("ja", {"value": ""})["value"] == ""


def test_save_as_draft_writes_working_copy_only(client, setup):
    root, public, draft, other = setup
    response = client.post(
        f"{root}/translate/save", json={"action": "draft", "items": items(public, draft)}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["translated_count"], result["string_count"], result["published_count"]) == (
        2,
        2,
        0,
    )
    saved_public = get(client, root, public)
    assert saved_public["status"] == "public"
    assert saved_public["by_locale"]["ja"]["value"] == "保存"
    assert saved_public["by_locale"]["ja"]["confidence"] == 90
    assert saved_public["by_locale"]["en"]["published_value"] == "Save"
    assert not saved_public["by_locale"]["ja"]["published_value"]
    saved_draft = get(client, root, draft)
    assert saved_draft["status"] == "draft"
    assert saved_draft["by_locale"]["en"]["value"] == "Cancel"
    assert get(client, root, other)["translations"] == [] or all(
        not t["value"] for t in get(client, root, other)["translations"]
    )
    rows = client.get(f"{root}/activities", params={"batch_id": result["batch_id"]}).json()
    assert rows["total"] == 2
    assert {row["event_type"] for row in rows["items"]} == {"string.saved_draft"}
    assert all(row["batch_kind"] == "translate" for row in rows["items"])


def test_publish_saves_and_publishes_only_reviewed_strings(client, setup):
    root, public, draft, other = setup
    review = client.post(f"{root}/translate/review", json={"items": items(public, draft)}).json()
    response = client.post(
        f"{root}/translate/save",
        json={
            "action": "publish",
            "items": items(public, draft),
            "fingerprint": review["fingerprint"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["published_count"] == 2
    saved_public = get(client, root, public)
    # Publication is per string: the pending fr edit is published with the reviewed ja value.
    assert saved_public["by_locale"]["ja"]["published_value"] == "保存"
    assert saved_public["by_locale"]["fr"]["published_value"] == "Sauver"
    assert not saved_public["has_unpublished_changes"]
    saved_draft = get(client, root, draft)
    assert saved_draft["status"] == "public"
    assert saved_draft["by_locale"]["en"]["published_value"] == "Cancel"
    assert get(client, root, other)["status"] == "draft"
    batch_id = response.json()["batch_id"]
    rows = client.get(f"{root}/activities", params={"batch_id": batch_id}).json()["items"]
    assert {row["event_type"] for row in rows} == {"string.saved_and_published"}
    card = next(
        item
        for item in client.get(f"{root}/activities/feed").json()["items"]
        if item["batch_id"] == batch_id
    )
    assert card["summary"].startswith("Saved and published 2 strings")
    assert card["is_undoable"]
    reverted = client.post(f"{root}/activities/batch/{batch_id}/revert")
    assert reverted.status_code == 200, reverted.text
    undone = get(client, root, draft)
    assert undone["status"] == "draft" and not undone["by_locale"].get("en", {}).get("value")
    undone_public = get(client, root, public)
    assert undone_public["by_locale"]["en"]["published_value"] == "Save"
    assert not undone_public["by_locale"].get("ja", {}).get("published_value")


@pytest.mark.parametrize(
    "change",
    [
        {"translations": {"fr": "Changed"}},  # other locale on the same string
        {"key": "renamed"},  # public export identity
    ],
)
def test_stale_review_rejects_publication_without_writes(client, setup, change):
    root, public, draft, _ = setup
    review = client.post(f"{root}/translate/review", json={"items": items(public, draft)}).json()
    client.patch(f"{root}/strings/{public['id']}", json=change)
    before = total_activities(client, root)
    response = client.post(
        f"{root}/translate/save",
        json={
            "action": "publish",
            "items": items(public, draft),
            "fingerprint": review["fingerprint"],
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "publish_fingerprint_mismatch"
    assert total_activities(client, root) == before
    assert get(client, root, draft)["status"] == "draft"
    assert not get(client, root, draft)["by_locale"].get("en", {}).get("value")


def test_changed_review_values_or_membership_need_a_new_review(client, setup):
    root, public, draft, other = setup
    reviewed = items(public, draft)
    review = client.post(f"{root}/translate/review", json={"items": reviewed}).json()
    edited = items(public, draft)
    edited[0]["translations"]["ja"] = "Changed"
    expanded = [
        *items(public, draft),
        {"string_id": other["id"], "expected_source_text": "Khác", "translations": {"en": "Other"}},
    ]
    for body in (edited, expanded, reviewed[:1]):
        response = client.post(
            f"{root}/translate/save",
            json={"action": "publish", "items": body, "fingerprint": review["fingerprint"]},
        )
        assert response.status_code == 409
    assert get(client, root, other)["status"] == "draft"


def test_publish_requires_fingerprint(client, setup):
    root, public, draft, _ = setup
    response = client.post(
        f"{root}/translate/save", json={"action": "publish", "items": items(public, draft)}
    )
    assert response.status_code == 400


@pytest.mark.parametrize("action", ["draft", "publish"])
def test_cell_filled_elsewhere_rejects_whole_save(client, setup, action):
    root, public, draft, _ = setup
    review = client.post(f"{root}/translate/review", json={"items": items(public, draft)}).json()
    client.patch(f"{root}/strings/{draft['id']}", json={"translations": {"en": "Abort"}})
    before = total_activities(client, root)
    response = client.post(
        f"{root}/translate/save",
        json={
            "action": action,
            "items": items(public, draft),
            "fingerprint": review["fingerprint"],
        },
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "stale_translation_value"
    assert detail["conflicts"] == [
        {"string_id": draft["id"], "key": "draft", "locale": "en", "value": "Abort"}
    ]
    assert total_activities(client, root) == before
    assert not get(client, root, public)["by_locale"].get("ja", {}).get("value")


def test_description_is_not_part_of_review(client, setup):
    root, public, draft, _ = setup
    body = items(public, draft)
    review = client.post(f"{root}/translate/review", json={"items": body}).json()
    # Descriptions never publish, so editing one elsewhere does not invalidate the review.
    client.patch(f"{root}/strings/{draft['id']}", json={"description": "Other"})
    response = client.post(
        f"{root}/translate/save",
        json={"action": "publish", "items": body, "fingerprint": review["fingerprint"]},
    )
    assert response.status_code == 200, response.text
    assert get(client, root, draft)["description"] == "Other"
    with_description = [{**body[0], "description": "Button", "expected_description": None}]
    for path, extra in (("review", {}), ("save", {"action": "draft"})):
        response = client.post(
            f"{root}/translate/{path}", json={"items": with_description, **extra}
        )
        assert response.status_code == 422


def test_stale_source_rejects_draft_save(client, setup):
    root, public, draft, _ = setup
    client.patch(f"{root}/strings/{public['id']}", json={"source_text": "Lưu lại"})
    response = client.post(
        f"{root}/translate/save", json={"action": "draft", "items": items(public, draft)}
    )
    assert response.json()["detail"]["code"] == "stale_translation_source"
    assert not get(client, root, public)["by_locale"].get("ja", {}).get("value")


def test_key_collision_rolls_back_content_and_audit(client, setup):
    root, public, draft, _ = setup
    # Rename the published string away, then rename the draft onto its public key.
    client.patch(f"{root}/strings/{public['id']}", json={"key": "renamed"})
    client.patch(f"{root}/strings/{draft['id']}", json={"key": "public"})
    body = [items(public, draft)[1]]
    review = client.post(f"{root}/translate/review", json={"items": body}).json()
    before = total_activities(client, root)
    response = client.post(
        f"{root}/translate/save",
        json={"action": "publish", "items": body, "fingerprint": review["fingerprint"]},
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "published_key_conflict"
    assert total_activities(client, root) == before
    saved = get(client, root, draft)
    assert saved["status"] == "draft" and saved["description"] is None
    assert not saved["by_locale"].get("en", {}).get("value")


def test_pending_delete_and_deleted_strings(client, setup):
    root, public, draft, _ = setup
    body = [items(public, draft)[0]]
    review = client.post(f"{root}/translate/review", json={"items": body}).json()
    client.delete(f"{root}/strings/{public['id']}")  # published: queues pending_delete
    # The review step names the blocked key, so the user never sees a doomed preview.
    response = client.post(f"{root}/translate/review", json={"items": body})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "pending_delete_in_review"
    assert "public" in response.json()["detail"]["message"]
    # A review taken before the removal was queued is stale; the UI then re-reviews.
    response = client.post(
        f"{root}/translate/save",
        json={"action": "publish", "items": body, "fingerprint": review["fingerprint"]},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "publish_fingerprint_mismatch"
    client.delete(f"{root}/strings/{draft['id']}")  # never published: deleted now
    response = client.post(
        f"{root}/translate/save", json={"action": "draft", "items": [items(public, draft)[1]]}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "stale_translation_review"


def test_rejects_duplicates_unknown_locales_and_oversized_batches(client, setup):
    root, public, draft, _ = setup
    first = items(public, draft)[0]
    assert (
        client.post(
            f"{root}/translate/save", json={"action": "draft", "items": [first, first]}
        ).status_code
        == 400
    )
    bad = {**first, "translations": {"de": "Speichern"}}
    assert (
        client.post(f"{root}/translate/save", json={"action": "draft", "items": [bad]}).status_code
        == 400
    )
    assert (
        client.post(
            f"{root}/translate/save", json={"action": "draft", "items": [first] * 101}
        ).status_code
        == 422
    )
