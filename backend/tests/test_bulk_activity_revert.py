"""Compare set-based undo with the pre-optimization ordered executor."""

import uuid
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from enum import Enum

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.activity import attach_batch
from app.models import Activity, Module, Project, StringEntry, Tag, Translation, User
from app.services import activities, activity_bulk
from app.services.activity_state import SnapshotReferences
from benchmarks.undo import ACTOR, engine_for, seed


def reference_undo(db, project, batch, force):
    rows = db.scalars(
        select(Activity).where(Activity.batch_id == batch).order_by(*activities._inverse_order())
    ).all()
    new_batch = uuid.uuid4()
    existing = attach_batch(db, new_batch, "revert")
    references = SnapshotReferences(
        db,
        project.id,
        [snap for row in rows for snap in (row.before, row.after)],
        lock_modules=True,
    )
    for row in rows:
        before, after = activities._execute_inverse(db, row, force=force, references=references)
        marker = activities._make_revert_marker(
            db,
            project_id=project.id,
            activity=row,
            existing=existing,
            batch_id=new_batch,
            before=before,
            after=after,
        )
        db.add(marker)
        db.flush()
        row.reverted_by_id = marker.id
    db.commit()
    return {"reverted": len(rows), "batch_id": str(new_batch)}


def prepare_case(engine, batch, scenario):
    with Session(engine, autoflush=False) as db:
        db.info["activity"] = {**ACTOR, "batch_kind": "revert"}
        rows = db.scalars(
            select(Activity)
            .where(Activity.batch_id == batch)
            .order_by(Activity.created_at, Activity.id)
        ).all()
        entry = db.get(StringEntry, uuid.UUID(rows[0].entity_id))
        for translation in db.scalars(select(Translation)):
            translation.confidence = 80
        if scenario == "unchanged":
            for row in rows:
                row.before = deepcopy(row.after)
        elif scenario in {"repeated", "round_trip"}:
            row = rows[0]
            original = activities._live_snapshot(entry)
            if scenario == "round_trip":
                row.before = deepcopy(row.after)
                mid = deepcopy(row.after)
                mid["source_text"] = "Intermediate"
                mid["translations"]["en"] = "Intermediate"
                row.after = mid
            else:
                entry.source_text = "A4"
                entry.translations[0].value = "Later translation"
            later = Activity(
                project_id=entry.project_id,
                actor_type="user",
                actor_label="Benchmark",
                action="update",
                entity_type="string",
                entity_id=str(entry.id),
                string_id=entry.id,
                before=deepcopy(row.after),
                after=original if scenario == "round_trip" else activities._live_snapshot(entry),
                batch_id=batch,
                batch_kind="import",
                is_revertible=True,
                created_at=rows[-1].created_at + timedelta(seconds=1),
            )
            db.add(later)
        elif scenario == "key_release":
            row = rows[0]
            entry.key = "renamed"
            row.after = activities._live_snapshot(entry)
            db.flush()
            other = db.get(StringEntry, uuid.UUID(rows[1].entity_id))
            # This creation must be undone before the rename can reclaim bench.0.
            other.key, other.status = "bench.0", "draft"
            other.published_key = other.published_module_id = other.published_source_text = None
            other.published_at = None
            rows[1].action, rows[1].before = "create", None
            rows[1].after = activities._live_snapshot(other)
        elif scenario in {"recreate", "recreate_uppercase_id"}:
            rows[0].action, rows[0].after = "delete", None
            if scenario == "recreate_uppercase_id":
                rows[0].entity_id = rows[0].entity_id.upper()
            db.delete(entry)
        elif scenario in {"create_public", "create_draft"}:
            if scenario == "create_draft":
                entry.published_key = entry.published_module_id = entry.published_source_text = None
                entry.published_at, entry.status = None, "draft"
            rows[0].action, rows[0].before = "create", None
            rows[0].after = activities._live_snapshot(entry)
        elif scenario == "references":
            for module in db.scalars(select(Module)):
                db.delete(module)
            for tag in db.scalars(select(Tag)):
                db.delete(tag)
        elif scenario == "locales":
            before = deepcopy(rows[0].before)
            before["translations"]["vi"] = "Restored new locale"
            before["published_translations"]["vi"] = "Published new locale"
            rows[0].before = before
            db.add(Translation(string_id=entry.id, locale="nl", value="", confidence=91))
        elif scenario == "legacy":
            translation = entry.translations[0]
            rows[0].entity_type, rows[0].entity_id = "translation", str(translation.id)
            rows[0].before = {
                "id": str(translation.id),
                "string_id": str(entry.id),
                "locale": translation.locale,
                "value": "Legacy restored",
            }
            rows[0].after = {"value": translation.value, "locale": translation.locale}
        db.commit()


