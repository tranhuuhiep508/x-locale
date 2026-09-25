"""PostgreSQL transaction behavior that SQLite cannot establish."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Project, StringEntry, Translation, TranslationStatus
from app.schemas import BatchRequest, StringCreate, TranslationUpdate
from app.services import strings as service

pytestmark = pytest.mark.postgres


def _catalog(engine, *, published: bool = False):
    project_id, string_id = uuid.uuid4(), uuid.uuid4()
    with Session(engine) as db:
        db.add(Project(id=project_id, name="Concurrent", slug=f"concurrent-{project_id.hex}", base_language="vi", target_languages=["en"]))
        db.flush()
        entry = StringEntry(
            id=string_id,
            project_id=project_id,
            key="hello",
            source_text="Xin chào",
            status=TranslationStatus.public if published else TranslationStatus.draft,
            published_key="hello" if published else None,
            published_source_text="Xin chào" if published else None,
        )
        db.add(entry)
        db.flush()
        db.add(Translation(string_id=string_id, locale="en", value="Hello", published_value="Hello" if published else None))
        db.commit()
    return project_id, string_id


def _fingerprint(engine, project_id, string_id):
    with Session(engine) as db:
        return service.compute_publish_fingerprint(
            service.load_string_entries(db, project_id, [string_id])
        )


def test_edit_after_preview_causes_conflict(postgres_engine):
    project_id, string_id = _catalog(postgres_engine)
    fingerprint = _fingerprint(postgres_engine, project_id, string_id)
    with Session(postgres_engine) as db:
        project = db.get(Project, project_id)
        service.upsert_translation(db, project, string_id, "en", TranslationUpdate(value="Hi"))

    with Session(postgres_engine) as db:
        project = db.get(Project, project_id)
        with pytest.raises(HTTPException) as error:
            service.apply_batch(
                db,
                project,
                BatchRequest(action="publish", string_ids=[string_id], fingerprint=fingerprint),
            )
        assert error.value.status_code == 409
    with Session(postgres_engine) as db:
        assert db.get(StringEntry, string_id).published_key is None


def test_edit_waits_for_publish_lock_and_remains_working_copy(postgres_engine, monkeypatch):
    project_id, string_id = _catalog(postgres_engine, published=True)
    with Session(postgres_engine) as db:
        entry = db.get(StringEntry, string_id)
        entry.source_text = "Chào bạn"
        db.commit()
    fingerprint = _fingerprint(postgres_engine, project_id, string_id)
    checked = threading.Event()
    release = threading.Event()
    original = service.compute_publish_fingerprint

    def pause_after_check(entries):
        result = original(entries)
        checked.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(service, "compute_publish_fingerprint", pause_after_check)

    def publish():
        with Session(postgres_engine) as db:
            project = db.get(Project, project_id)
            return service.apply_batch(
                db,
                project,
                BatchRequest(action="publish", string_ids=[string_id], fingerprint=fingerprint),
            )

    def edit():
        with Session(postgres_engine) as db:
            project = db.get(Project, project_id)
            return service.upsert_translation(
                db, project, string_id, "en", TranslationUpdate(value="Hi after publish")
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        published = pool.submit(publish)
        assert checked.wait(10)
        edited = pool.submit(edit)
        try:
            with pytest.raises(TimeoutError):
                edited.result(timeout=0.2)
        finally:
            release.set()
        assert published.result(timeout=15).affected == 1
        edited.result(timeout=15)

    with Session(postgres_engine) as db:
        entry = service.get_string(db, project_id, string_id)
        assert entry.published_source_text == "Chào bạn"
        assert entry.translations[0].published_value == "Hello"
        assert entry.translations[0].value == "Hi after publish"
        assert service.has_unpublished_changes(entry)


def test_simultaneous_create_returns_conflict_not_server_error(postgres_engine, monkeypatch):
    project_id, _ = _catalog(postgres_engine)
    barrier = threading.Barrier(2)
    original = service.validate_locales

    def synchronize(project, translations):
        original(project, translations)
        barrier.wait(timeout=10)

    monkeypatch.setattr(service, "validate_locales", synchronize)

    def create():
        with Session(postgres_engine) as db:
            project = db.get(Project, project_id)
            try:
                service.create_string(db, project, StringCreate(key="same", source_text="Same"))
                return 201
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [pool.submit(create) for _ in range(2)]
        assert sorted(future.result(timeout=15) for future in results) == [201, 409]


def test_delete_after_publish_queues_removal(postgres_engine):
    project_id, string_id = _catalog(postgres_engine)
    fingerprint = _fingerprint(postgres_engine, project_id, string_id)
    with Session(postgres_engine) as db:
        project = db.get(Project, project_id)
        service.apply_batch(
            db,
            project,
            BatchRequest(action="publish", string_ids=[string_id], fingerprint=fingerprint),
        )
    with Session(postgres_engine) as db:
        project = db.get(Project, project_id)
        service.delete_string(db, project, string_id)
    with Session(postgres_engine) as db:
        entry = db.get(StringEntry, string_id)
        assert entry.pending_delete is True
        assert entry.deleted_at is None
        assert entry.published_key == "hello"


def test_concurrent_delete_waits_for_publish_then_queues_removal(postgres_engine, monkeypatch):
    project_id, string_id = _catalog(postgres_engine)
    fingerprint = _fingerprint(postgres_engine, project_id, string_id)
    checked = threading.Event()
    release = threading.Event()
    original = service.compute_publish_fingerprint

    def pause_after_check(entries):
        result = original(entries)
        checked.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(service, "compute_publish_fingerprint", pause_after_check)

    def publish():
        with Session(postgres_engine) as db:
            return service.apply_batch(
                db,
                db.get(Project, project_id),
                BatchRequest(action="publish", string_ids=[string_id], fingerprint=fingerprint),
            )

    def delete():
        with Session(postgres_engine) as db:
            service.delete_string(db, db.get(Project, project_id), string_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        published = pool.submit(publish)
        assert checked.wait(10)
        deleted = pool.submit(delete)
        try:
            with pytest.raises(TimeoutError):
                deleted.result(timeout=0.2)
        finally:
            release.set()
        published.result(timeout=15)
        deleted.result(timeout=15)
    with Session(postgres_engine) as db:
        entry = db.get(StringEntry, string_id)
        assert entry.pending_delete is True
        assert entry.deleted_at is None
        assert entry.published_key == "hello"
