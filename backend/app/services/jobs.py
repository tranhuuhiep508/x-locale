"""Durable translation jobs claimed through the database."""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, insert, or_, select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Job, JobStatus, JobTarget

LEASE_SECONDS = 120
HEARTBEAT_SECONDS = 30
MAX_ATTEMPTS = 3
TARGET_CHUNK = 1000


def get_job(db: Session, job_id: uuid.UUID) -> Job:
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def enqueue_job(
    db: Session,
    *,
    project_id: uuid.UUID,
    kind: str,
    payload: dict,
    entry_ids: list[uuid.UUID],
) -> Job:
    job = Job(id=uuid.uuid4(), project_id=project_id, kind=kind, status=JobStatus.pending, payload=payload)
    db.add(job)
    db.flush()
    for start in range(0, len(entry_ids), TARGET_CHUNK):
        db.execute(
            insert(JobTarget),
            [
                {"job_id": job.id, "string_id": entry_id, "position": index}
                for index, entry_id in enumerate(entry_ids[start : start + TARGET_CHUNK], start)
            ],
        )
    return job


def claim_job(db: Session, owner: str, job_id: uuid.UUID | None = None) -> Job | None:
    """Atomically claim pending or expired work; SKIP LOCKED allows many workers."""
    now = datetime.now(UTC)
    query = select(Job).where(
        or_(
            Job.status == JobStatus.pending,
            and_(Job.status == JobStatus.running, Job.lease_expires_at < now),
        )
    )
    if job_id is not None:
        query = query.where(Job.id == job_id)
    job = db.execute(
        query.order_by(Job.created_at, Job.id).limit(1).with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if job is None:
        return None
    if job.attempts >= MAX_ATTEMPTS:
        job.status = JobStatus.failed
        job.error = "Worker stopped before completing the job"
        job.completed_at = now
        db.commit()
        return None
    job.status = JobStatus.running
    job.lease_owner = owner
    job.lease_expires_at = now + timedelta(seconds=LEASE_SECONDS)
    job.attempts += 1
    db.commit()
    return job


def _heartbeat(job_id: uuid.UUID, owner: str, stop: threading.Event) -> None:
    while not stop.wait(HEARTBEAT_SECONDS):
        with SessionLocal() as db:
            job = db.get(Job, job_id)
            if job is None or job.status != JobStatus.running or job.lease_owner != owner:
                return
            job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=LEASE_SECONDS)
            db.commit()


def process_job(job_id: uuid.UUID | None = None) -> bool:
    """Process one claimable job; return False when the queue is empty."""
    owner = uuid.uuid4().hex
    with SessionLocal() as db:
        job = claim_job(db, owner, job_id)
        if job is None:
            return False
        target_ids = db.scalars(
            select(JobTarget.string_id)
            .where(JobTarget.job_id == job.id)
            .order_by(JobTarget.position)
        ).all()
        payload = dict(job.payload or {})
        kind, project_id, claimed_id = job.kind, job.project_id, job.id

    stop = threading.Event()
    heartbeat = threading.Thread(target=_heartbeat, args=(claimed_id, owner, stop), daemon=True)
    heartbeat.start()
    try:
        from app.services.translate import run_propose_job, run_translate_job

        locales = payload.get("locales") or []
        overwrite = bool(payload.get("overwrite"))
        if kind == "translate":
            run_translate_job(
                project_id,
                target_ids,
                locales,
                overwrite,
                uuid.UUID(payload["batch_id"]),
                claimed_id,
            )
        elif kind == "translate_proposals":
            run_propose_job(
                project_id,
                target_ids,
                locales,
                overwrite,
                claimed_id,
                payload.get("descriptions"),
            )
        else:
            with SessionLocal() as db:
                job = db.get(Job, claimed_id)
                job.status = JobStatus.failed
                job.error = f"Unknown job kind: {kind}"
                job.completed_at = datetime.now(UTC)
                db.commit()
    finally:
        stop.set()
        heartbeat.join(timeout=1)
    return True
