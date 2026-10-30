"""Published snapshot matching, explicit reuse safety, and per-cell AI skipping."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.models import StringEntry
from tests.helpers import make_project, publish_strings


def create(client, pid, key, source="Welcome to your account", **extra):
    response = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": key,
            "source_text": source,
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def suggestions(client, pid, sid, locale="en"):
    response = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={
            "scope": "strings",
            "string_ids": [sid],
            "locales": [locale],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["items"][0]["memory_suggestions"].get(locale, [])


def test_snapshot_matching_is_project_locale_scoped_and_uses_published_attribution(client):
    pid = make_project(client, targets=["en", "ja"])["id"]
    module = client.post(f"/api/projects/{pid}/modules", json={"slug": "old", "name": "Old"}).json()
    donor = create(
        client, pid, "original", module_id=module["id"], translations={"en": "Welcome back"}
    )
    publish_strings(client, pid, [donor["id"]])
    response = client.patch(
        f"/api/projects/{pid}/strings/{donor['id']}",
        json={
            "key": "edited",
            "source_text": "Unpublished source",
            "module_id": None,
            "translations": {"en": "Unpublished target", "ja": "Unpublished Japanese"},
        },
    )
    assert response.status_code == 200, response.text
    recipient = create(client, pid, "recipient")
    matches = suggestions(client, pid, recipient["id"])
    assert len(matches) == 1
    assert matches[0] == {
        **matches[0],
        "key": "original",
        "module_id": module["id"],
        "module_slug": "old",
        "value": "Welcome back",
        "match_type": "exact",
        "similarity": 1.0,
        "source_text": recipient["source_text"],
        "can_accept": True,
    }
    assert suggestions(client, pid, recipient["id"], "ja") == []
    other_pid = make_project(client, "Other")["id"]
    other = create(client, other_pid, "other")
    assert suggestions(client, other_pid, other["id"]) == []


@pytest.mark.parametrize(
    "state", ["draft", "pending_delete", "deleted", "blank", "never_published"]
)
def test_ineligible_donors_are_excluded(client, session_factory, state):
    pid = make_project(client)["id"]
    donor = create(client, pid, "donor", translations={"en": "Hello"})
    if state != "never_published":
        publish_strings(client, pid, [donor["id"]])
    with session_factory() as db:
        entry = db.get(StringEntry, uuid.UUID(donor["id"]))
        if state == "draft":
            entry.status = "draft"
        elif state == "pending_delete":
            entry.pending_delete = True
        elif state == "deleted":
            entry.deleted_at = datetime.now(UTC)
        elif state == "blank":
            entry.translations[0].published_value = " \t\n "
        db.commit()
    recipient = create(client, pid, "recipient")
    assert suggestions(client, pid, recipient["id"]) == []


@pytest.mark.parametrize("blank", ["\t", "\n", " \r\n\t ", "\xa0", "\u2003", "\u3000", "\x1c"])
def test_blank_donors_do_not_consume_suggestion_limit(client, blank):
    pid = make_project(client)["id"]
    value = "\tWelcome back\xa0"
    valid = create(client, pid, "valid", translations={"en": value})
    publish_strings(client, pid, [valid["id"]])
    for i in range(3):
        donor = create(client, pid, f"blank{i}", translations={"en": blank})
        publish_strings(client, pid, [donor["id"]])
    recipient = create(client, pid, "recipient")
    matches = suggestions(client, pid, recipient["id"])
    assert [match["key"] for match in matches] == ["valid"]
    assert matches[0]["value"] == value


def test_fuzzy_threshold_literal_equality_ranking_and_limit(client, session_factory):
    pid = make_project(client)["id"]
    recipient = create(client, pid, "recipient")
    module = client.post(
        f"/api/projects/{pid}/modules", json={"slug": "other", "name": "Other"}
    ).json()
    donors = []
    for key, source, mid in [
        ("same-old", recipient["source_text"], None),
        ("cross-new", recipient["source_text"], module["id"]),
        ("same-new", recipient["source_text"], None),
        ("punctuation", recipient["source_text"] + "!", None),
        ("near", recipient["source_text"] + " now", None),
        ("distant", "Delete everything permanently", None),
    ]:
        donor = create(client, pid, key, source, module_id=mid, translations={"en": "Hello"})
        publish_strings(client, pid, [donor["id"]])
        donors.append(donor)
    with session_factory() as db:
        db.get(StringEntry, uuid.UUID(donors[0]["id"])).published_at = datetime.now(
            UTC
        ) - timedelta(days=1)
        db.commit()
    matches = suggestions(client, pid, recipient["id"])
    assert [m["key"] for m in matches] == ["same-new", "same-old", "cross-new"]
    for donor in donors[:3]:
        client.post(
            f"/api/projects/{pid}/strings/batch",
            json={"action": "unpublish", "string_ids": [donor["id"]]},
        )
    matches = suggestions(client, pid, recipient["id"])
    assert [m["key"] for m in matches] == ["punctuation", "near"]
    assert matches[0]["similarity"] == 1.0 and matches[0]["match_type"] == "fuzzy"
    assert matches[1]["similarity"] >= 0.8
    # The comparison is inclusive, and below-threshold candidates never leak.
    with session_factory() as db:
        similarity = db.execute(
            text("SELECT similarity(:a, :b)"),
            {"a": recipient["source_text"], "b": donors[-1]["source_text"]},
        ).scalar_one()
        assert similarity < 0.8


@pytest.mark.parametrize(
    "source,value,accepted",
    [
        ("Welcome to your account and manage your personal settings {name}", "Welcome", False),
        ("<b>Welcome to your account</b>", "<i>Welcome</i>", False),
        ("{n, plural, one {Account} other {Accounts}}", "{n, plural, one {Account}}", False),
        ("{" * 257, "Hello", False),
        ("Welcome to your wonderful account", "Hi", True),
    ],
)
def test_recipient_qa_controls_acceptance_and_atomic_apply(client, source, value, accepted):
    pid = make_project(client)["id"]
    donor = create(client, pid, "donor", source, translations={"en": value})
    publish_strings(client, pid, [donor["id"]])
    recipient = create(client, pid, "recipient", source)
    other = create(client, pid, "unrelated", "Hello")
    match = suggestions(client, pid, recipient["id"])[0]
    assert match["can_accept"] is accepted
    response = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": other["id"],
                    "expected_source_text": "Hello",
                    "translations": {"en": "Hi"},
                },
                {
                    "string_id": recipient["id"],
                    "expected_source_text": source,
                    "translations": {"en": value},
                    "memory_locales": ["en"],
                    "scores": {"en": 99},
                },
            ]
        },
    )
    assert response.status_code == (200 if accepted else 409), response.text
    if not accepted:
        assert response.json()["detail"]["code"] == "unsafe_translation_memory"
        stored = client.get(f"/api/projects/{pid}/strings/{other['id']}").json()
        assert not any(t["value"] for t in stored["translations"])
    else:
        stored = client.get(f"/api/projects/{pid}/strings/{recipient['id']}").json()
        assert stored["translations"][0]["confidence"] is None
        assert stored["published_at"] is None
        batch = response.json()["batch_id"]
        undo = client.post(f"/api/projects/{pid}/activities/batch/{batch}/revert")
        assert undo.status_code == 200, undo.text
        assert not any(
            t["value"]
            for t in client.get(f"/api/projects/{pid}/strings/{recipient['id']}").json()[
                "translations"
            ]
        )


def test_fuzzy_qa_checks_recipient_placeholders(client):
    pid = make_project(client)["id"]
    donor = create(
        client,
        pid,
        "donor",
        "Welcome to your account and manage your personal settings {name}",
        translations={"en": "Hello {name}"},
    )
    publish_strings(client, pid, [donor["id"]])
    recipient = create(
        client, pid, "recipient", "Welcome to your account and manage your personal settings {user}"
    )
    match = suggestions(client, pid, recipient["id"])[0]
    assert not match["can_accept"]
    assert any(i["code"] == "placeholder_missing" for i in match["qa"]["issues"])


@pytest.mark.parametrize("background", [False, True])
def test_ai_exclusions_reach_sync_and_background_models(
    client, monkeypatch, background, session_factory
):
    pid = make_project(client, targets=["en", "ja"])["id"]
    recipient = create(client, pid, "recipient")
    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0 if background else 20)
    calls = []

    def fake_translate(base, items, on_progress=None):
        calls.append(items)
        assert len(items) == 1 and items[0].locales == ("ja",)
        return {items[0].id: {"ja": "Japanese"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_translate)
    response = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={
            "scope": "strings",
            "string_ids": [recipient["id"]],
            "locales": ["en", "ja"],
            "exclude_locales_by_string": {recipient["id"]: ["en"]},
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    if background:
        job = client.get(f"/api/jobs/{result['job_id']}").json()
        assert job["status"] == "completed", job
        from app.models import Job

        with session_factory() as db:
            assert db.get(Job, uuid.UUID(result["job_id"])).payload[
                "exclude_locales_by_string"
            ] == {recipient["id"]: ["en"]}
        result = job["result"]
    assert result["items"][0]["translations"] == {"ja": "Japanese"}
    assert len(calls) == 1
    response = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={
            "scope": "strings",
            "string_ids": [recipient["id"]],
            "locales": ["en", "ja"],
            "exclude_locales_by_string": {recipient["id"]: ["en", "ja"]},
        },
    )
    assert response.status_code == 200 and response.json()["job_id"] is None
    assert response.json()["items"] == [] and len(calls) == 1


def test_memory_source_conflict_and_concurrent_filled_cell(client):
    pid = make_project(client)["id"]
    recipient = create(client, pid, "recipient", "Hello {name}")
    root = f"/api/projects/{pid}"
    client.patch(f"{root}/strings/{recipient['id']}", json={"source_text": "Hello {user}"})
    item = {
        "string_id": recipient["id"],
        "expected_source_text": "Hello {name}",
        "translations": {"en": "Hi {name}"},
        "memory_locales": ["en"],
    }
    response = client.post(f"{root}/translate/apply", json={"items": [item]})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "stale_translation_source"
    client.patch(f"{root}/strings/{recipient['id']}", json={"translations": {"en": "Human {user}"}})
    item.update(expected_source_text="Hello {user}", translations={"en": "Hi {user}"})
    response = client.post(f"{root}/translate/apply", json={"items": [item]})
    assert response.status_code == 200 and response.json()["translated_count"] == 0
    stored = client.get(f"{root}/strings/{recipient['id']}").json()
    assert stored["translations"][0]["value"] == "Human {user}"


def test_fuzzy_threshold_is_inclusive(client):
    pid = make_project(client)["id"]
    recipient = create(client, pid, "recipient", "a b c d")
    for key, source in [("boundary", "a b c d e"), ("below", "a b c d e f")]:
        donor = create(client, pid, key, source, translations={"en": "Hello"})
        publish_strings(client, pid, [donor["id"]])
    matches = suggestions(client, pid, recipient["id"])
    assert [m["key"] for m in matches] == ["boundary"]
    assert matches[0]["similarity"] == pytest.approx(0.8)


def test_batched_memory_query_uses_trigram_index_on_large_catalog(client, session_factory):
    import json

    from app.services.translation_memory import STRIP_WHITESPACE, SUGGESTIONS_SQL

    pid = make_project(client)["id"]
    recipient = create(client, pid, "recipient")
    donor = create(client, pid, "donor", translations={"en": "Welcome"})
    publish_strings(client, pid, [donor["id"]])
    with session_factory() as db:
        db.execute(
            text("""
            INSERT INTO strings (id, project_id, key, source_text, status,
                                 published_key, published_source_text, published_at,
                                 pending_delete, key_policy_allows_duplicates)
            SELECT gen_random_uuid(), :pid, 'scale_' || i, md5(i::text), 'public',
                   'scale_' || i, md5(i::text), now(), false, false
            FROM generate_series(1, 10000) AS i
        """),
            {"pid": uuid.UUID(pid)},
        )
        db.execute(
            text("""
            INSERT INTO translations (id, string_id, locale, value, published_value)
            SELECT gen_random_uuid(), id, 'en', 'Translated', 'Translated'
            FROM strings WHERE project_id = :pid AND key LIKE 'scale_%'
        """),
            {"pid": uuid.UUID(pid)},
        )
        db.execute(text("ANALYZE strings"))
        db.execute(text("ANALYZE translations"))
        db.execute(text("SELECT set_config('pg_trgm.similarity_threshold', '0.8', true)"))
        recipients = [
            {
                "id": recipient["id"],
                "source": recipient["source_text"],
                "module_id": None,
                "locale": "en",
            }
        ] * 50
        plan = db.execute(
            text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + SUGGESTIONS_SQL.text),
            {
                "recipients": json.dumps(recipients),
                "project_id": uuid.UUID(pid),
                "limit": 3,
                "strip_whitespace": STRIP_WHITESPACE,
            },
        ).scalar_one()[0]
        assert "ix_strings_published_source_trgm" in json.dumps(plan), plan
        print(f"50-cell lookup across 10,001 published donors: {plan['Execution Time']} ms")
