"""XLOCALE-35: string module_id must belong to the same project."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from alembic.config import Config
from sqlalchemy import MetaData, Table, create_engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.pool import StaticPool

from alembic import command
from app.config import settings
from app.database import Base, enable_sqlite_foreign_keys
from app.models import (
    Activity,
    ActivityAction,
    ActorType,
    EntityType,
    Module,
    Project,
    StringEntry,
    TranslationStatus,
)
from app.services.activities import apply_revert, revert_activity
from app.services.catalog import scrub_foreign_module_refs, to_module_out
from app.services.strings import serialize_string
from app.services.sync import build_modular_export
from tests.helpers import make_project, publish_strings

FOREIGN_SLUG = "secret-b"


def _projects_and_modules(client):
    project_a = make_project(client, "Project A")
    project_b = make_project(client, "Project B")
    module_a = client.post(
        f"/api/projects/{project_a['id']}/modules",
        json={"slug": "auth", "name": "Auth"},
    ).json()
    module_b = client.post(
        f"/api/projects/{project_b['id']}/modules",
        json={"slug": FOREIGN_SLUG, "name": "Secret"},
    ).json()
    return project_a, project_b, module_a, module_b


def _string_in(client, project_id, module_id, key="login"):
    created = client.post(
        f"/api/projects/{project_id}/strings",
        json={"key": key, "source_text": "Đăng nhập", "module_id": module_id},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["module_slug"] == "auth"
    assert FOREIGN_SLUG not in created.text
    return body


def test_create_rejects_foreign_and_unknown_module(client):
    project_a, _, module_a, module_b = _projects_and_modules(client)
    pid = project_a["id"]

    foreign = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "login", "source_text": "Đăng nhập", "module_id": module_b["id"]},
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "Unknown module"
    assert FOREIGN_SLUG not in foreign.text

    unknown = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "login", "source_text": "Đăng nhập", "module_id": str(uuid.uuid4())},
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["detail"] == "Unknown module"

    listed = client.get(f"/api/projects/{pid}/strings").json()
    assert listed["total"] == 0
    assert all(item["module_slug"] != FOREIGN_SLUG for item in listed["items"])
    assert all(item["module_id"] != module_b["id"] for item in listed["items"])

    own = _string_in(client, pid, module_a["id"])
    assert own["module_id"] == module_a["id"]


def test_update_rejects_foreign_module_and_keeps_string_out(client):
    project_a, _, module_a, module_b = _projects_and_modules(client)
    pid = project_a["id"]
    created = _string_in(client, pid, module_a["id"])

    foreign = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"module_id": module_b["id"]},
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "Unknown module"
    assert FOREIGN_SLUG not in foreign.text

    unknown = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"module_id": str(uuid.uuid4())},
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["detail"] == "Unknown module"

    row = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert row["module_id"] == module_a["id"]
    assert row["module_slug"] == "auth"
    assert row["module_slug"] != FOREIGN_SLUG


def test_move_module_rejects_foreign_module_and_keeps_string_out(client):
    project_a, _, module_a, module_b = _projects_and_modules(client)
    pid = project_a["id"]
    created = _string_in(client, pid, module_a["id"])

    foreign = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [created["id"]],
            "payload": {"module_id": module_b["id"]},
        },
    )
    assert foreign.status_code == 400, foreign.text
    assert foreign.json()["detail"] == "Unknown module"
    assert FOREIGN_SLUG not in foreign.text

    unknown = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [created["id"]],
            "payload": {"module_id": str(uuid.uuid4())},
        },
    )
    assert unknown.status_code == 400, unknown.text
    assert unknown.json()["detail"] == "Unknown module"

    row = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert row["module_id"] == module_a["id"]
    assert row["module_slug"] == "auth"
    assert row["module_slug"] != FOREIGN_SLUG


def test_null_module_id_still_allowed_on_create_update_and_move(client):
    project_a, _, module_a, _ = _projects_and_modules(client)
    pid = project_a["id"]

    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "plain", "source_text": "Xin chào", "module_id": None},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["module_id"] is None
    assert body["module_slug"] is None

    assigned = _string_in(client, pid, module_a["id"], key="login")
    cleared = client.patch(
        f"/api/projects/{pid}/strings/{assigned['id']}",
        json={"module_id": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["module_id"] is None
    assert cleared.json()["module_slug"] is None

    again = _string_in(client, pid, module_a["id"], key="again")
    moved = client.post(
        f"/api/projects/{pid}/strings/batch",
        json={
            "action": "move_module",
            "string_ids": [again["id"]],
            "payload": {"module_id": None},
        },
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["affected"] == 1
    row = client.get(f"/api/projects/{pid}/strings/{again['id']}").json()
    assert row["module_id"] is None
    assert row["module_slug"] is None


def test_to_module_out_counts_only_strings_in_the_module_project():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        project_a = Project(
            name="A",
            slug="project-a",
            base_language="vi",
            target_languages=["en"],
        )
        project_b = Project(
            name="B",
            slug="project-b",
            base_language="vi",
            target_languages=["en"],
        )
        module_a = Module(project=project_a, slug="auth", name="Auth")
        db.add_all([project_a, project_b, module_a])
        db.flush()

        db.add_all(
            [
                StringEntry(
                    project_id=project_a.id,
                    module_id=module_a.id,
                    key="own",
                    source_text="Own",
                    status=TranslationStatus.draft,
                ),
                StringEntry(
                    project_id=project_b.id,
                    module_id=module_a.id,
                    key="leak",
                    source_text="Leak",
                    status=TranslationStatus.draft,
                ),
                StringEntry(
                    project_id=project_a.id,
                    module_id=module_a.id,
                    key="gone",
                    source_text="Gone",
                    status=TranslationStatus.draft,
                    deleted_at=datetime.now(UTC),
                ),
            ]
        )
        db.commit()
        db.refresh(module_a)

        out = to_module_out(db, module_a)
        assert out.string_count == 1
        assert out.slug == "auth"


def test_module_crud_still_404s_for_another_project(client):
    project_a, project_b, _, module_b = _projects_and_modules(client)
    foreign_id = module_b["id"]

    listed = client.get(f"/api/projects/{project_a['id']}/modules").json()
    assert FOREIGN_SLUG not in {row["slug"] for row in listed}

    patched = client.patch(
        f"/api/projects/{project_a['id']}/modules/{foreign_id}",
        json={"name": "Hijack"},
    )
    assert patched.status_code == 404, patched.text
    assert patched.json()["detail"] == "Module not found"

    deleted = client.delete(f"/api/projects/{project_a['id']}/modules/{foreign_id}")
    assert deleted.status_code == 404, deleted.text

    still_there = client.get(f"/api/projects/{project_b['id']}/modules").json()
    assert any(row["id"] == foreign_id and row["slug"] == FOREIGN_SLUG for row in still_there)


def test_delete_module_clears_working_and_published_module(client):
    project_a, _, module_a, _ = _projects_and_modules(client)
    pid = project_a["id"]
    created = _string_in(client, pid, module_a["id"])
    publish_strings(client, pid, [created["id"]])

    deleted = client.delete(f"/api/projects/{pid}/modules/{module_a['id']}")
    assert deleted.status_code == 204, deleted.text

    row = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert row["module_id"] is None
    assert row["module_slug"] is None
    assert row["published_module_id"] is None
    assert row["published_module_slug"] is None


def _project_pair(db: Session):
    project_a = Project(name="A", slug="project-a", base_language="vi", target_languages=["en"])
    project_b = Project(name="B", slug="project-b", base_language="vi", target_languages=["en"])
    module_a = Module(project=project_a, slug="auth", name="Auth")
    module_b = Module(project=project_b, slug=FOREIGN_SLUG, name="Secret")
    db.add_all([project_a, project_b, module_a, module_b])
    db.flush()
    return project_a, project_b, module_a, module_b


def _fk_engine():
    engine = create_engine("sqlite://")
    event.listen(engine, "connect", enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    return engine


def test_serialize_string_hides_foreign_module_slug():
    engine = _fk_engine()
    with Session(engine) as db:
        project_a, _, module_a, module_b = _project_pair(db)
        entry = StringEntry(
            project_id=project_a.id,
            module_id=module_a.id,
            published_module_id=module_a.id,
            key="login",
            source_text="Đăng nhập",
            status=TranslationStatus.draft,
        )
        db.add(entry)
        db.commit()
        entry = (
            db.query(StringEntry)
            .options(
                joinedload(StringEntry.module),
                joinedload(StringEntry.published_module),
                joinedload(StringEntry.translations),
                joinedload(StringEntry.tags),
            )
            .one()
        )
        db.refresh(module_b)
        with db.no_autoflush:
            entry.module = module_b
            entry.published_module = module_b
            out = serialize_string(entry)
        dumped = out.model_dump_json()
        assert out.module_id is None
        assert out.module_slug is None
        assert out.published_module_id is None
        assert out.published_module_slug is None
        assert FOREIGN_SLUG not in dumped
        assert str(module_b.id) not in dumped


def test_modular_export_orm_rows_omit_foreign_module_slug():
    engine = _fk_engine()
    with Session(engine) as db:
        project_a, _, module_a, module_b = _project_pair(db)
        own = StringEntry(
            project_id=project_a.id,
            module_id=module_a.id,
            published_module_id=module_a.id,
            key="own",
            source_text="Own",
            published_key="own",
            published_source_text="Own",
            status=TranslationStatus.public,
        )
        foreign = StringEntry(
            project_id=project_a.id,
            module_id=module_a.id,
            published_module_id=module_a.id,
            key="leak",
            source_text="Leak",
            published_key="leak",
            published_source_text="Leak",
            status=TranslationStatus.public,
        )
        db.add_all([own, foreign])
        db.commit()
        db.refresh(module_b)
        own.translations = []
        foreign.translations = []
        with db.no_autoflush:
            foreign.module = module_b
            foreign.published_module = module_b
            draft = build_modular_export(project_a, [own, foreign], "draft")
            public = build_modular_export(project_a, [own, foreign], "public")

    assert "auth" in draft["modules"]
    assert "own" in draft["modules"]["auth"]["vi"]
    assert FOREIGN_SLUG not in draft["modules"]
    assert "leak" in draft["unassigned"]["vi"]
    assert FOREIGN_SLUG not in draft["manifest"]["modules"]

    assert "auth" in public["modules"]
    assert "own" in public["modules"]["auth"]["vi"]
    assert FOREIGN_SLUG not in public["modules"]
    assert "leak" in public["unassigned"]["vi"]
    assert FOREIGN_SLUG not in public["manifest"]["modules"]


def test_database_rejects_cross_project_module_refs():
    engine = _fk_engine()
    with Session(engine) as db:
        project_a, _, module_a, module_b = _project_pair(db)
        db.add(
            StringEntry(
                project_id=project_a.id,
                module_id=module_a.id,
                key="ok",
                source_text="Ok",
                status=TranslationStatus.draft,
            )
        )
        db.commit()

        db.add(
            StringEntry(
                project_id=project_a.id,
                module_id=module_b.id,
                key="foreign-working",
                source_text="Nope",
                status=TranslationStatus.draft,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        db.add(
            StringEntry(
                project_id=project_a.id,
                published_module_id=module_b.id,
                key="foreign-published",
                source_text="Nope",
                status=TranslationStatus.draft,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        kept = db.scalars(select(StringEntry.key)).all()
        assert kept == ["ok"]


def test_scrub_clears_foreign_module_refs():
    engine = create_engine("sqlite://", poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk_off(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.close()

    Base.metadata.create_all(engine)
    with Session(engine) as db:
        project_a, _, _, module_b = _project_pair(db)
        entry = StringEntry(
            project_id=project_a.id,
            module_id=module_b.id,
            published_module_id=module_b.id,
            key="leak",
            source_text="Leak",
            status=TranslationStatus.draft,
        )
        db.add(entry)
        db.commit()
        scrub_foreign_module_refs(db.connection())
        db.commit()
        db.refresh(entry)
        assert entry.module_id is None
        assert entry.published_module_id is None

        out = serialize_string(entry)
        assert out.module_slug is None
        assert out.published_module_slug is None
        assert FOREIGN_SLUG not in out.model_dump_json()


def test_revert_clears_foreign_module_and_restores_same_project_module():
    engine = _fk_engine()
    with Session(engine) as db:
        project_a, _, module_a, module_b = _project_pair(db)
        entry = StringEntry(
            project_id=project_a.id,
            module_id=module_a.id,
            published_module_id=module_a.id,
            key="login",
            source_text="Đăng nhập",
            status=TranslationStatus.draft,
        )
        db.add(entry)
        db.flush()
        foreign = Activity(
            project_id=project_a.id,
            actor_type=ActorType.user,
            actor_label="tester",
            action=ActivityAction.update,
            entity_type=EntityType.string,
            entity_id=str(entry.id),
            string_id=entry.id,
            before={
                "module_id": str(module_b.id),
                "published_module_id": str(module_b.id),
            },
            after={
                "module_id": str(module_a.id),
                "published_module_id": str(module_a.id),
            },
            event_type="string.updated",
            summary="Moved module",
            is_revertible=True,
        )
        db.add(foreign)
        db.commit()

        revert_activity(db, project_a, foreign.id)
        reloaded = (
            db.query(StringEntry)
            .options(
                joinedload(StringEntry.module),
                joinedload(StringEntry.published_module),
                joinedload(StringEntry.translations),
                joinedload(StringEntry.tags),
            )
            .filter(StringEntry.id == entry.id)
            .one()
        )
        assert reloaded.module_id is None
        assert reloaded.published_module_id is None
        out = serialize_string(reloaded)
        assert out.module_id is None
        assert out.module_slug is None
        assert out.published_module_id is None
        assert out.published_module_slug is None
        assert FOREIGN_SLUG not in out.model_dump_json()
        assert str(module_b.id) not in out.model_dump_json()

        restored_id = uuid.uuid4()
        recreate = Activity(
            project_id=project_a.id,
            actor_type=ActorType.user,
            actor_label="tester",
            action=ActivityAction.delete,
            entity_type=EntityType.string,
            entity_id=str(restored_id),
            string_id=restored_id,
            before={
                "id": str(restored_id),
                "project_id": str(project_a.id),
                "key": "from-delete",
                "source_text": "Back",
                "status": "draft",
                "module_id": str(module_a.id),
                "published_module_id": str(module_a.id),
            },
            after=None,
            event_type="string.deleted",
            summary="Deleted",
            is_revertible=True,
        )
        db.add(recreate)
        db.commit()
        apply_revert(db, recreate)
        db.commit()
        brought_back = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.module), joinedload(StringEntry.published_module))
            .filter(StringEntry.id == restored_id)
            .one()
        )
        assert brought_back.module_id == module_a.id
        assert brought_back.published_module_id == module_a.id
        restored_out = serialize_string(brought_back)
        assert restored_out.module_slug == "auth"
        assert restored_out.published_module_slug == "auth"
        assert FOREIGN_SLUG not in restored_out.model_dump_json()


def test_migration_scrubs_foreign_modules_then_enforces(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migrate.db'}"
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "k0f16d7e8f9a")

    engine = create_engine(url)
    event.listen(engine, "connect", enable_sqlite_foreign_keys)
    # Seed the historical schema through reflected tables, independent of new ORM columns.
    metadata = MetaData()
    projects = Table("projects", metadata, autoload_with=engine)
    modules = Table("modules", metadata, autoload_with=engine)
    strings = Table("strings", metadata, autoload_with=engine)
    project_a_id, project_b_id, module_a_id, module_b_id = [uuid.uuid4() for _ in range(4)]
    with engine.begin() as connection:
        for pid, name in [(project_a_id, "A"), (project_b_id, "B")]:
            connection.execute(projects.insert().values(
                id=pid.hex, name=name, slug=f"project-{name.lower()}",
                base_language="vi", target_languages=["en"], layout="flat",
            ))
        for mid, pid, slug in [(module_a_id, project_a_id, "auth"), (module_b_id, project_b_id, FOREIGN_SLUG)]:
            connection.execute(modules.insert().values(
                id=mid.hex, project_id=pid.hex, slug=slug, name=slug, position=0,
            ))
        for key, mid, published_mid, status in [
            ("leak", module_b_id, module_b_id.hex, "public"),
            ("keep", module_a_id, None, "draft"),
        ]:
            connection.execute(strings.insert().values(
                id=uuid.uuid4().hex, project_id=project_a_id.hex, module_id=mid.hex,
                published_module_id=published_mid, key=key, source_text=key, status=status,
                pending_delete=False,
            ))

    command.upgrade(cfg, "head")

    with Session(engine) as db:
        leaked = db.scalar(select(StringEntry).where(StringEntry.key == "leak"))
        assert leaked is not None
        assert leaked.module_id is None
        assert leaked.published_module_id is None
        kept = db.scalar(select(StringEntry).where(StringEntry.key == "keep"))
        assert kept is not None
        assert kept.module_id == module_a_id

        db.add(
            StringEntry(
                project_id=project_a_id,
                module_id=module_b_id,
                key="again",
                source_text="Again",
                status=TranslationStatus.draft,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    with engine.connect() as conn:
        index_sql = conn.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE name = 'uq_project_key_alive'"
        ).scalar()
    assert index_sql
    assert "deleted_at" in index_sql.lower()
