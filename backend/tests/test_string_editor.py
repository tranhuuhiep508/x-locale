"""The editor reviews unsaved content and commits a whole action atomically."""

import pytest


@pytest.fixture()
def editor(client):
    project = client.post(
        "/api/projects",
        json={
            "name": "Editor review",
            "target_languages": ["en", "fr"],
        },
    ).json()
    root = f"/api/projects/{project['id']}"
    values = {
        "key": "greeting",
        "source_text": "Xin chào",
        "translations": {"en": "Welcome", "fr": "Bienvenue"},
    }
    return root, {"mode": "create", "values": values}


def preview(client, root, proposal):
    result = client.post(root + "/strings/editor-preview", json={"proposal": proposal})
    assert result.status_code == 200, result.text
    return result.json()


def save(client, root, proposal, *, publish=False):
    body = {"proposal": proposal, "action": "publish" if publish else "save_draft"}
    if publish:
        body["fingerprint"] = preview(client, root, proposal)["fingerprint"]
    return client.post(root + "/strings/editor-save", json=body)


def update(entry, **values):
    expected = {}
    for field, value in values.items():
        if field in {"translations", "translation_scores"}:
            column = "value" if field == "translations" else "confidence"
            existing = {t["locale"]: t[column] for t in entry["translations"]}
            expected[field] = {
                locale: existing.get(locale, "" if field == "translations" else None)
                for locale in value
            }
        else:
            expected[field] = entry[field]
    if "translations" in values:
        expected["source_text"] = entry["source_text"]
    return {"mode": "update", "string_id": entry["id"], "values": {**values, "expected": expected}}


def activities(client, root, string_id=None):
    params = {"string_id": string_id} if string_id else {}
    return client.get(root + "/activities", params=params).json()["items"]


def test_preview_does_not_create_content_or_activity(client, editor):
    root, proposal = editor
    result = preview(client, root, proposal)
    assert result["entry"]["translations"][0]["value"] == "Welcome"
    assert client.get(root + "/strings").json()["total"] == 0
    assert activities(client, root) == []
    assert result["fingerprint"] == preview(client, root, proposal)["fingerprint"]


def test_create_draft_then_publish_and_edit_public_working_copy(client, editor):
    root, proposal = editor
    draft = save(client, root, proposal).json()
    assert draft["status"] == "draft"
    assert draft["published_key"] is None
    published = save(client, root, update(draft), publish=True).json()
    assert published["status"] == "public"
    changed = save(client, root, update(published, translations={"en": "Good morning"})).json()
    en = next(t for t in changed["translations"] if t["locale"] == "en")
    assert changed["status"] == "public"
    assert en["value"] == "Good morning"
    assert en["published_value"] == "Welcome"
    assert activities(client, root)[0]["event_type"] == "string.saved_draft"


