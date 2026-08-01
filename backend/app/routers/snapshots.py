"""Named project snapshots + restore."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import CurrentUser, project_access
from app.database import get_db
from app.helpers import content_hash
from app.models import (
    Project,
    Snapshot,
    SnapshotKind,
    StringEntry,
    Translation,
    TranslationStatus,
    User,
)
from app.schemas import SnapshotCreate, SnapshotListOut, SnapshotOut

router = APIRouter(tags=["snapshots"])


def serialize_project_content(db: Session, project: Project) -> dict:
    entries = (
        db.query(StringEntry)
        .options(joinedload(StringEntry.translations), joinedload(StringEntry.module))
        .filter(StringEntry.project_id == project.id)
        .order_by(StringEntry.key)
        .all()
    )
    strings = []
    for e in entries:
        strings.append(
            {
                "id": str(e.id),
                "key": e.key,
                "module_id": str(e.module_id) if e.module_id else None,
                "source_text": e.source_text,
                "description": e.description,
                "translations": [
                    {
                        "locale": t.locale,
                        "value": t.value,
                        "status": t.status.value if hasattr(t.status, "value") else t.status,
                    }
                    for t in e.translations
                ],
            }
        )
    return {
        "base_language": project.base_language,
        "target_languages": project.target_languages,
        "strings": strings,
    }


def _snap_out(s: Snapshot, include_content: bool = False) -> SnapshotOut:
    return SnapshotOut(
        id=s.id,
        name=s.name,
        description=s.description,
        kind=s.kind.value if hasattr(s.kind, "value") else s.kind,
        string_count=s.string_count,
        content_hash=s.content_hash,
        created_at=s.created_at,
        content=s.content if include_content else None,
    )


@router.post("/projects/{project_id}/snapshots", response_model=SnapshotOut, status_code=201)
def create_snapshot(
    project_id: uuid.UUID,
    payload: SnapshotCreate,
    user: CurrentUser,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> SnapshotOut:
    content = serialize_project_content(db, project)
    snap = Snapshot(
        project_id=project.id,
        name=payload.name,
        description=payload.description,
        kind=SnapshotKind.manual,
        content=content,
        string_count=len(content["strings"]),
        content_hash=content_hash(content),
        created_by=user.id,
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return _snap_out(snap)


@router.get("/projects/{project_id}/snapshots", response_model=SnapshotListOut)
def list_snapshots(
    project_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> SnapshotListOut:
    items = (
        db.query(Snapshot)
        .filter(Snapshot.project_id == project.id)
        .order_by(Snapshot.created_at.desc())
        .all()
    )
    return SnapshotListOut(items=[_snap_out(s) for s in items], total=len(items))


@router.get("/projects/{project_id}/snapshots/{snapshot_id}", response_model=SnapshotOut)
def get_snapshot(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> SnapshotOut:
    snap = (
        db.query(Snapshot)
        .filter(Snapshot.id == snapshot_id, Snapshot.project_id == project.id)
        .first()
    )
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return _snap_out(snap, include_content=True)


def restore_content(db: Session, project: Project, content: dict) -> None:
    """Overwrite project content from a snapshot document."""
    desired_ids: set[uuid.UUID] = set()
    for sdata in content.get("strings", []):
        sid = uuid.UUID(sdata["id"])
        desired_ids.add(sid)
        entry = db.query(StringEntry).filter(StringEntry.id == sid).first()
        mid = sdata.get("module_id")
        module_id = uuid.UUID(mid) if mid else None
        # Validate module still exists
        if module_id:
            from app.models import Module

            if not db.query(Module).filter(Module.id == module_id).first():
                module_id = None

        if entry:
            entry.key = sdata["key"]
            entry.source_text = sdata["source_text"]
            entry.description = sdata.get("description")
            entry.module_id = module_id
        else:
            entry = StringEntry(
                id=sid,
                project_id=project.id,
                module_id=module_id,
                key=sdata["key"],
                source_text=sdata["source_text"],
                description=sdata.get("description"),
            )
            db.add(entry)
            db.flush()

        existing_locales = {t.locale: t for t in entry.translations} if entry.translations else {}
        # Ensure translations relationship is loaded for new entries
        if not entry.translations:
            entry.translations = []
            existing_locales = {}
        else:
            existing_locales = {t.locale: t for t in entry.translations}

        keep_locales = set()
        for tdata in sdata.get("translations", []):
            keep_locales.add(tdata["locale"])
            status = TranslationStatus(tdata.get("status", "draft"))
            if tdata["locale"] in existing_locales:
                t = existing_locales[tdata["locale"]]
                t.value = tdata.get("value", "")
                t.status = status
            else:
                db.add(
                    Translation(
                        string_id=entry.id,
                        locale=tdata["locale"],
                        value=tdata.get("value", ""),
                        status=status,
                    )
                )
        for locale, t in existing_locales.items():
            if locale not in keep_locales:
                db.delete(t)

    # Delete strings not in snapshot
    all_entries = db.query(StringEntry).filter(StringEntry.project_id == project.id).all()
    for entry in all_entries:
        if entry.id not in desired_ids:
            db.delete(entry)


@router.post("/projects/{project_id}/snapshots/{snapshot_id}/restore", response_model=SnapshotOut)
def restore_snapshot(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    user: CurrentUser,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> SnapshotOut:
    snap = (
        db.query(Snapshot)
        .filter(Snapshot.id == snapshot_id, Snapshot.project_id == project.id)
        .first()
    )
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Auto pre-restore snapshot
    current = serialize_project_content(db, project)
    auto = Snapshot(
        project_id=project.id,
        name=f"Auto-save before restore of {snap.name}",
        description="Automatic safety snapshot created before restore",
        kind=SnapshotKind.auto,
        content=current,
        string_count=len(current["strings"]),
        content_hash=content_hash(current),
        created_by=user.id,
    )
    db.add(auto)
    db.flush()

    batch_id = uuid.uuid4()
    existing = db.info.get("activity") or {}
    db.info["activity"] = {
        **existing,
        "batch_id": str(batch_id),
        "batch_kind": "snapshot_restore",
    }

    restore_content(db, project, snap.content)
    db.commit()
    return _snap_out(auto)


@router.delete("/projects/{project_id}/snapshots/{snapshot_id}", status_code=204)
def delete_snapshot(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    project: Project = Depends(project_access),
    db: Session = Depends(get_db),
) -> None:
    snap = (
        db.query(Snapshot)
        .filter(Snapshot.id == snapshot_id, Snapshot.project_id == project.id)
        .first()
    )
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(snap)
    db.commit()