def canonical(value, name=None):
    if name in {"created_at", "updated_at", "deleted_at"} and value is not None:
        return "<time>"
    if isinstance(value, dict):
        return {key: canonical(item, key) for key, item in value.items()}
    if isinstance(value, Enum):
        return value.value
    return value


def dump(db, result, existing_translation_ids):
    db.expire_all()
    strings = db.scalars(select(StringEntry).order_by(StringEntry.id)).all()
    translations = db.scalars(
        select(Translation).order_by(Translation.string_id, Translation.locale)
    ).all()
    audit = db.scalars(select(Activity).order_by(Activity.created_at, Activity.id)).all()
    markers = {row.id: row for row in audit if row.revert_of_id is not None}
    assert len(markers) == result["reverted"]
    assert {row.batch_id for row in markers.values()} == {uuid.UUID(result["batch_id"])}
    for row in audit:
        if row.id not in markers:
            assert markers[row.reverted_by_id].revert_of_id == row.id

    def fields(row):
        return canonical({c.name: getattr(row, c.name) for c in row.__table__.columns})

    translation_rows = []
    for row in translations:
        item = fields(row)
        if row.id not in existing_translation_ids:
            item["id"] = "<new translation>"
        translation_rows.append(item)
    return {
        "strings": [(fields(row), canonical(activities._live_snapshot(row))) for row in strings],
        "translations": translation_rows,
        "markers": sorted(
            (
                {key: value for key, value in fields(row).items() if key not in {"id", "batch_id"}}
                for row in markers.values()
            ),
            key=lambda row: str(row["revert_of_id"]),
        ),
        "marker_order": [row.revert_of_id for row in markers.values()],
        "originals": [
            {**fields(row), "reverted_by_id": markers[row.reverted_by_id].revert_of_id}
            for row in audit
            if row.id not in markers
        ],
    }


@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize(
    "scenario",
    [
        "rich",
        "unchanged",
        "repeated",
        "round_trip",
        "key_release",
        "recreate",
        "recreate_uppercase_id",
        "create_public",
        "create_draft",
        "references",
        "locales",
        "legacy",
    ],
)
def test_bulk_undo_matches_ordered_executor(throwaway_database, force, scenario):
    project_id, batch, _ = seed(throwaway_database, 3, True, force)
    engine = engine_for(throwaway_database)
    try:
        prepare_case(engine, batch, scenario)
        with Session(engine) as db:
            existing_ids = set(db.scalars(select(Translation.id)))
        outputs = []
        # Both implementations see identical persisted input; neither commits the outer transaction.
        for implementation in (reference_undo, activities.revert_batch):
            with engine.connect() as connection:
                outer = connection.begin()
                try:
                    with Session(
                        connection, autoflush=False, join_transaction_mode="create_savepoint"
                    ) as db:
                        db.info["activity"] = dict(ACTOR)
                        project = db.get(Project, project_id)
                        try:
                            result = implementation(db, project, batch, force=force)
                        except HTTPException as error:
                            db.rollback()
                            outputs.append({"status": error.status_code, "detail": error.detail})
                            assert not db.scalar(
                                select(Activity.id).where(Activity.revert_of_id.is_not(None))
                            )
                            assert not db.scalar(
                                select(Activity.id).where(Activity.reverted_by_id.is_not(None))
                            )
                        else:
                            outputs.append(dump(db, result, existing_ids))
                finally:
                    outer.rollback()
        assert outputs[0] == outputs[1]
    finally:
        engine.dispose()


