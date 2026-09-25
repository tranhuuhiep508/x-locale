"""Production-database migration checks, including existing data."""

from __future__ import annotations

import uuid

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.models import (
    Activity,
    ActivityAction,
    ActorType,
    ApiKey,
    EntityType,
    Module,
    Project,
    StringEntry,
    Translation,
    TranslationStatus,
)
from tests.postgres.conftest import BACKEND_ROOT, migrate

pytestmark = pytest.mark.postgres


def _previous_revision() -> str:
    script = ScriptDirectory.from_config(Config(str(BACKEND_ROOT / "alembic.ini")))
    previous = script.get_revision(script.get_current_head()).down_revision
    assert isinstance(previous, str)
    return previous


def test_fresh_migration_has_live_key_constraint(postgres_engine):
    indexes = {index["name"] for index in inspect(postgres_engine).get_indexes("strings")}
    assert "uq_project_key_alive" in indexes
    with Session(postgres_engine) as db:
        assert db.scalar(select(Project.id)) is None


def test_upgrade_from_previous_revision_preserves_catalog_and_keys(postgres_url):
    migrate(postgres_url, _previous_revision())
    from sqlalchemy import create_engine

    engine = create_engine(postgres_url)
    project_id = uuid.uuid4()
    module_id = uuid.uuid4()
    string_id = uuid.uuid4()
    key_id = uuid.uuid4()
    activity_id = uuid.uuid4()
    with Session(engine) as db:
        db.add(Project(id=project_id, name="Migration", slug="migration", base_language="vi", target_languages=["en"]))
        db.flush()
        db.add(Module(id=module_id, project_id=project_id, slug="main", name="Main"))
        db.add(ApiKey(id=key_id, project_id=project_id, name="deploy", key_prefix="xlocale_mig", key_hash="migration-test-hash"))
        db.flush()
        db.add(StringEntry(id=string_id, project_id=project_id, module_id=module_id, key="hello", source_text="Xin chào", status=TranslationStatus.public, published_key="hello", published_source_text="Xin chào"))
        db.flush()
        db.add(Translation(string_id=string_id, locale="en", value="Hello", published_value="Hello"))
        db.add(Activity(id=activity_id, project_id=project_id, actor_type=ActorType.user, actor_label="migrate@example.test", action=ActivityAction.create, entity_type=EntityType.string, entity_id=str(string_id), string_id=string_id, summary="Created hello"))
        db.commit()
    engine.dispose()

    migrate(postgres_url)
    engine = create_engine(postgres_url)
    with Session(engine) as db:
        entry = db.get(StringEntry, string_id)
        assert entry is not None
        assert entry.published_source_text == "Xin chào"
        assert entry.translations[0].published_value == "Hello"
        assert db.get(ApiKey, key_id).revoked_at is None
        assert db.get(Activity, activity_id).summary == "Created hello"
        assert db.get(Module, module_id).slug == "main"
    engine.dispose()
