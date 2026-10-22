"""AI results may only be saved against the source that generated them."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import HTTPException
from sqlalchemy import event

from app.models import Activity, Project, StringEntry
from app.schemas import StringUpdate, TranslateApplyItem
from app.services.strings import update_string
from app.services.translate import commit_proposals
from tests.helpers import make_project, publish_strings


@pytest.mark.parametrize("changed_source", ["Hủy", "Lưu ", "Lưu!"])
def test_stale_source_rejects_entire_review_batch(client, monkeypatch, changed_source):
    project = make_project(client, "Stale review", targets=["en", "ja"])
    root = f"/api/projects/{project['id']}"
    rows = [
        client.post(
            f"{root}/strings",
            json={
                "key": f"action{i}",
                "source_text": "Lưu",
                "description": "Original",
            },
        ).json()
        for i in range(2)
    ]

    def generate(source_locale, items, on_progress=None):
        return {item.id: {"en": "Save", "ja": "保存"} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", generate)
    proposals = client.post(f"{root}/translate/proposals", json={"locales": ["en", "ja"]}).json()[
        "items"
    ]
    assert (
        client.patch(
            f"{root}/strings/{rows[1]['id']}",
            json={
                "source_text": changed_source,
                "description": "Concurrent context",
            },
        ).status_code
        == 200
    )
    before = client.get(f"{root}/activities").json()["total"]
    payload = [
        {
            "string_id": item["string_id"],
            "expected_source_text": item["source_text"],
            "translations": item["translations"],
            "scores": {"en": 95},
            "description": "My context",
            "expected_description": "Original",
        }
        for item in proposals
    ]
    response = client.post(f"{root}/translate/apply", json={"items": payload})
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "stale_translation_source"
    assert response.json()["detail"]["conflicts"] == [
        {
            "string_id": rows[1]["id"],
            "key": "action1",
            "expected_source_text": "Lưu",
            "source_text": changed_source,
        }
    ]
    assert client.get(f"{root}/activities").json()["total"] == before
    for row, description in zip(rows, ["Original", "Concurrent context"], strict=True):
        saved = client.get(f"{root}/strings/{row['id']}").json()
        assert saved["description"] == description
        assert all(t["value"] == "" and t["confidence"] is None for t in saved["translations"])
    # Resolving source freshness must not bypass the existing description check.
    for item in payload:
        if item["string_id"] == rows[1]["id"]:
            item["expected_source_text"] = changed_source
    response = client.post(f"{root}/translate/apply", json={"items": payload})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "stale_translation_description"


@pytest.mark.parametrize("baseline", [{}, {"expected_source_text": None}])
def test_apply_requires_source_baseline(client, baseline):
    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    row = client.post(f"{root}/strings", json={"key": "save", "source_text": "Lưu"}).json()
    response = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": row["id"],
                    "translations": {"en": "Save"},
                    **baseline,
                }
            ]
        },
    )
    assert response.status_code == 422
    assert any(error["loc"][-1] == "expected_source_text" for error in response.json()["detail"])


def test_source_restored_to_same_text_can_apply(client):
    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    row = client.post(f"{root}/strings", json={"key": "save", "source_text": "Lưu"}).json()
    for source in ["Hủy", "Lưu"]:
        assert (
            client.patch(f"{root}/strings/{row['id']}", json={"source_text": source}).status_code
            == 200
        )
    response = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": row["id"],
                    "expected_source_text": "Lưu",
                    "translations": {"en": "Save"},
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["translated_count"] == 1


@pytest.mark.parametrize("background", [False, True])
@pytest.mark.parametrize("overwrite", [False, True])
@pytest.mark.parametrize("mixed", [False, True])
def test_automatic_translation_skips_stale_source(
    client,
    session_factory,
    monkeypatch,
    background,
    overwrite,
    mixed,
):
    project = make_project(client, "Automatic source conflict", targets=["en", "ja"])
    pid = uuid.UUID(project["id"])
    root = f"/api/projects/{pid}"
    stale = client.post(
        f"{root}/strings",
        json={
            "key": "action",
            "source_text": "Lưu",
            "translations": {"en": "Published save"},
            "translation_scores": {"en": 80},
        },
    ).json()
    publish_strings(client, pid, [stale["id"]])
    stale = client.get(f"{root}/strings/{stale['id']}").json()
    good = (
        client.post(f"{root}/strings", json={"key": "good", "source_text": "Xin chào"}).json()
        if mixed
        else None
    )
    generating, release = Event(), Event()

    def generate(source_locale, items, on_progress=None):
        generating.set()
        assert release.wait(10)
        return {item.id: {locale: "AI output" for locale in item.locales} for item in items}

    def edit_source():
        with session_factory() as db:
            update_string(
                db, db.get(Project, pid), uuid.UUID(stale["id"]), StringUpdate(source_text="Hủy")
            )

    monkeypatch.setattr("app.services.translate.translate_batch", generate)
    monkeypatch.setattr("app.services.translate.SessionLocal", session_factory)
    if background:
        monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(
            client.post, f"{root}/translate", json={"locales": ["en", "ja"], "overwrite": overwrite}
        )
        try:
            assert generating.wait(10)
            # This commits before the model finishes; no generation-time row lock.
            pool.submit(edit_source).result(timeout=5)
        finally:
            release.set()
        response = future.result(timeout=10)
    assert response.status_code == 200, response.text
    result = response.json()
    if background:
        job = client.get(f"/api/jobs/{result['job_id']}").json()
        assert job["status"] == "completed"
        result = job["result"]
    assert result["translated_count"] == (2 if mixed else 0)
    assert result["skipped_source_conflicts"] == [
        {
            "string_id": stale["id"],
            "key": "action",
            "expected_source_text": "Lưu",
            "source_text": "Hủy",
        }
    ]
    saved = client.get(f"{root}/strings/{stale['id']}").json()
    assert saved["source_text"] == "Hủy"
    assert saved["published_source_text"] == "Lưu"
    assert saved["translations"] == stale["translations"]
    public = client.get(f"{root}/export", params={"layout": "flat", "stage": "public"}).json()
    assert public["vi"]["action"] == "Lưu"
    assert public["en"]["action"] == "Published save"
    if good:
        saved_good = client.get(f"{root}/strings/{good['id']}").json()
        assert all(t["value"] == "AI output" for t in saved_good["translations"])
    with session_factory() as db:
        writes = (
            db.query(Activity)
            .filter(Activity.project_id == pid, Activity.batch_kind == "translate")
            .all()
        )
        assert len(writes) == (1 if mixed else 0)
        assert all(str(write.string_id) == good["id"] for write in writes)


def test_apply_refreshes_source_after_waiting_for_editor_lock(client, session_factory):
    project = make_project(client)
    pid = uuid.UUID(project["id"])
    root = f"/api/projects/{pid}"
    row = client.post(f"{root}/strings", json={"key": "save", "source_text": "Lưu"}).json()
    sid = uuid.UUID(row["id"])
    loaded, start, reading = Event(), Event(), Event()

    def apply():
        with session_factory() as db:
            project_row = db.get(Project, pid)
            cached = db.get(StringEntry, sid)
            assert cached.source_text == "Lưu"
            loaded.set()
            assert start.wait(10)

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
                            expected_source_text="Lưu",
                            translations={"en": "Save"},
                        )
                    ],
                )
                db.commit()
                return None
            except HTTPException as error:
                db.rollback()
                return error

    with session_factory() as editor, ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(apply)
        assert loaded.wait(10)
        entry = editor.query(StringEntry).filter(StringEntry.id == sid).with_for_update().one()
        entry.source_text = "Hủy"
        editor.flush()
        try:
            start.set()
            assert reading.wait(10)
            with pytest.raises(TimeoutError):
                future.result(timeout=0.2)
        finally:
            editor.commit()
        error = future.result(timeout=10)
        assert error.status_code == 409
        assert error.detail["code"] == "stale_translation_source"
    assert all(t["value"] == "" for t in client.get(f"{root}/strings/{sid}").json()["translations"])


def test_apply_does_not_reveal_foreign_missing_or_deleted_sources(client):
    project = make_project(client, "Owned")
    foreign = make_project(client, "Other")
    root = f"/api/projects/{project['id']}"
    other = client.post(
        f"/api/projects/{foreign['id']}/strings", json={"key": "secret", "source_text": "Private"}
    ).json()
    deleted = client.post(
        f"{root}/strings", json={"key": "deleted", "source_text": "Deleted"}
    ).json()
    assert client.delete(f"{root}/strings/{deleted['id']}").status_code == 204
    response = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": sid,
                    "expected_source_text": "Different",
                    "translations": {"en": "Do not write"},
                }
                for sid in [other["id"], deleted["id"], str(uuid.uuid4())]
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["translated_count"] == 0


def test_proposal_source_is_bound_to_generation_snapshot(client, session_factory, monkeypatch):
    from app.schemas import TranslateRequest
    from app.services.translate import propose_translations, select_entries

    project = make_project(client)
    root = f"/api/projects/{project['id']}"
    row = client.post(f"{root}/strings", json={"key": "save", "source_text": "Lưu"}).json()
    with session_factory() as db:
        project_row = db.get(Project, uuid.UUID(project["id"]))
        entries = select_entries(db, project_row, TranslateRequest(locales=["en"]))

        def generate(source_locale, items, on_progress=None):
            assert items[0].source_text == "Lưu"
            # Even an ORM refresh during generation cannot relabel the output.
            with session_factory() as editor:
                update_string(
                    editor,
                    editor.get(Project, project_row.id),
                    uuid.UUID(row["id"]),
                    StringUpdate(source_text="Hủy"),
                )
            db.refresh(entries[0])
            return {items[0].id: {"en": "Save"}}

        monkeypatch.setattr("app.services.translate.translate_batch", generate)
        result = propose_translations(project_row, entries, ["en"], False)
        assert result[0]["source_text"] == "Lưu"
        assert result[0]["translations"] == {"en": "Save"}
