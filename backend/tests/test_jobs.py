"""Persisted job targets and recovery after an interrupted worker."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import sessionmaker

from app.models import Job, JobStatus, JobTarget, StringEntry
from app.services import jobs, translate
from tests.helpers import make_project


def _session_factory(client):
    from app.database import get_db
    from app.main import app

    db = next(app.dependency_overrides[get_db]())
    bind = db.get_bind()
    db.close()
    return sessionmaker(bind=bind, autoflush=False, autocommit=False)


def test_job_targets_survive_expired_lease_and_worker_retry(client, monkeypatch):
    project_id = make_project(client, "Job Recovery")["id"]
    created = client.post(
        f"/api/projects/{project_id}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
    ).json()
    string_id = uuid.UUID(created["id"])
    maker = _session_factory(client)
    monkeypatch.setattr(jobs, "SessionLocal", maker)
    monkeypatch.setattr(translate, "SessionLocal", maker)

    with maker() as db:
        job = jobs.enqueue_job(
            db,
            project_id=uuid.UUID(project_id),
            kind="translate",
            payload={
                "locales": ["en"],
                "overwrite": False,
                "actor": {"actor_type": "user", "actor_label": "test"},
                "batch_id": str(uuid.uuid4()),
            },
            entry_ids=[string_id],
        )
        job_id = job.id
        db.commit()

    with maker() as db:
        claimed = jobs.claim_job(db, "dead-worker", job_id)
        assert claimed is not None
        assert claimed.status == JobStatus.running
        assert db.query(JobTarget).filter(JobTarget.job_id == job_id).count() == 1
        claimed.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    def fake_batch(source_locale, items, on_progress=None):
        return {item.id: {"en": "Hello"} for item in items}

    monkeypatch.setattr(translate, "translate_batch", fake_batch)
    assert jobs.process_job(job_id) is True
    with maker() as db:
        finished = db.get(Job, job_id)
        assert finished.status == JobStatus.completed
        assert finished.attempts == 2
        assert finished.result["translated_count"] == 1
        entry = db.get(StringEntry, string_id)
        assert entry.translations[0].value == "Hello"
        assert entry.status.value == "draft"


def test_job_stops_after_three_interrupted_attempts(client):
    project_id = make_project(client, "Job Retry Limit")["id"]
    maker = _session_factory(client)
    with maker() as db:
        job = jobs.enqueue_job(
            db,
            project_id=uuid.UUID(project_id),
            kind="translate_proposals",
            payload={"locales": ["en"], "overwrite": False},
            entry_ids=[],
        )
        job_id = job.id
        db.commit()
    for attempt in range(3):
        with maker() as db:
            claimed = jobs.claim_job(db, f"worker-{attempt}", job_id)
            assert claimed is not None
            claimed.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            db.commit()
    with maker() as db:
        assert jobs.claim_job(db, "fourth", job_id) is None
        assert db.get(Job, job_id).status == JobStatus.failed
