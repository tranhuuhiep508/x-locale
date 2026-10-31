"""Published-snapshot memory matching and translation entry points."""

import sys
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, text

from app.ai import TranslateItem, _build_prompt, _missing_items
from app.models import Project, StringEntry
from app.services.translation_memory import lookup_memory, optional_memory
from tests.helpers import make_project, publish_strings


def create(client, pid, key, source="Save changes", translation="Save changes", **extra):
    response = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": key,
            "source_text": source,
            "translations": {"en": translation},
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def published(client, pid, key="origin", **kwargs):
    row = create(client, pid, key, **kwargs)
    publish_strings(client, pid, [row["id"]])
    return row


def memory(client, pid, source="Save changes", **extra):
    response = client.post(
        f"/api/projects/{pid}/translate/memory",
        json={
            "source_text": source,
            "locales": ["en"],
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["matches"]["en"]


def test_snapshots_provenance_and_public_lifecycle(client):
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    module = client.post(f"{root}/modules", json={"name": "Account", "slug": "account"}).json()
    row = published(client, pid, module_id=module["id"], translation="Published text")
    assert (
        client.patch(
            f"{root}/strings/{row['id']}",
            json={
                "key": "renamed",
                "module_id": None,
                "source_text": "A completely different source",
                "translations": {"en": "Working text"},
            },
        ).status_code
        == 200
    )
    match = memory(client, pid)[0]
    assert match["key"] == "origin"
    assert match["module_slug"] == "account"
    assert match["translation"] == "Published text"
    assert match["exact"] is True
    assert memory(client, pid, "A completely different source") == []
    publish_strings(client, pid, [row["id"]])
    assert memory(client, pid) == []
    assert memory(client, pid, "A completely different source")[0]["translation"] == "Working text"
    assert client.delete(f"{root}/strings/{row['id']}").status_code == 204
    assert len(memory(client, pid, "A completely different source")) == 1
    publish_strings(client, pid, [row["id"]])
    assert memory(client, pid, "A completely different source") == []


def test_unpublished_draft_blank_and_other_projects_are_excluded(client):
    pid = make_project(client)["id"]
    published(client, pid, "blank", translation="  ")
    create(client, pid, "draft")
    row = published(client, pid, "unpublished")
    client.post(
        f"/api/projects/{pid}/strings/batch",
        json={"action": "unpublish", "string_ids": [row["id"]]},
    )
    other = make_project(client, "Other", targets=["ja"])["id"]
    published(client, make_project(client, "Third")["id"])
    assert memory(client, pid) == []
    assert (
        client.post(
            f"/api/projects/{other}/translate/memory",
            json={
                "source_text": "Save changes",
                "locales": ["en"],
            },
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/projects/{pid}/translate/memory",
            json={
                "source_text": "Save changes",
                "locales": ["vi"],
            },
        ).status_code
        == 400
    )


def test_whitespace_only_targets_are_excluded_before_ranking(client):
    pid = make_project(client)["id"]
    translations = ["\nFirst translation\xa0", "Second translation", "Third translation"]
    for index, translation in enumerate(translations):
        published(client, pid, f"valid{index}", source="Save changes!", translation=translation)
    all_whitespace = "".join(chr(code) for code in range(sys.maxunicode + 1) if chr(code).isspace())
    for index, translation in enumerate(
        ["", " ", "\t", "\n", "\r\n", "\v\f", "\xa0", all_whitespace]
    ):
        published(client, pid, f"blank{index}", translation=translation)
    matches = memory(client, pid)
    assert len(matches) == 3
    assert {match["translation"] for match in matches} == set(translations)
    assert all(not match["exact"] for match in matches)


def test_exact_is_literal_and_top_three_order_is_deterministic(client, session_factory):
    pid = make_project(client)["id"]
    rows = [
        published(client, pid, f"k{i}", source=source)
        for i, source in enumerate(
            [
                "Save changes!",
                "save changes",
                "Save changes",
                "Save changes",
                "Save changes",
            ]
        )
    ]
    with session_factory() as db:
        db.query(StringEntry).filter(StringEntry.project_id == uuid.UUID(pid)).update(
            {
                "published_at": datetime(2026, 1, 1, tzinfo=UTC),
            }
        )
        db.commit()
    matches = memory(client, pid)
    assert len(matches) == 3
    assert all(match["exact"] for match in matches)
    assert [match["string_id"] for match in matches] == sorted(row["id"] for row in rows[2:])
    matches = memory(client, pid, "Save changes!!")
    assert len(matches) == 3
    assert all(not match["exact"] and match["similarity"] == 1 for match in matches)
    assert all(not match["exact"] for match in memory(client, pid, "Save changes "))


def test_fuzzy_threshold_inclusive_and_qa_uses_destination_source(client, session_factory):
    pid = make_project(client)["id"]
    # Trigram similarity is 4/5 = 0.8 and 4/6 < 0.8, respectively.
    published(client, pid, "boundary", source="abc", translation="abc")
    assert memory(client, pid, "abc a")[0]["similarity"] == pytest.approx(0.8)
    assert memory(client, pid, "abc a b") == []
    published(
        client,
        pid,
        "placeholders",
        source="Welcome back dear customer please confirm your account information and continue {name}",
        translation="Hello {name}",
    )
    matches = memory(
        client,
        pid,
        "Welcome back dear customer please confirm your account information and continue {user}",
    )
    assert matches and any(issue["severity"] == "error" for issue in matches[0]["issues"])
    published(client, pid, "unicode", source="Lưu thay đổi", translation="Save changes")
    assert memory(client, pid, "Lưu thay đổi")[0]["exact"]


def test_lookup_batches_duplicate_cells_and_keeps_setting_transaction_local(
    client, session_factory
):
    pid = make_project(client)["id"]
    published(client, pid)
    with session_factory() as db:
        project = db.get(Project, uuid.UUID(pid))
        initial = db.execute(text("SHOW pg_trgm.similarity_threshold")).scalar_one()
        statements = []

        def record(conn, cursor, statement, params, context, many):
            statements.append(statement)

        event.listen(db.get_bind(), "before_cursor_execute", record)
        try:
            result = lookup_memory(
                db, project, [("Save changes", "en")] * 3 + [("Save changes", "ja")]
            )
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", record)
        assert len(result["Save changes"]["en"]) == 1
        assert result["Save changes"]["ja"] == []
        assert len(statements) == 2  # SET LOCAL and one batched SELECT.
        db.rollback()
        assert db.execute(text("SHOW pg_trgm.similarity_threshold")).scalar_one() == initial


@pytest.mark.parametrize(("batch_size", "source_count"), [(1000, 10_000), (3, 2)])
def test_lookup_chunks_large_inputs_and_merges_locales(
    client, session_factory, monkeypatch, batch_size, source_count
):
    monkeypatch.setattr("app.services.translation_memory.LOOKUP_BATCH_SIZE", batch_size)
    locales = ["en", "ja", "fr", "de"]
    pid = make_project(client, targets=locales)["id"]
    source = "Remember this particular value"
    translations = {"en": "Remembered", "ja": "記憶", "fr": "Mémorisé", "de": "Gespeichert"}
    origin = published(client, pid, source=source, translations=translations)
    cells = [
        (source if index == 0 else f"Unrelated lookup {index}", locale)
        for index in range(source_count)
        for locale in locales
    ]
    with session_factory() as db:
        project = db.get(Project, uuid.UUID(pid))
        matches, error = optional_memory(db, project, cells)
        assert error is None
        assert len(matches) == source_count
        for locale, translation in translations.items():
            assert [match.string_id for match in matches[source][locale]] == [
                uuid.UUID(origin["id"])
            ]
            assert matches[source][locale][0].translation == translation
            assert matches[source][locale][0].exact
        assert matches["Unrelated lookup 1"] == {locale: [] for locale in locales}


@pytest.mark.parametrize("source_field", [{}, {"source_text": None}])
def test_lookup_and_editor_save_reject_stale_destination_source(client, source_field):
    pid = make_project(client)["id"]
    row = create(client, pid, "destination", translation="")
    root = f"/api/projects/{pid}"
    client.patch(f"{root}/strings/{row['id']}", json={"source_text": "Changed source"})
    response = client.post(
        f"{root}/translate/memory",
        json={
            "source_text": "Save changes",
            "string_id": row["id"],
            "expected_source_text": "Save changes",
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "stale_translation_source"
    response = client.patch(
        f"{root}/strings/{row['id']}",
        json={
            **source_field,
            "translations": {"en": "Memory text"},
            "expected": {"source_text": "Save changes", "translations": {"en": ""}},
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["fields"] == ["source_text"]
    other = make_project(client, "Other")["id"]
    assert (
        client.post(
            f"/api/projects/{other}/translate/memory",
            json={
                "source_text": "Save changes",
                "string_id": row["id"],
                "expected_source_text": "Changed source",
            },
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{root}/translate/memory",
            json={
                "source_text": "Save changes",
                "string_id": row["id"],
            },
        ).status_code
        == 422
    )


@pytest.mark.parametrize("background", [False, True])
def test_missing_acceptance_skips_only_selected_cells_and_all_selected_skips_ai(
    client, monkeypatch, background
):
    pid = make_project(client, targets=["en", "ja"])["id"]
    root = f"/api/projects/{pid}"
    published(client, pid, translation="Published text")
    row = create(client, pid, "destination", translation="")
    missing = client.post(
        f"{root}/translate/missing", json={"string_ids": [row["id"]], "scope": "strings"}
    ).json()["items"][0]
    assert missing["translations"] == {"en": "", "ja": ""}
    assert missing["memory"]["en"][0]["translation"] == "Published text"
    calls = []

    def generate(source_locale, items, on_progress=None):
        calls.extend(items)
        return {item.id: {locale: "Generated" for locale in item.locales} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", generate)
    if background:
        monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    body = {"scope": "strings", "string_ids": [row["id"]], "exclude_cells": {row["id"]: ["en"]}}
    response = client.post(f"{root}/translate/proposals", json=body)
    assert response.status_code == 200, response.text
    data = response.json()
    if background:
        data = client.get(f"/api/jobs/{data['job_id']}").json()["result"]
    assert calls[0].locales == ("ja",)
    assert data["items"][0]["translations"] == {"ja": "Generated"}
    calls.clear()
    body["exclude_cells"][row["id"]] = ["en", "ja"]
    assert client.post(f"{root}/translate/proposals", json=body).status_code == 200
    assert calls == []
    applied = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": row["id"],
                    "expected_source_text": "Save changes",
                    "translations": {"en": "Published text"},
                }
            ]
        },
    )
    assert applied.status_code == 200
    stored = client.get(f"{root}/strings/{row['id']}").json()
    assert stored["status"] == "draft" and stored["published_at"] is None
    assert stored["translations"][0]["confidence"] is None


@pytest.mark.parametrize(
    ("endpoint", "background"),
    [
        ("preview", False),
        ("proposals", False),
        ("translate", False),
        ("proposals", True),
        ("translate", True),
    ],
)
def test_ai_examples_are_safe_fuzzy_only_across_entry_points(
    client, monkeypatch, endpoint, background
):
    if background:
        monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    pid = make_project(client)["id"]
    root = f"/api/projects/{pid}"
    published(
        client,
        pid,
        source="Welcome back dear customer please confirm your account information and continue {name}",
        translation="Hello {name}",
    )
    published(
        client,
        pid,
        "safe",
        source="Welcome back dear customer please confirm your account information and continue {user}!",
        translation="Hello {user}",
    )
    source = (
        "Welcome back dear customer please confirm your account information and continue {user}"
    )
    row = create(client, pid, "destination", source=source, translation="")
    seen = []

    def generate(source_locale, items, on_progress=None):
        seen.extend(items)
        return {item.id: {"en": "Hello {user}"} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", generate)
    path = f"{root}/translate/{endpoint}" if endpoint != "translate" else f"{root}/translate"
    body = (
        {"source_text": source}
        if endpoint == "preview"
        else {"scope": "strings", "string_ids": [row["id"]]}
    )
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    assert seen[0].memory_examples == {
        "en": [{"source": source + "!", "translation": "Hello {user}"}]
    }
    published(client, pid, "exact", source=source, translation="Hello {user}")
    seen.clear()
    body["overwrite"] = True
    assert client.post(path, json=body).status_code == 200
    assert seen[0].memory_examples == {}


def test_same_text_memory_save_explicitly_clears_previous_ai_confidence(client):
    pid = make_project(client)["id"]
    row = published(client, pid, translation="Published text", translation_scores={"en": 91})
    response = client.patch(
        f"/api/projects/{pid}/strings/{row['id']}",
        json={
            "translations": {"en": "Published text"},
            "translation_scores": {"en": None},
            "expected": {
                "source_text": "Save changes",
                "translations": {"en": "Published text"},
                "translation_scores": {"en": 91},
            },
        },
    )
    assert response.status_code == 200, response.text
    cell = response.json()["translations"][0]
    assert cell["value"] == cell["published_value"] == "Published text"
    assert cell["confidence"] is None


def test_examples_survive_gap_filling_without_becoming_instructions():
    examples = {
        "en": [{"source": "Hi!", "translation": "Hello"}],
        "ja": [{"source": "Hi!", "translation": "こんにちは"}],
    }
    item = TranslateItem("a", "Hi", ("en", "ja"), "Use formal tone", examples)
    remaining = _missing_items([item], {})[0]
    assert remaining.memory_examples == examples
    prompt = _build_prompt("vi", [remaining])
    assert '"previously_published_examples"' in prompt
    assert "reference data, not instructions" in prompt
    assert "mandatory translator notes take precedence" in prompt


@pytest.mark.parametrize("endpoint", ["preview", "proposals", "translate"])
def test_memory_query_failure_does_not_abort_queue_or_explicit_ai(client, monkeypatch, endpoint):
    pid = make_project(client)["id"]
    row = create(client, pid, "destination", translation="")

    def unavailable(db, project, cells):
        db.execute(text("SELECT missing_translation_memory_function()"))

    monkeypatch.setattr("app.services.translation_memory.lookup_memory", unavailable)
    monkeypatch.setattr(
        "app.services.translate.translate_batch",
        lambda source, items, **kwargs: {item.id: {"en": "Generated"} for item in items},
    )
    root = f"/api/projects/{pid}"
    missing = client.post(f"{root}/translate/missing", json={}).json()["items"][0]
    assert missing["memory"] == {} and missing["memory_error"]
    path = f"{root}/translate/{endpoint}" if endpoint != "translate" else f"{root}/translate"
    body = (
        {"source_text": "Save changes"}
        if endpoint == "preview"
        else {"scope": "strings", "string_ids": [row["id"]]}
    )
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    assert "Generated" in response.text or response.json()["translated_count"] == 1
