"""XLOCALE-39: editor context, AI composition, and runtime boundaries."""

from __future__ import annotations

import io
import uuid

import pytest
from alembic.config import Config
from openpyxl import load_workbook
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.ai import TranslateItem, _build_prompt, _item_payload
from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models import Module, Project, StringEntry
from app.services import translate as translate_service
from app.services.translate import _load_entries_by_ids, compose_translation_context, work_items
from tests.helpers import make_project, publish_strings


def _module(client, pid, slug="auth", context="Module instructions"):
    response = client.post(
        f"/api/projects/{pid}/modules",
        json={
            "slug": slug,
            "name": slug,
            "description": "Module description",
            "translation_context": context,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _catalog(client):
    project = make_project(client)
    pid = project["id"]
    response = client.patch(
        f"/api/projects/{pid}", json={"translation_context": " Project instructions "}
    )
    assert response.status_code == 200, response.text
    modules = [_module(client, pid), _module(client, pid, "home", "Home instructions")]
    strings = []
    for index, module in enumerate([*modules, None]):
        response = client.post(
            f"/api/projects/{pid}/strings",
            json={
                "key": f"key{index}",
                "source_text": "Xin chào",
                "module_id": module["id"] if module else None,
                "description": f"String {index}",
            },
        )
        assert response.status_code == 201, response.text
        strings.append(response.json())
    return project, modules, strings


@pytest.mark.parametrize("kind", ["project", "module"])
def test_context_patch_preserve_clear_and_length(client, kind):
    project = make_project(client)
    pid = project["id"]
    if kind == "module":
        module = _module(client, pid, context=None)
        assert module["translation_context"] is None
        url = f"/api/projects/{pid}/modules/{module['id']}"
    else:
        url = f"/api/projects/{pid}"
        assert client.get(url).json()["translation_context"] is None

    for value in ["  Friendly tone\nKeep names  ", "x" * 500]:
        response = client.patch(url, json={"translation_context": value})
        assert response.status_code == 200, response.text
        assert response.json()["translation_context"] == value.strip()
    response = client.patch(url, json={"name": "Renamed"})
    assert response.json()["translation_context"] == "x" * 500
    if kind == "module":
        assert response.json()["description"] == "Module description"
    for value in ["x" * 501, " " * 501]:
        assert client.patch(url, json={"translation_context": value}).status_code == 422
    for value in [None, "", " \n\t "]:
        client.patch(url, json={"translation_context": "Restore me"})
        response = client.patch(url, json={"translation_context": value})
        assert response.status_code == 200, response.text
        assert response.json()["translation_context"] is None


def test_module_creation_normalizes_and_validates_context(client):
    pid = make_project(client)["id"]
    assert (
        _module(client, pid, "trimmed", "  Notes\nmore  ")["translation_context"] == "Notes\nmore"
    )
    assert _module(client, pid, "blank", " \n ")["translation_context"] is None
    assert _module(client, pid, "limit", "x" * 500)["translation_context"] == "x" * 500
    response = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "long", "name": "Long", "translation_context": "x" * 501},
    )
    assert response.status_code == 422
    listed = client.get(f"/api/projects/{pid}/modules").json()
    assert len(listed) == 3
    assert listed[0]["description"] == "Module description"