def test_combined_save_is_single_restorable_activity(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    proposal = update(entry, translations={"en": "Good morning"}, description="New context")
    before = len(activities(client, root))
    result = save(client, root, proposal, publish=True)
    assert result.status_code == 200, result.text
    records = activities(client, root)
    assert len(records) == before + 1
    assert records[0]["event_type"] == "string.saved_and_published"
    assert records[0]["is_history_restorable"] is True
    detail = client.get(root + "/activities/" + records[0]["id"]).json()
    assert {c["scope"] for c in detail["changed"]} == {"draft", "published"}


def test_projection_merges_unedited_locales_and_keeps_metadata(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    edit = update(entry, translations={"en": "Hello"})
    client.patch(root + "/strings/" + entry["id"], json={"translations": {"fr": "Bonjour"}})
    result = preview(client, root, edit)["entry"]
    assert {t["locale"]: t["value"] for t in result["translations"]} == {
        "en": "Hello",
        "fr": "Bonjour",
    }
    assert (
        next(t for t in result["translations"] if t["locale"] == "fr")["published_value"]
        == "Bienvenue"
    )


@pytest.mark.parametrize(
    "change",
    [
        {"translations": {"fr": "Bonjour"}},
        {"description": "Other context"},
        {"status": "draft"},
        {"source_text": "Different source"},
    ],
)
def test_changed_state_invalidates_review_without_partial_save(client, editor, change):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    proposal = update(entry, description="My context")
    reviewed = preview(client, root, proposal)
    assert client.patch(root + "/strings/" + entry["id"], json=change).status_code == 200
    count = len(activities(client, root))
    response = client.post(
        root + "/strings/editor-save",
        json={
            "proposal": proposal,
            "action": "publish",
            "fingerprint": reviewed["fingerprint"],
        },
    )
    assert response.status_code == 409, response.text
    assert len(activities(client, root)) == count
    saved = client.get(root + "/strings/" + entry["id"]).json()
    assert saved["description"] != "My context"


def test_changed_proposal_invalidates_review(client, editor):
    root, proposal = editor
    reviewed = preview(client, root, proposal)
    proposal["values"]["translations"]["en"] = "Unreviewed"
    response = client.post(
        root + "/strings/editor-save",
        json={
            "proposal": proposal,
            "action": "publish",
            "fingerprint": reviewed["fingerprint"],
        },
    )
    assert response.status_code == 409
    assert activities(client, root) == []


def test_noop_and_metadata_only_publication_do_not_write(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    count = len(activities(client, root))
    assert save(client, root, update(entry), publish=True).status_code == 409
    assert save(client, root, update(entry, description="Context"), publish=True).status_code == 409
    assert len(activities(client, root)) == count
    assert save(client, root, update(entry)).status_code == 200
    assert len(activities(client, root)) == count


@pytest.mark.parametrize("mode", ["create", "update"])
def test_published_collision_rolls_back_content_and_audit(client, editor, mode):
    root, proposal = editor
    first = save(client, root, proposal, publish=True).json()
    client.patch(root + "/strings/" + first["id"], json={"key": "renamed"})
    if mode == "update":
        candidate = save(
            client, root, {**proposal, "values": {**proposal["values"], "key": "candidate"}}
        ).json()
        proposal = update(candidate, key="greeting", source_text="Must roll back")
    count = len(activities(client, root))
    response = save(client, root, proposal, publish=True)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "published_key_conflict"
    assert response.json()["detail"]["key"] == "greeting"
    assert client.get(root + "/strings").json()["total"] == (1 if mode == "create" else 2)
    if mode == "update":
        current = client.get(root + "/strings/" + candidate["id"]).json()
        assert current["key"] == "candidate"
        assert current["source_text"] == candidate["source_text"]
    assert len(activities(client, root)) == count


def test_deleted_and_pending_removal_cannot_publish(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    url = root + "/strings/" + entry["id"]
    assert client.delete(url).status_code == 204
    assert save(client, root, update(entry), publish=True).status_code == 409
    pending = client.get(url).json()
    assert save(client, root, update(pending, description="Still working")).status_code == 200
    assert client.get(url).json()["pending_delete"] is True
    removal = client.post(
        root + "/strings/publish-preview", json={"string_ids": [entry["id"]]}
    ).json()
    client.post(
        root + "/strings/batch",
        json={
            "action": "publish",
            "string_ids": [entry["id"]],
            "fingerprint": removal["fingerprint"],
        },
    )
    response = client.post(root + "/strings/editor-preview", json={"proposal": update(entry)})
    assert response.status_code == 409


@pytest.mark.parametrize("field", ["status", "pending_delete", "deleted_at"])
def test_editor_rejects_lifecycle_fields(client, editor, field):
    root, proposal = editor
    proposal["values"][field] = "public"
    assert (
        client.post(root + "/strings/editor-preview", json={"proposal": proposal}).status_code
        == 422
    )


def test_publication_requires_fingerprint_and_update_requires_expected(client, editor):
    root, proposal = editor
    assert (
        client.post(
            root + "/strings/editor-save",
            json={
                "proposal": proposal,
                "action": "publish",
            },
        ).status_code
        == 422
    )
    entry = save(client, root, proposal).json()
    assert (
        client.post(
            root + "/strings/editor-save",
            json={
                "proposal": {
                    "mode": "update",
                    "string_id": entry["id"],
                    "values": {"source_text": "Other"},
                },
                "action": "save_draft",
            },
        ).status_code
        == 422
    )


def test_history_restore_changes_working_copy_and_undo_restores_complete_action(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    welcome = save(client, root, update(entry, source_text="Welcome"), publish=True).json()
    version = activities(client, root)[0]["id"]
    morning = save(client, root, update(welcome, source_text="Good morning"), publish=True).json()
    operation = activities(client, root)[0]["id"]
    undo_preview = client.get(root + "/activities/" + operation + "/revert/preview").json()
    assert undo_preview["affects_published"] is True
    undone = client.post(root + "/activities/" + operation + "/revert")
    assert undone.status_code == 200, undone.text
    after_undo = client.get(root + "/strings/" + entry["id"]).json()
    assert after_undo["source_text"] == after_undo["published_source_text"] == "Welcome"
    morning = save(
        client, root, update(after_undo, source_text=morning["source_text"]), publish=True
    ).json()
    restored = client.post(root + "/strings/" + entry["id"] + "/activities/" + version + "/restore")
    assert restored.status_code == 200, restored.text
    current = client.get(root + "/strings/" + entry["id"]).json()
    assert current["source_text"] == "Welcome"
    assert current["published_source_text"] == "Good morning"
    assert current["status"] == "public"


def test_preview_keeps_historical_locales_and_binds_project_settings(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    assert client.patch(root, json={"target_languages": ["en"]}).status_code == 200
    proposed = update(entry, source_text="Next source")
    reviewed = preview(client, root, proposed)
    assert {t["locale"] for t in reviewed["entry"]["translations"]} == {"en", "fr"}
    assert client.patch(root, json={"target_languages": ["en", "ja"]}).status_code == 200
    response = client.post(
        root + "/strings/editor-save",
        json={
            "proposal": proposed,
            "action": "publish",
            "fingerprint": reviewed["fingerprint"],
        },
    )
    assert response.status_code == 409
    assert (
        client.get(root + "/strings/" + entry["id"]).json()["source_text"] == entry["source_text"]
    )


def test_editor_rejects_foreign_string_module_and_tag(client, editor):
    root, proposal = editor
    other = client.post(
        "/api/projects", json={"name": "Other", "target_languages": ["en", "fr"]}
    ).json()
    other_root = f"/api/projects/{other['id']}"
    foreign = client.post(other_root + "/strings", json=proposal["values"]).json()
    assert (
        client.post(
            root + "/strings/editor-preview",
            json={
                "proposal": update(foreign),
            },
        ).status_code
        == 404
    )
    module = client.post(other_root + "/modules", json={"slug": "other", "name": "Other"}).json()
    tag = client.post(
        other_root + "/tags", json={"name": "Other", "target_languages": ["en", "fr"]}
    ).json()
    for fields in [{"module_id": module["id"]}, {"tag_ids": [tag["id"]]}]:
        assert (
            client.post(
                root + "/strings/editor-preview",
                json={
                    "proposal": {**proposal, "values": {**proposal["values"], **fields}},
                },
            ).status_code
            == 400
        )
    assert activities(client, root) == []


def test_publication_rechecks_state_after_waiting_for_translation_lock(
    client, editor, session_factory, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from uuid import UUID

    from app.services import strings

    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    proposed = update(entry, description="Must not save")
    reviewed = preview(client, root, proposed)
    waiting = Event()
    original = strings._locked_editor_entry
    with session_factory() as db:
        locked = original(db, UUID(root.rsplit("/", 1)[1]), UUID(entry["id"]))
        next(t for t in locked.translations if t.locale == "fr").value = "Competing French"
        db.flush()

        def signal_lock(*args, **kwargs):
            waiting.set()
            return original(*args, **kwargs)

        monkeypatch.setattr(strings, "_locked_editor_entry", signal_lock)
        with ThreadPoolExecutor(max_workers=1) as pool:
            response = pool.submit(
                client.post,
                root + "/strings/editor-save",
                json={
                    "proposal": proposed,
                    "action": "publish",
                    "fingerprint": reviewed["fingerprint"],
                },
            )
            try:
                assert waiting.wait(5)
            finally:
                db.commit()
            assert response.result(timeout=10).status_code == 409
    saved = client.get(root + "/strings/" + entry["id"]).json()
    assert saved["description"] is None
    french = next(t for t in saved["translations"] if t["locale"] == "fr")
    assert french["value"] == "Competing French"
    assert french["published_value"] == "Bienvenue"


def test_review_includes_empty_configured_locales_without_persisting_rows(client, editor):
    root, proposal = editor
    entry = save(client, root, proposal, publish=True).json()
    assert client.patch(root, json={"target_languages": ["en", "fr", "ja"]}).status_code == 200
    projected = preview(client, root, update(entry))["entry"]
    japanese = next(t for t in projected["translations"] if t["locale"] == "ja")
    assert japanese["value"] == ""
    saved = client.get(root + "/strings/" + entry["id"]).json()
    assert not any(t["locale"] == "ja" for t in saved["translations"])
    assert save(client, root, update(entry), publish=True).status_code == 409