@pytest.mark.parametrize("force", [False, True])
def test_key_acquired_after_planning_rolls_back_whole_bulk_write(
    throwaway_database, monkeypatch, force
):
    project_id, batch, _ = seed(throwaway_database, 2, False, force)
    engine = engine_for(throwaway_database)
    try:
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = {**ACTOR, "batch_kind": "revert"}
            entry = db.scalar(select(StringEntry).where(StringEntry.key == "bench.0"))
            entry.key = "renamed"
            original = db.scalar(select(Activity).where(Activity.string_id == entry.id))
            original.after = {**original.after, "key": "renamed"}
            db.commit()
        persist = activities._persist_revert_plan

        def competitor_wins(db, project_id, plan, **kwargs):
            with Session(engine) as other:
                other.info["activity"] = {**ACTOR, "batch_kind": "revert"}
                other.add(StringEntry(project_id=project_id, key="bench.0", source_text="Winner"))
                other.commit()
            return persist(db, project_id, plan, **kwargs)

        monkeypatch.setattr(activities, "_persist_revert_plan", competitor_wins)
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = dict(ACTOR)
            with pytest.raises(HTTPException) as raised:
                activities.revert_batch(db, db.get(Project, project_id), batch, force=force)
            assert raised.value.status_code == 409
            assert raised.value.detail == {
                "code": "key_conflict",
                "message": "Key 'bench.0' is already used by another string.",
                "key": "bench.0",
            }
        with Session(engine) as db:
            rows = db.scalars(select(StringEntry)).all()
            assert {row.key: row.source_text for row in rows} == {
                "renamed": "A3" if force else "A2",
                "bench.1": "A3" if force else "A2",
                "bench.0": "Winner",
            }
            assert all(row.deleted_at is None for row in rows)
            assert len(db.scalars(select(Activity)).all()) == 2
            assert not db.scalar(select(Activity.id).where(Activity.reverted_by_id.is_not(None)))
            assert all(t.value.endswith("V2") for t in db.scalars(select(Translation)))
    finally:
        engine.dispose()


def test_string_removed_after_planning_returns_404_without_markers(throwaway_database, monkeypatch):
    project_id, batch, _ = seed(throwaway_database, 2, False, False)
    engine = engine_for(throwaway_database)
    persist = activities._persist_revert_plan
    try:

        def remove_string(db, project_id, plan, **kwargs):
            with Session(engine) as other:
                other.info["activity"] = {**ACTOR, "batch_kind": "revert"}
                other.delete(other.get(StringEntry, next(iter(plan.entries))))
                other.commit()
            return persist(db, project_id, plan, **kwargs)

        monkeypatch.setattr(activities, "_persist_revert_plan", remove_string)
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = dict(ACTOR)
            with pytest.raises(HTTPException) as raised:
                activities.revert_batch(db, db.get(Project, project_id), batch)
            assert raised.value.status_code == 404
            assert raised.value.detail == "String no longer exists"
        with Session(engine) as db:
            assert db.scalars(select(StringEntry.source_text)).all() == ["A2"]
            assert len(db.scalars(select(Activity)).all()) == 2
            assert not db.scalar(select(Activity.id).where(Activity.reverted_by_id.is_not(None)))
    finally:
        engine.dispose()


def test_source_only_inverse_preserves_translation_metadata(throwaway_database):
    project_id, batch, _ = seed(throwaway_database, 1, True, False)
    engine = engine_for(throwaway_database)
    old_time = datetime(2025, 1, 1, tzinfo=UTC)
    user_id = uuid.uuid4()
    try:
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = {**ACTOR, "batch_kind": "revert"}
            db.add(
                User(
                    id=user_id,
                    email="translator@example.com",
                    name="Translator",
                    oidc_issuer="test",
                    oidc_sub=str(user_id),
                )
            )
            db.flush()
            row = db.scalar(select(Activity).where(Activity.batch_id == batch))
            row.before = {**row.after, "source_text": "A1"}
            for translation in db.scalars(select(Translation)):
                translation.confidence, translation.updated_by = 87, user_id
                translation.updated_at = old_time
            db.commit()
        with Session(engine, autoflush=False) as db:
            db.info["activity"] = dict(ACTOR)
            activities.revert_batch(db, db.get(Project, project_id), batch)
            assert db.scalar(select(StringEntry.source_text)) == "A1"
            for translation in db.scalars(select(Translation)):
                assert translation.confidence == 87
                assert translation.updated_by == user_id
                assert translation.updated_at == old_time
    finally:
        engine.dispose()


@pytest.mark.parametrize("width,size,expected", [(2, 1001, [1000, 1]), (31, 1000, [967, 33])])
def test_bulk_writes_bound_rows_and_parameters(width, size, expected):
    rows = [{f"column{i}": i for i in range(width)} for _ in range(size)]
    chunks = list(activity_bulk._chunks(rows))
    assert [len(chunk) for chunk in chunks] == expected
    assert all(len(chunk) * width <= 30_000 for chunk in chunks)