@pytest.mark.parametrize("value", [None, "", " \n\t ", "  Project notes  ", "x" * 500])
def test_project_creation_saves_context_atomically(client, value):
    response = client.post(
        "/api/projects",
        json={
            "name": "New project",
            "base_language": "vi",
            "target_languages": ["en"],
            "layout": "modular",
            "translation_context": value,
        },
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert "translation_context" not in created
    detail = client.get(f"/api/projects/{created['id']}").json()
    assert detail["translation_context"] == ((value or "").strip() or None)
    assert detail["base_language"] == "vi"
    assert detail["target_languages"] == ["en"]
    assert detail["layout"] == "modular"
    assert "translation_context" not in client.get("/api/projects").json()[0]


@pytest.mark.parametrize("value", ["x" * 501, " " * 501])
def test_project_creation_rejects_oversized_context_without_creating_project(client, value):
    response = client.post(
        "/api/projects", json={"name": "Invalid project", "translation_context": value}
    )
    assert response.status_code == 422
    assert client.get("/api/projects").json() == []


def test_project_context_is_detail_only_in_responses_and_openapi(client):
    project = make_project(client)
    pid = project["id"]
    assert "translation_context" not in project
    assert (
        client.patch(f"/api/projects/{pid}", json={"translation_context": "Project notes"}).json()[
            "translation_context"
        ]
        == "Project notes"
    )
    assert (
        client.get(f"/api/projects/{project['slug']}").json()["translation_context"]
        == "Project notes"
    )
    assert "translation_context" not in client.get("/api/projects").json()[0]
    key = client.post(f"/api/projects/{pid}/api-keys", json={"name": "CLI"}).json()["key"]
    assert (
        "translation_context" not in client.get("/api/bootstrap", headers={"X-API-Key": key}).json()
    )
    assert client.patch(f"/api/projects/{pid}", json={"unknown_setting": "bad"}).status_code == 422

    schema = client.get("/openapi.json").json()
    schemas = schema["components"]["schemas"]
    assert "translation_context" not in schemas["ProjectSummaryOut"]["properties"]
    assert "translation_context" in schemas["ProjectCreate"]["properties"]
    assert "translation_context" in schemas["ProjectOut"]["properties"]
    assert (
        schemas["ProjectUpdate"]["properties"]["translation_context"]["anyOf"][0]["maxLength"]
        == 500
    )
    for path, method in [("/api/projects", "post"), ("/api/bootstrap", "get")]:
        status = "201" if method == "post" else "200"
        response = schema["paths"][path][method]["responses"][status]["content"][
            "application/json"
        ]["schema"]
        assert response["$ref"].endswith("/ProjectSummaryOut")
    summary_list = schema["paths"]["/api/projects"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert summary_list["items"]["$ref"].endswith("/ProjectSummaryOut")


@pytest.mark.parametrize("project_text", [None, " \n ", " Project "])
@pytest.mark.parametrize("module_text", [None, " \t ", " Module "])
@pytest.mark.parametrize("description", [None, " \n ", " String "])
def test_composer_layer_combinations(project_text, module_text, description):
    pid = uuid.uuid4()
    project = Project(id=pid, translation_context=project_text)
    module = Module(project_id=pid, translation_context=module_text)
    expected = (
        "\n".join(v.strip() for v in [project_text, module_text, description] if v and v.strip())
        or None
    )
    assert compose_translation_context(project, module, description) == expected


def test_composer_skips_unassigned_and_foreign_modules_without_truncation():
    project = Project(id=uuid.uuid4(), translation_context="p" * 500)
    foreign = Module(project_id=uuid.uuid4(), translation_context="Private instructions")
    assert compose_translation_context(project, None, "String") == "p" * 500 + "\nString"
    assert compose_translation_context(project, foreign, "String") == "p" * 500 + "\nString"
    owned = Module(project_id=project.id, translation_context="m" * 500)
    assert len(compose_translation_context(project, owned, "s" * 700)) == 1702


@pytest.mark.parametrize("route", ["translate", "translate/proposals"])
@pytest.mark.parametrize("background", [False, True])
def test_translation_routes_compose_context_and_jobs(client, monkeypatch, route, background):
    project, _, strings = _catalog(client)
    pid = project["id"]
    db_generator = app.dependency_overrides[get_db]()
    db = next(db_generator)
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    db_generator.close()
    monkeypatch.setattr("app.services.translate.SessionLocal", factory)
    if background:
        monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)

    captured = []

    def fake_batch(source_locale, items, on_progress=None):
        assert source_locale == "vi"
        captured.extend(items)
        return {item.id: {locale: "Hello" for locale in item.locales} for item in items}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    proposals = route.endswith("proposals")
    body = {"scope": "strings", "string_ids": [s["id"] for s in strings]}
    if proposals:
        body["descriptions"] = {strings[0]["id"]: " Override ", strings[1]["id"]: " \n "}
    response = client.post(f"/api/projects/{pid}/{route}", json=body)
    assert response.status_code == 200, response.text
    contexts = {item.id: item.context for item in captured}
    assert contexts == {
        strings[0]["id"]: "Project instructions\nModule instructions\n"
        + ("Override" if proposals else "String 0"),
        strings[1]["id"]: "Project instructions\nHome instructions"
        + ("" if proposals else "\nString 1"),
        strings[2]["id"]: "Project instructions\nString 2",
    }
    result = response.json()
    if background:
        job = client.get(f"/api/jobs/{result['job_id']}").json()
        assert job["status"] == "completed"
        result = job["result"]
    if proposals:
        descriptions = {item["string_id"]: item["description"] for item in result["items"]}
        assert descriptions == {
            strings[0]["id"]: "Override",
            strings[1]["id"]: None,
            strings[2]["id"]: "String 2",
        }
    else:
        assert result["translated_count"] == 3
    for index, string in enumerate(strings):
        stored = client.get(f"/api/projects/{pid}/strings/{string['id']}").json()
        assert stored["description"] == f"String {index}"
        assert stored["status"] == "draft"
        assert stored["published_at"] is None
        assert stored["translations"][0]["value"] == ("" if proposals else "Hello")


@pytest.mark.parametrize("module_selection", ["owned", "unassigned", "omitted"])
def test_preview_composes_context_without_persistence(client, monkeypatch, module_selection):
    project, modules, strings = _catalog(client)
    pid = project["id"]
    captured = []

    def fake_batch(source_locale, items, on_progress=None):
        captured.extend(items)
        return {"preview": {"en": "Hello"}}

    monkeypatch.setattr("app.services.translate.translate_batch", fake_batch)
    body = {"source_text": "Xin chào", "description": " Unsaved description "}
    if module_selection != "omitted":
        body["module_id"] = modules[0]["id"] if module_selection == "owned" else None
    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    response = client.post(f"/api/projects/{pid}/translate/preview", json=body)
    assert response.status_code == 200, response.text
    assert (
        captured[0].context
        == "Project instructions\n"
        + ("Module instructions\n" if module_selection == "owned" else "")
        + "Unsaved description"
    )
    assert client.get(f"/api/projects/{pid}/activities").json()["total"] == before
    assert (
        client.get(f"/api/projects/{pid}/strings/{strings[0]['id']}").json()["description"]
        == "String 0"
    )


def test_preview_rejects_unknown_foreign_and_invalid_modules_before_ai(client, monkeypatch):
    pid = make_project(client)["id"]
    foreign = _module(client, make_project(client, "Other project")["id"])

    def fail_batch(*args, **kwargs):
        raise AssertionError("AI must not run for an invalid module")

    monkeypatch.setattr("app.services.translate.translate_batch", fail_batch)
    for module_id in [foreign["id"], str(uuid.uuid4())]:
        response = client.post(
            f"/api/projects/{pid}/translate/preview",
            json={"source_text": "Text", "module_id": module_id},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "Unknown module"
    assert (
        client.post(
            f"/api/projects/{pid}/translate/preview",
            json={"source_text": "Text", "module_id": "invalid"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize("proposals", [False, True])
def test_queued_jobs_read_context_at_execution_time(client, monkeypatch, proposals):
    project, modules, strings = _catalog(client)
    pid = project["id"]
    db_generator = app.dependency_overrides[get_db]()
    db = next(db_generator)
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    db_generator.close()
    monkeypatch.setattr(translate_service, "SessionLocal", factory)
    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    queued = []
    worker_name = "run_propose_job" if proposals else "run_translate_job"
    monkeypatch.setattr(f"app.routers.translate.{worker_name}", lambda *args: queued.append(args))
    route = "translate/proposals" if proposals else "translate"
    response = client.post(
        f"/api/projects/{pid}/{route}",
        json={
            "scope": "strings",
            "string_ids": [strings[0]["id"]],
            "descriptions": {strings[0]["id"]: "Unsaved description"},
        },
    )
    assert response.status_code == 200, response.text
    client.patch(f"/api/projects/{pid}", json={"translation_context": "Updated project context"})
    client.patch(
        f"/api/projects/{pid}/modules/{modules[0]['id']}",
        json={"translation_context": "Updated module context"},
    )
    captured = []

    def fake_batch(source_locale, items, on_progress=None):
        captured.extend(items)
        return {item.id: {"en": "Hello"} for item in items}

    monkeypatch.setattr(translate_service, "translate_batch", fake_batch)
    getattr(translate_service, worker_name)(*queued[0])
    assert captured[0].context == "Updated project context\nUpdated module context\n" + (
        "Unsaved description" if proposals else "String 0"
    )
    job = client.get(f"/api/jobs/{response.json()['job_id']}").json()
    assert job["status"] == "completed"


def test_missing_and_apply_never_invoke_ai_or_persist_composed_description(client, monkeypatch):
    project, _, strings = _catalog(client)
    pid = project["id"]

    def fail_batch(*args, **kwargs):
        raise AssertionError("Missing and apply must not call AI")

    monkeypatch.setattr(translate_service, "translate_batch", fail_batch)
    missing = client.post(f"/api/projects/{pid}/translate/missing", json={"scope": "missing"})
    assert missing.status_code == 200
    assert {item["description"] for item in missing.json()["items"]} == {
        "String 0",
        "String 1",
        "String 2",
    }
    applied = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": strings[0]["id"],
                    "description": " Only string notes ",
                    "translations": {"en": "Hello"},
                }
            ]
        },
    )
    assert applied.status_code == 200, applied.text
    stored = client.get(f"/api/projects/{pid}/strings/{strings[0]['id']}").json()
    assert stored["description"] == "Only string notes"
    assert stored["status"] == "draft"


def test_eager_loading_mixed_modules_avoids_lazy_queries():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        project = Project(name="Test", slug="test", translation_context="Project")
        db.add(project)
        db.flush()
        ids = []
        for index in range(6):
            module = Module(
                project_id=project.id,
                slug=f"mod{index}",
                name="Module",
                translation_context=f"Module {index}",
            )
            entry = StringEntry(
                project_id=project.id, module=module, key=f"key{index}", source_text="Text"
            )
            db.add(entry)
            db.flush()
            ids.append(entry.id)
        db.commit()
        pid = project.id
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    with Session(engine) as db:
        project = db.get(Project, pid)
        event.listen(engine, "before_cursor_execute", record)
        try:
            entries = _load_entries_by_ids(db, ids)
            items = work_items(project, entries, ["en"], False)
            assert [item.context for item in items] == [f"Project\nModule {i}" for i in range(6)]
            assert len(statements) == 1
        finally:
            event.remove(engine, "before_cursor_execute", record)
    engine.dispose()


def test_empty_context_prompt_unchanged_and_composed_notes_are_mandatory():
    project = Project(id=uuid.uuid4(), translation_context=" \n ")
    context = compose_translation_context(project, None, None)
    original = TranslateItem("id", "Text", ("en",))
    assert _build_prompt("vi", [TranslateItem("id", "Text", ("en",), context)]) == _build_prompt(
        "vi", [original]
    )
    project.translation_context = "Friendly tone"
    item = TranslateItem(
        "id", "Text", ("en",), compose_translation_context(project, None, "Keep names")
    )
    assert _item_payload(item)["instructions"] == "Friendly tone\nKeep names"
    assert "Mandatory translator notes (override a literal translation):" in _build_prompt(
        "vi", [item]
    )


def test_context_edits_leave_exports_sync_excel_and_published_snapshots_unchanged(client):
    project, modules, strings = _catalog(client)
    pid = project["id"]
    publish_strings(client, pid, [s["id"] for s in strings])
    endpoints = [f"/api/projects/{pid}/export?stage={stage}" for stage in ["draft", "public"]]
    endpoints.append(f"/api/projects/{pid}/sync-state")
    before = {url: client.get(url).json() for url in endpoints}
    published = [client.get(f"/api/projects/{pid}/strings/{s['id']}").json() for s in strings]

    def excel_meta():
        response = client.get(f"/api/projects/{pid}/export?format=xlsx")
        assert response.status_code == 200, response.text
        workbook = load_workbook(io.BytesIO(response.content))
        return list(workbook["_meta"].values)

    metadata = excel_meta()
    client.patch(f"/api/projects/{pid}", json={"translation_context": "New project instructions"})
    client.patch(
        f"/api/projects/{pid}/modules/{modules[0]['id']}",
        json={"translation_context": "New module instructions"},
    )
    assert {url: client.get(url).json() for url in endpoints} == before
    assert excel_meta() == metadata
    assert [
        client.get(f"/api/projects/{pid}/strings/{s['id']}").json() for s in strings
    ] == published


def test_context_migration_upgrade_downgrade_reupgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    monkeypatch.setattr(settings, "database_url", url)
    config = Config("alembic.ini")
    command.upgrade(config, "m2d49a0b1234")
    engine = create_engine(url)
    pid, mid = uuid.uuid4().hex, uuid.uuid4().hex
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO projects (id, name, slug, base_language, target_languages, layout) "
                "VALUES (:id, 'Existing', 'existing', 'vi', '[\"en\"]', 'flat')"
            ),
            {"id": pid},
        )
        connection.execute(
            text(
                "INSERT INTO modules (id, project_id, slug, name, description, position) "
                "VALUES (:id, :pid, 'auth', 'Auth', 'Keep description', 0)"
            ),
            {"id": mid, "pid": pid},
        )
    command.upgrade(config, "head")
    with engine.begin() as connection:
        for table in ["projects", "modules"]:
            assert (
                connection.execute(text(f"SELECT translation_context FROM {table}")).scalar()
                is None
            )
            connection.execute(text(f"UPDATE {table} SET translation_context = 'Instructions'"))
    command.downgrade(config, "m2d49a0b1234")
    for table in ["projects", "modules"]:
        assert "translation_context" not in {
            column["name"] for column in inspect(engine).get_columns(table)
        }
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT name, translation_context FROM projects")).one() == (
            "Existing",
            None,
        )
        assert connection.execute(
            text("SELECT description, translation_context FROM modules")
        ).one() == ("Keep description", None)
    engine.dispose()
