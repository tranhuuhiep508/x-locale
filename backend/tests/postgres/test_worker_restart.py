"""A killed worker leaves claimable work and a fresh worker completes it."""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models import Activity, Job, JobStatus, Project, StringEntry, TranslationStatus
from app.services.jobs import enqueue_job
from tests.postgres.conftest import BACKEND_ROOT

pytestmark = [pytest.mark.postgres, pytest.mark.postgres_nightly]


def test_worker_recovers_after_process_termination(postgres_engine, postgres_url):
    project_id, string_id = uuid.uuid4(), uuid.uuid4()
    with Session(postgres_engine) as db:
        db.add(Project(id=project_id, name="Worker restart", slug=f"worker-{project_id.hex}", base_language="vi", target_languages=["en"]))
        db.add(StringEntry(id=string_id, project_id=project_id, key="hello", source_text="Xin chào", status=TranslationStatus.draft))
        db.flush()
        job = enqueue_job(
            db,
            project_id=project_id,
            kind="translate",
            payload={"locales": ["en"], "overwrite": False, "batch_id": str(uuid.uuid4()), "actor": {"actor_type": "user", "actor_label": "restart test"}},
            entry_ids=[string_id],
        )
        job_id = job.id
        db.commit()

    env = {**os.environ, "DATABASE_URL": postgres_url, "AI_TRANSLATE_STUB": "true", "AI_TRANSLATE_STUB_DELAY_MS": "5000", "AUTH_DEV_BYPASS": "true", "X_LOCALE_SECRET": "worker-restart-test-secret-at-least-32"}
    command = [sys.executable, "-m", "app.worker", "--once"]
    first = subprocess.Popen(command, cwd=BACKEND_ROOT, env=env)
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with Session(postgres_engine) as db:
                if db.get(Job, job_id).status == JobStatus.running:
                    break
            time.sleep(0.1)
        else:
            pytest.fail("Worker did not claim the job")
        first.kill()
        first.wait(timeout=5)
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=5)

    with Session(postgres_engine) as db:
        job = db.get(Job, job_id)
        assert job.status == JobStatus.running
        assert job.attempts == 1
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    env["AI_TRANSLATE_STUB_DELAY_MS"] = "0"
    subprocess.run(command, cwd=BACKEND_ROOT, env=env, check=True, timeout=30)
    with Session(postgres_engine) as db:
        job = db.get(Job, job_id)
        assert job.status == JobStatus.completed
        assert job.attempts == 2
        assert job.result["translated_count"] == 1
        assert db.query(Activity).filter(Activity.project_id == project_id).count() >= 1
