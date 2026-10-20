"""Editor saves merge disjoint fields and reject competing changes atomically."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.models import Project
from app.schemas import StringUpdate
from app.services import strings


@pytest.fixture()
def editor_string(client):
    project = client.post(
        "/api/projects",
        json={
            "name": "Shared editing",
            "target_languages": ["en", "fr"],
        },
    ).json()
    entry = client.post(
        f"/api/projects/{project['id']}/strings",
        json={
            "key": "greeting",
            "source_text": "Xin chào",
            "translations": {"en": "Hello", "fr": "Bonjour"},
        },
    ).json()
    return f"/api/projects/{project['id']}/strings/{entry['id']}"


def translations(entry):
    return {item["locale"]: item["value"] for item in entry["translations"]}


def test_stale_description_and_other_locale_edits_merge(client, editor_string):
    url = editor_string
    alice = client.get(url).json()
    bob = client.get(url).json()
    assert (
        client.patch(
            url,
            json={
                "translations": {"en": "Welcome"},
                "expected": {"translations": {"en": translations(alice)["en"]}},
            },
        ).status_code
        == 200
    )
    result = client.patch(
        url,
        json={
            "description": "Bob context",
            "translations": {"fr": "Bienvenue"},
            "expected": {"description": bob["description"], "translations": {"fr": "Bonjour"}},
        },
    )
    assert result.status_code == 200
    assert result.json()["description"] == "Bob context"
    assert translations(result.json())["en"] == "Welcome"
    assert translations(result.json())["fr"] == "Bienvenue"


@pytest.mark.parametrize("endpoint", ["patch", "put"])
def test_competing_locale_edits_conflict_and_identical_text_succeeds(
    client, editor_string, endpoint
):
    url = editor_string
    alice = client.put(url + "/translations/en", json={"value": "Welcome", "expected": "Hello"})
    assert alice.status_code == 200

    def save(value):
        if endpoint == "put":
            return client.put(url + "/translations/en", json={"value": value, "expected": "Hello"})
        return client.patch(
            url,
            json={
                "description": "Must not partially save",
                "translations": {"en": value},
                "expected": {"description": None, "translations": {"en": "Hello"}},
            },
        )

    conflict = save("Bob text")
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["code"] == "stale_editor_save"
    assert detail["fields"] == ["translations.en"]
    assert translations(detail["current"])["en"] == "Welcome"
    assert client.get(url).json()["description"] is None
    assert save("Welcome").status_code == 200


@pytest.mark.parametrize(
    "field,first,second,original",
    [
        ("key", "alice-key", "bob-key", "greeting"),
        ("source_text", "Alice source", "Bob source", "Xin chào"),
        ("description", "Alice context", "Bob context", None),
    ],
)
def test_metadata_conflicts(client, editor_string, field, first, second, original):
    assert (
        client.patch(editor_string, json={field: first, "expected": {field: original}}).status_code
        == 200
    )
    response = client.patch(editor_string, json={field: second, "expected": {field: original}})
    assert response.status_code == 409
    assert response.json()["detail"]["fields"] == [field]
    assert client.get(editor_string).json()[field] == first


def test_expected_must_cover_every_changed_field(client, editor_string):
    response = client.patch(
        editor_string,
        json={
            "description": "Missing original",
            "expected": {},
        },
    )
    assert response.status_code == 422
    assert client.get(editor_string).json()["description"] is None


@pytest.mark.parametrize("expected", [None, {"translations": {}}])
def test_invalid_original_values_cannot_disable_checks(client, editor_string, expected):
    response = client.patch(
        editor_string,
        json={
            "translations": {"en": "Unexpected"},
            "expected": expected,
        },
    )
    assert response.status_code == 422
    assert translations(client.get(editor_string).json())["en"] == "Hello"


@pytest.mark.parametrize("field", ["module_id", "tag_ids"])
def test_catalog_reference_conflicts_and_clearing(client, editor_string, field):
    project_url = editor_string.split("/strings/")[0]
    if field == "module_id":
        alice = client.post(
            project_url + "/modules", json={"slug": "alice", "name": "Alice"}
        ).json()["id"]
        bob = client.post(project_url + "/modules", json={"slug": "bob", "name": "Bob"}).json()[
            "id"
        ]
        empty = None
    else:
        alice = [
            client.post(project_url + "/tags", json={"name": "Alice", "color": "#000000"}).json()[
                "id"
            ]
        ]
        bob = [
            client.post(project_url + "/tags", json={"name": "Bob", "color": "#ffffff"}).json()[
                "id"
            ]
        ]
        empty = []
    assert (
        client.patch(editor_string, json={field: alice, "expected": {field: empty}}).status_code
        == 200
    )
    response = client.patch(editor_string, json={field: bob, "expected": {field: empty}})
    assert response.status_code == 409
    assert response.json()["detail"]["fields"] == [field]
    assert (
        client.patch(editor_string, json={field: empty, "expected": {field: alice}}).status_code
        == 200
    )


def test_clearing_value_and_empty_locale_baseline(client, editor_string):
    assert (
        client.patch(
            editor_string,
            json={
                "translations": {"en": ""},
                "expected": {"translations": {"en": "Hello"}},
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            editor_string + "/translations/en",
            json={
                "value": "New text",
                "expected": "",
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            editor_string + "/translations/en",
            json={
                "value": "Stale text",
                "expected": "",
            },
        ).status_code
        == 409
    )


def test_confidence_changes_are_checked(client, editor_string):
    assert (
        client.patch(
            editor_string,
            json={
                "translations": {"en": "Hello"},
                "translation_scores": {"en": 80},
                "expected": {"translations": {"en": "Hello"}, "translation_scores": {"en": None}},
            },
        ).status_code
        == 200
    )
    response = client.patch(
        editor_string,
        json={
            "translations": {"en": "Hello"},
            "translation_scores": {"en": 50},
            "expected": {"translations": {"en": "Hello"}, "translation_scores": {"en": None}},
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["fields"] == ["translation_scores.en"]


def test_deleted_string_cannot_be_saved_from_old_editor(client, editor_string):
    assert client.delete(editor_string).status_code == 204
    response = client.patch(
        editor_string,
        json={
            "description": "stale",
            "expected": {"description": None},
        },
    )
    assert response.status_code == 409
    assert "deleted_at" in response.json()["detail"]["fields"]


def test_concurrent_check_and_write_are_serialized(
    client, editor_string, session_factory, monkeypatch
):
    """Hold Alice after checking; Bob must wait, then read Alice's committed value."""
    project_id, string_id = map(UUID, (editor_string.split("/")[3], editor_string.split("/")[-1]))
    alice_checked, release_alice, bob_started, bob_checked = (Event() for _ in range(4))
    check = strings._check_editor_expected
    lock = strings._locked_editor_entry

    def checked(entry, payload):
        check(entry, payload)
        if payload.translations["en"] == "Alice":
            alice_checked.set()
            assert release_alice.wait(5)
        else:
            bob_checked.set()

    def locked(db, pid, sid):
        if db.info.get("bob"):
            bob_started.set()
        return lock(db, pid, sid)

    monkeypatch.setattr(strings, "_check_editor_expected", checked)
    monkeypatch.setattr(strings, "_locked_editor_entry", locked)

    def save(value):
        with session_factory() as db:
            project = db.get(Project, project_id)
            strings.get_string(db, project_id, string_id)
            db.info["bob"] = value == "Bob"
            try:
                strings.update_string(
                    db,
                    project,
                    string_id,
                    StringUpdate(
                        translations={"en": value},
                        expected={"translations": {"en": "Hello"}},
                    ),
                )
                return 200
            except HTTPException as error:
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        alice = pool.submit(save, "Alice")
        try:
            assert alice_checked.wait(5)
            bob = pool.submit(save, "Bob")
            assert bob_started.wait(5)
            assert not bob_checked.wait(0.2)
        finally:
            release_alice.set()
        assert alice.result(timeout=5) == 200
        assert bob.result(timeout=5) == 409
    assert translations(client.get(editor_string).json())["en"] == "Alice"
