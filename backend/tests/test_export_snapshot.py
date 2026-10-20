"""JSON exports must not mix content from concurrent commits."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import delete, event

from app.models import Translation
from app.services.sync import load_export_rows
from tests.helpers import make_project, publish_strings


@pytest.mark.parametrize("layout", ["flat", "modular", "compat"])
def test_public_export_keeps_one_snapshot_during_publish(client, database_engine, layout):
    project = make_project(client, "Export Snapshot")
    root = f"/api/projects/{project['id']}"
    module = client.post(f"{root}/modules", json={"slug": "common", "name": "Common"})
    assert module.status_code == 201, module.text
    created = client.post(
        f"{root}/strings",
        json={
            "key": "greeting",
            "module_id": module.json()["id"],
            "source_text": "Old source",
            "translations": {"en": "Old target"},
        },
    )
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    publish_strings(client, project["id"], [sid])
    edited = client.patch(
        f"{root}/strings/{sid}",
        json={"source_text": "New source", "translations": {"en": "New target"}},
    )
    assert edited.status_code == 200, edited.text

    strings_read = Event()
    resume_export = Event()

    def pause_after_strings(_conn, _cursor, statement, _params, _context, _many):
        if (
            not strings_read.is_set()
            and statement.lstrip().startswith("SELECT")
            and "strings.published_source_text" in statement
            and "\nFROM strings" in statement
        ):
            strings_read.set()
            assert resume_export.wait(10), "export was not resumed"

    url = f"{root}/translations.json" if layout == "compat" else f"{root}/export"
    params = {"stage": "public"}
    if layout != "compat":
        params["layout"] = layout

    event.listen(database_engine, "after_cursor_execute", pause_after_strings)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            export = pool.submit(client.get, url, params=params)
            try:
                assert strings_read.wait(10), "export did not read strings"
                publish_strings(client, project["id"], [sid])
            finally:
                resume_export.set()
            response = export.result(timeout=10)
    finally:
        event.remove(database_engine, "after_cursor_execute", pause_after_strings)

    assert response.status_code == 200, response.text
    old = response.json()
    if layout == "modular":
        old = old["modules"]["common"]
    assert old == {"vi": {"greeting": "Old source"}, "en": {"greeting": "Old target"}}

    response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    new = response.json()
    if layout == "modular":
        new = new["modules"]["common"]
    assert new == {"vi": {"greeting": "New source"}, "en": {"greeting": "New target"}}


@pytest.mark.parametrize("locales", [[], ["en"], ["en", "fr"]])
def test_export_loader_uses_one_query_without_dropping_strings(
    client, database_engine, session_factory, locales
):
    project = make_project(client, "Export Rows", targets=["en", "fr"])
    root = f"/api/projects/{project['id']}"
    for key, translations in [("a", {"en": "Hello", "fr": "Bonjour"}), ("b", {})]:
        response = client.post(
            f"{root}/strings",
            json={"key": key, "source_text": key, "translations": translations},
        )
        assert response.status_code == 201, response.text

    # Creation preallocates empty target rows; remove them to exercise the outer join.
    with session_factory() as db:
        db.execute(
            delete(Translation).where(Translation.string_id == uuid.UUID(response.json()["id"]))
        )
        db.commit()

    statements = []

    def observe(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    with session_factory() as db:
        event.listen(database_engine, "before_cursor_execute", observe)
        try:
            rows = load_export_rows(db, uuid.UUID(project["id"]), locales)
        finally:
            event.remove(database_engine, "before_cursor_execute", observe)

    assert len(statements) == 1
    assert [row.key for row in rows] == ["a", "b"]
    expected = {"en": "Hello", "fr": "Bonjour"}
    assert {t.locale: t.value for t in rows[0].translations} == {
        locale: expected[locale] for locale in locales
    }
    assert rows[1].translations == []
    assert ("JOIN translations" in statements[0]) == bool(locales)
