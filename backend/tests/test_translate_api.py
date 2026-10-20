"""AI auto-translation, proposals, and confidence score tests."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

import pytest

from tests.helpers import _make_project


def test_translate_preview_does_not_persist(client, monkeypatch):
    project = _make_project(client, "Preview", targets=["en", "ja"])
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    )

    def fake_batch(source_locale, items, on_progress=None):
        item = items[0]
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    r = client.post(
        f"/api/projects/{pid}/translate/preview",
        json={"source_text": "Xin chào", "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["translations"]["en"] == "en:Xin chào"
    assert r.json()["translations"]["ja"] == "ja:Xin chào"

    after = client.get(f"/api/projects/{pid}/activities").json()["total"]
    assert after == before
    string = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(t["value"] == "" for t in string["translations"])


def test_translate_fills_all_locales_in_one_batch(client, monkeypatch):
    project = _make_project(client, "Batch Translate", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    calls: list = []

    def fake_batch(source_locale, items, on_progress=None):
        calls.append(items)
        item = items[0]
        assert item.locales == ("en", "ja")
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en", "ja"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 2
    assert len(calls) == 1

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "en:Xin chào"
    assert by_locale["ja"] == "ja:Xin chào"


def test_translate_skips_filled_locale_unless_overwrite(client, monkeypatch):
    project = _make_project(client, "Skip Filled", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
        },
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        assert len(items) == 1
        assert items[0].locales == ("ja",)
        return {items[0].id: {"ja": "こんにちは"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en", "ja"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 1

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "Hello"
    assert by_locale["ja"] == "こんにちは"


@pytest.mark.parametrize("background", [False, True])
@pytest.mark.parametrize("overwrite", [False, True])
@pytest.mark.parametrize("existing_row", [False, True])
def test_direct_translate_rechecks_human_edit_after_generation(
    client, session_factory, monkeypatch, background, overwrite, existing_row
):
    from app.ai import TranslatedCell
    from app.models import Activity, Project, Translation
    from app.schemas import StringUpdate
    from app.services.strings import update_string

    project = _make_project(client, "Translation race", targets=["en", "ja"])
    pid = uuid.UUID(project["id"])
    root = f"/api/projects/{pid}"
    created = client.post(
        f"{root}/strings", json={"key": "hello", "source_text": "Xin chào"}
    ).json()
    sid = uuid.UUID(created["id"])
    if not existing_row:
        with session_factory() as db:
            db.query(Translation).filter(
                Translation.string_id == sid, Translation.locale == "en"
            ).delete()
            db.commit()

    generating, release_ai = Event(), Event()

    def fake_batch(source_locale, items, on_progress=None):
        generating.set()
        assert release_ai.wait(10), "AI generation was not released"
        return {
            items[0].id: {
                "en": TranslatedCell(text="AI English", confidence=95),
                "ja": TranslatedCell(text="AI Japanese", confidence=90),
            }
        }

    def human_edit():
        with session_factory() as db:
            update_string(
                db,
                db.get(Project, pid),
                sid,
                StringUpdate(
                    translations={"en": "Human edit"}, translation_scores={"en": 73}
                ),
            )

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    monkeypatch.setattr("app.services.translate.SessionLocal", session_factory)
    if background:
        monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    with ThreadPoolExecutor(max_workers=2) as pool:
        translating = pool.submit(
            client.post,
            f"{root}/translate",
            json={"locales": ["en", "ja"], "overwrite": overwrite},
        )
        try:
            assert generating.wait(10), "AI generation did not start"
            # This must commit before AI returns: generation must hold no row locks.
            pool.submit(human_edit).result(timeout=5)
        finally:
            release_ai.set()
        response = translating.result(timeout=10)
    assert response.status_code == 200, response.text
    result = response.json()
    if background:
        job = client.get(f"/api/jobs/{result['job_id']}").json()
        assert job["status"] == "completed"
        result = job["result"]
    assert result["translated_count"] == (2 if overwrite else 1)

    entry = client.get(f"{root}/strings/{sid}").json()
    translations = {t["locale"]: t for t in entry["translations"]}
    assert translations["en"]["value"] == ("AI English" if overwrite else "Human edit")
    assert translations["en"]["confidence"] == (95 if overwrite else 73)
    assert translations["ja"]["value"] == "AI Japanese"
    assert translations["ja"]["confidence"] == 90
    with session_factory() as db:
        audits = db.query(Activity).filter(
            Activity.project_id == pid, Activity.batch_kind == "translate"
        ).all()
        assert len(audits) == 1
        assert audits[0].before["translations"]["en"] == "Human edit"
        assert audits[0].after["translations"]["en"] == (
            "AI English" if overwrite else "Human edit"
        )


def test_overlapping_direct_translations_only_write_empty_cells_once(
    client, session_factory, monkeypatch
):
    from app.activity import attach_batch
    from app.models import Activity, Project
    from app.schemas import TranslateRequest
    from app.services.translate import apply_translations, select_entries

    project = _make_project(client, "Overlapping AI")
    pid = uuid.UUID(project["id"])
    client.post(
        f"/api/projects/{pid}/strings", json={"key": "hello", "source_text": "Xin chào"}
    )
    both_generating = Barrier(2)
    written, release_commit = Event(), Event()

    def fake_batch(source_locale, items, on_progress=None):
        both_generating.wait(timeout=10)
        return {items[0].id: {"en": "AI output"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    def translate():
        with session_factory() as db:
            project_row = db.get(Project, pid)
            entries = select_entries(db, project_row, TranslateRequest(locales=["en"]))
            attach_batch(db, uuid.uuid4(), "translate")
            count = apply_translations(db, project_row, entries, ["en"], False)
            if count:
                written.set()
                assert release_commit.wait(10), "translation commit was not released"
            db.commit()
            return count

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(translate) for _ in range(2)]
        try:
            assert written.wait(10), "neither translation reached the save step"
        finally:
            release_commit.set()
        assert sorted(f.result(timeout=10) for f in futures) == [0, 1]
    with session_factory() as db:
        assert db.query(Activity).filter(
            Activity.project_id == pid, Activity.batch_kind == "translate"
        ).count() == 1


@pytest.mark.parametrize("existing_row", [False, True])
@pytest.mark.parametrize("output", ["AI output", " \t "])
def test_direct_translate_handles_missing_and_whitespace_cells(
    client, session_factory, monkeypatch, existing_row, output
):
    from app.models import Activity, Translation

    project = _make_project(client, "Empty AI cells")
    pid = uuid.UUID(project["id"])
    root = f"/api/projects/{pid}"
    created = client.post(
        f"{root}/strings",
        json={"key": "hello", "source_text": "Xin chào", "translations": {"en": "   "}},
    ).json()
    sid = uuid.UUID(created["id"])
    if not existing_row:
        with session_factory() as db:
            db.query(Translation).filter(
                Translation.string_id == sid, Translation.locale == "en"
            ).delete()
            db.commit()

    monkeypatch.setattr(
        "app.services.translate.translate_batch",
        lambda source, items: {items[0].id: {"en": output}},
    )
    response = client.post(f"{root}/translate", json={"locales": ["en"]})
    assert response.status_code == 200, response.text
    assert response.json()["translated_count"] == bool(output.strip())
    with session_factory() as db:
        translation = db.query(Translation).filter(
            Translation.string_id == sid, Translation.locale == "en"
        ).first()
        if output.strip():
            assert translation.value == output
        elif existing_row:
            assert translation.value == "   "
        else:
            assert translation is None  # A blank result must not insert an empty row.
        assert db.query(Activity).filter(
            Activity.project_id == pid, Activity.batch_kind == "translate"
        ).count() == bool(output.strip())


def test_direct_translate_skips_string_deleted_during_generation(
    client, session_factory, monkeypatch
):
    from app.models import Activity, Project, Translation
    from app.services.strings import delete_string

    project = _make_project(client, "Deleted during AI")
    pid = uuid.UUID(project["id"])
    root = f"/api/projects/{pid}"
    created = client.post(
        f"{root}/strings", json={"key": "hello", "source_text": "Xin chào"}
    ).json()
    sid = uuid.UUID(created["id"])

    def fake_batch(source_locale, items):
        with session_factory() as db:
            delete_string(db, db.get(Project, pid), sid)
        return {items[0].id: {"en": "AI output"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    response = client.post(f"{root}/translate", json={"locales": ["en"]})
    assert response.status_code == 200, response.text
    assert response.json()["translated_count"] == 0
    with session_factory() as db:
        assert db.query(Translation).filter(
            Translation.string_id == sid, Translation.locale == "en"
        ).one().value == ""
        assert db.query(Activity).filter(
            Activity.project_id == pid, Activity.batch_kind == "translate"
        ).count() == 0


def test_translate_proposals_do_not_persist(client, monkeypatch):
    project = _make_project(client, "Propose", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        item = items[0]
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "missing", "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] is None
    assert len(body["items"]) == 1
    assert body["items"][0]["string_id"] == string["id"]
    assert body["items"][0]["translations"]["en"] == "en:Xin chào"
    assert body["items"][0]["translations"]["ja"] == "ja:Xin chào"

    after = client.get(f"/api/projects/{pid}/activities").json()["total"]
    assert after == before
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(t["value"] == "" for t in stored["translations"])


def test_translate_missing_lists_empty_locales_without_ai(client, monkeypatch):
    project = _make_project(client, "Missing List", targets=["en", "ja"])
    pid = project["id"]
    filled = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
        },
    ).json()
    empty = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "bye", "source_text": "Tạm biệt"},
    ).json()

    def fail_batch(*args, **kwargs):
        raise AssertionError("AI should not run when listing missing translations")

    monkeypatch.setattr("app.services.translate.translate_batch", fail_batch)

    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    r = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] is None
    assert body["total"] == 2
    assert body["page"] == 1
    assert body["page_size"] == 50
    by_key = {item["key"]: item for item in body["items"]}
    assert "en" not in by_key["hi"]["translations"]
    assert by_key["hi"]["translations"]["ja"] == ""
    assert by_key["hi"]["string_id"] == filled["id"]
    assert by_key["bye"]["translations"] == {"en": "", "ja": ""}
    assert by_key["bye"]["string_id"] == empty["id"]
    assert "description" in by_key["hi"]
    assert "description" in by_key["bye"]
    after = client.get(f"/api/projects/{pid}/activities").json()["total"]
    assert after == before
    stored = {s["key"]: s for s in client.get(f"/api/projects/{pid}/strings").json()["items"]}
    assert {t["locale"]: t["value"] for t in stored["hi"]["translations"]}["en"] == "Hello"
    assert all(t["value"] == "" for t in stored["bye"]["translations"])


def test_translate_missing_paginates_and_honors_filters(client, monkeypatch):
    project = _make_project(client, "Missing Page", targets=["en", "ja"])
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
        json={"name": "login", "color": "#111"},
    ).json()

    def fail_batch(*args, **kwargs):
        raise AssertionError("AI should not run when listing missing translations")

    monkeypatch.setattr("app.services.translate.translate_batch", fail_batch)

    a = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "a.login",
            "source_text": "Đăng nhập",
            "module_id": auth["id"],
            "tag_ids": [tag["id"]],
        },
    ).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "b.home", "source_text": "Trang chủ", "module_id": home["id"]},
    )
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "c.search", "source_text": "Tìm", "module_id": auth["id"]},
    )
    whitespace = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "d.spaces",
            "source_text": "Khoảng trắng",
            "module_id": auth["id"],
            "translations": {"en": "   ", "ja": "こんにちは"},
        },
    ).json()
    client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "e.full",
            "source_text": "Đủ",
            "module_id": auth["id"],
            "translations": {"en": "Full", "ja": "全部"},
        },
    )

    first = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"], "page": 1, "page_size": 2},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 4
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert [item["key"] for item in body["items"]] == ["a.login", "b.home"]

    second = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"], "page": 2, "page_size": 2},
    ).json()
    assert [item["key"] for item in second["items"]] == ["c.search", "d.spaces"]
    spaces = {item["key"]: item for item in second["items"]}["d.spaces"]
    assert spaces["string_id"] == whitespace["id"]
    assert spaces["translations"] == {"en": ""}
    assert "ja" not in spaces["translations"]

    clamped = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"], "page": 99, "page_size": 2},
    ).json()
    assert clamped["page"] == 2
    assert [item["key"] for item in clamped["items"]] == ["c.search", "d.spaces"]

    too_big = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en"], "page_size": 101},
    )
    assert too_big.status_code == 422

    by_q = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"], "q": "login"},
    ).json()
    assert by_q["total"] == 1
    assert by_q["items"][0]["string_id"] == a["id"]

    by_module = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"], "module_id": home["id"]},
    ).json()
    assert by_module["total"] == 1
    assert by_module["items"][0]["key"] == "b.home"

    by_tag = client.post(
        f"/api/projects/{pid}/translate/missing",
        json={"scope": "missing", "locales": ["en", "ja"], "tag_id": tag["id"]},
    ).json()
    assert by_tag["total"] == 1
    assert by_tag["items"][0]["string_id"] == a["id"]


def test_translate_proposals_use_request_descriptions(client, monkeypatch):
    project = _make_project(client, "Propose Desc", targets=["en"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "description": "stored context",
        },
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        assert items[0].context == "login button label"
        item = items[0]
        return {item.id: {"en": "Hello"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en"],
            "descriptions": {string["id"]: "login button label"},
        },
    )
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["description"] == "login button label"
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert stored["description"] == "stored context"


def test_translate_apply_rejects_oversized_payload(client):
    project = _make_project(client, "Apply Cap", targets=["en"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()
    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {"string_id": string["id"], "translations": {"en": f"v{i}"}}
                for i in range(101)
            ]
        },
    )
    assert r.status_code == 422


def test_translate_proposals_omit_filled_locales(client, monkeypatch):
    project = _make_project(client, "Propose Skip", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
        },
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        assert items[0].locales == ("ja",)
        return {items[0].id: {"ja": "こんにちは", "en": "should-not-use"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={
            "scope": "strings",
            "string_ids": [string["id"]],
            "locales": ["en", "ja"],
        },
    )
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert "en" not in item["translations"]
    assert item["translations"]["ja"] == "こんにちは"


def test_translate_apply_persists_and_is_revertible(client, monkeypatch):
    project = _make_project(client, "Apply", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        item = items[0]
        return {item.id: {lc: f"{lc}:{item.source_text}" for lc in item.locales}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    proposed = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [string["id"]], "locales": ["en", "ja"]},
    ).json()["items"]

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [{k: v for k, v in item.items() if k != "description"} for item in proposed]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 2
    batch_id = r.json()["batch_id"]

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "en:Xin chào"
    assert by_locale["ja"] == "ja:Xin chào"
    assert refreshed["status"] == "draft"

    activities = client.get(f"/api/projects/{pid}/activities").json()["items"]
    translate_rows = [a for a in activities if a["batch_kind"] == "translate"]
    assert translate_rows
    assert all(a["batch_id"] == batch_id for a in translate_rows)

    revert = client.post(f"/api/projects/{pid}/activities/batch/{batch_id}/revert")
    assert revert.status_code == 200, revert.text
    restored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(t["value"] == "" for t in restored["translations"])


def test_translate_apply_skips_locale_filled_after_preview(client):
    project = _make_project(client, "Apply Skip", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/en",
        json={"value": "Hello"},
    )

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "translations": {"en": "AI Hello", "ja": "こんにちは"},
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["translated_count"] == 1

    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "Hello"
    assert by_locale["ja"] == "こんにちは"


def test_translate_apply_saves_description(client):
    project = _make_project(client, "Apply Description", targets=["en"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "description": "Greeting on the home screen",
                    "expected_description": None,
                    "translations": {"en": "Hello"},
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert refreshed["description"] == "Greeting on the home screen"
    by_locale = {t["locale"]: t["value"] for t in refreshed["translations"]}
    assert by_locale["en"] == "Hello"


def test_translate_stores_confidence_and_manual_edit_clears_it(client, monkeypatch):
    from app.ai import TranslatedCell

    project = _make_project(client, "Score Persist", targets=["en", "ja"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        item = items[0]
        return {
            item.id: {
                "en": TranslatedCell(text="Hello", confidence=92),
                "ja": TranslatedCell(text="こんにちは", confidence=61),
            }
        }

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    r = client.post(
        f"/api/projects/{pid}/translate",
        json={"scope": "strings", "string_ids": [string["id"]], "locales": ["en", "ja"]},
    )
    assert r.status_code == 200, r.text
    refreshed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    by_locale = {t["locale"]: t for t in refreshed["translations"]}
    assert by_locale["en"]["value"] == "Hello"
    assert by_locale["en"]["confidence"] == 92
    assert by_locale["ja"]["value"] == "こんにちは"
    assert by_locale["ja"]["confidence"] == 61

    client.put(
        f"/api/projects/{pid}/strings/{string['id']}/translations/ja",
        json={"value": "やあ"},
    )
    after_edit = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    edited = {t["locale"]: t for t in after_edit["translations"]}
    assert edited["ja"]["value"] == "やあ"
    assert edited["ja"]["confidence"] is None
    assert edited["en"]["confidence"] == 92

    listed = client.get(f"/api/projects/{pid}/strings", params={"max_confidence": 70})
    assert listed.status_code == 200
    assert listed.json()["total"] == 0

    listed_high = client.get(f"/api/projects/{pid}/strings", params={"max_confidence": 95})
    assert listed_high.json()["total"] == 1


def test_translate_preview_and_apply_include_scores(client, monkeypatch):
    from app.ai import TranslatedCell

    project = _make_project(client, "Score Preview", targets=["en"])
    pid = project["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    def fake_batch(source_locale, items, on_progress=None):
        item = items[0]
        return {item.id: {"en": TranslatedCell(text="Hello", confidence=74)}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)

    preview = client.post(
        f"/api/projects/{pid}/translate/preview",
        json={"source_text": "Xin chào", "locales": ["en"]},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["translations"]["en"] == "Hello"
    assert preview.json()["scores"]["en"] == 74

    proposed = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [string["id"]], "locales": ["en"]},
    ).json()["items"]
    assert proposed[0]["translations"]["en"] == "Hello"
    assert proposed[0]["scores"]["en"] == 74

    applied = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [{k: v for k, v in item.items() if k != "description"} for item in proposed]
        },
    )
    assert applied.status_code == 200, applied.text
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    en = next(t for t in stored["translations"] if t["locale"] == "en")
    assert en["value"] == "Hello"
    assert en["confidence"] == 74

    needs_review = client.get(f"/api/projects/{pid}/strings", params={"max_confidence": 79})
    assert needs_review.json()["total"] == 1


def test_save_with_translation_scores(client):
    project = _make_project(client, "Score Save", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "translations": {"en": "Hello"},
            "translation_scores": {"en": 81},
        },
    ).json()
    en = next(t for t in created["translations"] if t["locale"] == "en")
    assert en["confidence"] == 81

    updated = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"translations": {"en": "Hi there"}},
    ).json()
    en = next(t for t in updated["translations"] if t["locale"] == "en")
    assert en["value"] == "Hi there"
    assert en["confidence"] is None


def test_translate_proposals_large_uses_job(client, monkeypatch):
    project = _make_project(client, "Propose Job", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    monkeypatch.setattr("app.routers.translate.run_propose_job", lambda *args, **kwargs: None)

    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"]},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert job_id
    assert r.json()["items"] == []

    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["kind"] == "translate_proposals"
    assert job["status"] == "pending"
    assert job["progress"] == {"phase": "queued", "chunks_done": 0, "chunks_total": 1}
    assert "payload" not in job
    assert "descriptions" not in job


def test_translate_proposals_job_progress_updates_without_payload(client, monkeypatch):
    project = _make_project(client, "Propose Progress", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Xin chào"},
    ).json()

    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    monkeypatch.setattr("app.routers.translate.run_propose_job", lambda *args, **kwargs: None)

    r = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"]},
    )
    job_id = r.json()["job_id"]

    from sqlalchemy.orm.attributes import flag_modified

    from app.database import get_db
    from app.main import app
    from app.models import Job

    db = next(app.dependency_overrides[get_db]())
    try:
        job_row = db.query(Job).filter(Job.id == uuid.UUID(job_id)).first()
        payload = dict(job_row.payload or {})
        payload["progress"] = {"phase": "translating", "chunks_done": 1, "chunks_total": 3}
        job_row.payload = payload
        flag_modified(job_row, "payload")
        db.commit()
    finally:
        db.close()

    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["progress"] == {"phase": "translating", "chunks_done": 1, "chunks_total": 3}
    assert "payload" not in job


def test_load_entries_by_ids_preserves_request_order(client):
    project = _make_project(client, "Entry Order")
    pid = project["id"]
    first = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "zeta", "source_text": "Z"},
    ).json()
    second = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "alpha", "source_text": "A"},
    ).json()

    from app.database import get_db
    from app.main import app
    from app.services.translate import _load_entries_by_ids

    db = next(app.dependency_overrides[get_db]())
    try:
        ids = [uuid.UUID(second["id"]), uuid.UUID(first["id"])]
        entries = _load_entries_by_ids(db, ids)
        assert [str(entry.id) for entry in entries] == [second["id"], first["id"]]
    finally:
        db.close()


def test_translate_apply_untouched_description_preserves_concurrent_edit(client):
    project = _make_project(client, "Apply untouched", targets=["en"])
    root = f"/api/projects/{project['id']}"
    string = client.post(
        f"{root}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "description": "Original",
        },
    ).json()
    review = client.post(f"{root}/translate/missing", json={"scope": "missing"}).json()
    assert review["items"][0]["description"] == "Original"
    edited = client.patch(f"{root}/strings/{string['id']}", json={"description": "New context"})
    assert edited.status_code == 200, edited.text
    applied = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "translations": {"en": "Hello"},
                }
            ]
        },
    )
    assert applied.status_code == 200, applied.text
    stored = client.get(f"{root}/strings/{string['id']}").json()
    assert stored["description"] == "New context"
    assert next(t for t in stored["translations"] if t["locale"] == "en")["value"] == "Hello"


@pytest.mark.parametrize("desired", ["Edited", "", None])
def test_translate_apply_stale_description_rolls_back_entire_batch(client, desired):
    project = _make_project(client, "Apply conflict", targets=["en"])
    root = f"/api/projects/{project['id']}"
    strings = [
        client.post(
            f"{root}/strings",
            json={
                "key": f"hi{i}",
                "source_text": "Xin chào",
                "description": "Original",
            },
        ).json()
        for i in range(2)
    ]
    changed = client.patch(
        f"{root}/strings/{strings[1]['id']}", json={"description": "New context"}
    )
    assert changed.status_code == 200, changed.text
    before = client.get(f"{root}/activities").json()["total"]
    applied = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "translations": {"en": "Hello"},
                    "description": desired,
                    "expected_description": "Original",
                }
                for string in strings
            ]
        },
    )
    assert applied.status_code == 409, applied.text
    assert applied.json()["detail"]["code"] == "stale_translation_description"
    assert applied.json()["detail"]["conflicts"] == [
        {
            "string_id": strings[1]["id"],
            "key": "hi1",
            "description": "New context",
        }
    ]
    assert client.get(f"{root}/activities").json()["total"] == before
    for string, description in zip(strings, ["Original", "New context"], strict=True):
        saved = client.get(f"{root}/strings/{string['id']}").json()
        assert saved["description"] == description
        assert all(t["value"] == "" for t in saved["translations"])


@pytest.mark.parametrize(
    "original,desired,expected,saved",
    [
        (None, " New context ", None, "New context"),
        ("Original", "", "Original", None),
        ("Original", None, "Original", None),
        ("New context", "New context", "Original", "New context"),
    ],
)
def test_translate_apply_description_edits_and_clears(client, original, desired, expected, saved):
    project = _make_project(client, "Apply edit", targets=["en"])
    root = f"/api/projects/{project['id']}"
    string = client.post(
        f"{root}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "description": original,
        },
    ).json()
    result = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "translations": {"en": "Hello"},
                    "description": desired,
                    "expected_description": expected,
                }
            ]
        },
    )
    assert result.status_code == 200, result.text
    assert client.get(f"{root}/strings/{string['id']}").json()["description"] == saved


@pytest.mark.parametrize("description", ["Edited", "", None])
def test_translate_apply_requires_original_for_description_write(client, description):
    project = _make_project(client, "Apply baseline", targets=["en"])
    root = f"/api/projects/{project['id']}"
    string = client.post(f"{root}/strings", json={"key": "hi", "source_text": "Xin chào"}).json()
    result = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": string["id"],
                    "description": description,
                    "translations": {"en": "Hello"},
                }
            ]
        },
    )
    assert result.status_code == 422, result.text
    saved = client.get(f"{root}/strings/{string['id']}").json()
    assert saved["description"] is None
    assert all(t["value"] == "" for t in saved["translations"])


def test_competing_apply_descriptions_refresh_after_row_lock(client, session_factory):
    from fastapi import HTTPException
    from sqlalchemy import event

    from app.models import Project, StringEntry
    from app.schemas import TranslateApplyItem
    from app.services.translate import commit_proposals

    project = _make_project(client, "Competing descriptions", targets=["en"])
    pid = uuid.UUID(project["id"])
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hi",
            "source_text": "Xin chào",
            "description": "Original",
        },
    ).json()
    sid = uuid.UUID(string["id"])
    loaded, start_competing, reading = Event(), Event(), Event()

    def competing_apply():
        with session_factory() as db:
            project_row = db.get(Project, pid)
            # Hold a stale ORM instance as well as a stale client baseline.
            stale = db.get(StringEntry, sid)
            assert stale.description == "Original"
            loaded.set()
            assert start_competing.wait(10)

            def before_read(conn, cursor, statement, parameters, context, executemany):
                if statement.lstrip().startswith("SELECT") and "strings" in statement:
                    reading.set()

            event.listen(db.connection(), "before_cursor_execute", before_read)
            try:
                commit_proposals(
                    db,
                    project_row,
                    [
                        TranslateApplyItem(
                            string_id=sid,
                            description="Second",
                            expected_description="Original",
                            translations={"en": "Second translation"},
                        )
                    ],
                )
                db.commit()
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with session_factory() as first, ThreadPoolExecutor(max_workers=1) as pool:
        first_project = first.get(Project, pid)
        commit_proposals(
            first,
            first_project,
            [
                TranslateApplyItem(
                    string_id=sid,
                    description="First",
                    expected_description="Original",
                    translations={},
                )
            ],
        )
        future = pool.submit(competing_apply)
        try:
            assert loaded.wait(10)
            start_competing.set()
            assert reading.wait(10)
            # The competing apply must wait until the first transaction commits.
            with pytest.raises(TimeoutError):
                future.result(timeout=0.2)
        finally:
            first.commit()
        assert future.result(timeout=10) == 409
    stored = client.get(f"/api/projects/{pid}/strings/{sid}").json()
    assert stored["description"] == "First"
    assert all(t["value"] == "" for t in stored["translations"])
