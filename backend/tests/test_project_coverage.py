"""Working-copy coverage parity and a query budget independent of locale count."""

import uuid

import pytest
from sqlalchemy import event

from app.config import settings
from app.database import get_db
from app.main import app
from app.models import Project
from app.services.strings import project_coverage
from tests.helpers import make_project

LOCALES = [
    "en",
    "ja",
    "fr",
    "de",
    "es",
    "it",
    "pt",
    "ru",
    "ko",
    "zh",
    "ar",
    "hi",
    "nl",
    "sv",
    "no",
    "da",
    "fi",
    "pl",
    "cs",
    "tr",
    "uk",
    "ro",
    "hu",
    "id",
    "th",
    "he",
    "el",
    "sk",
    "ms",
    "bg",
]


def create_string(client, project, key, **fields):
    response = client.post(
        f"/api/projects/{project['id']}/strings",
        json={"key": key, "source_text": key, **fields},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_coverage_matches_catalog_working_copy_filters(client):
    project = make_project(client, targets=["ja", "en", "fr"])
    ref = project["id"]
    create_string(client, project, "draft", translations={"en": " Hello ", "ja": ""})
    published = create_string(
        client, project, "published", status="public", translations={"en": "Hello", "ja": "はい"}
    )
    # The published English snapshot remains filled; coverage reads the now-empty working copy.
    response = client.patch(
        f"/api/projects/{ref}/strings/{published['id']}",
        json={"translations": {"en": "   "}},
    )
    assert response.status_code == 200, response.text
    pending = create_string(client, project, "pending", status="public", translations={"en": "Bye"})
    deleted = create_string(client, project, "deleted", translations={"en": "Hidden", "ja": "隠す"})
    for entry in (pending, deleted):
        assert client.delete(f"/api/projects/{ref}/strings/{entry['id']}").status_code == 204
    other = make_project(client, name="Other")
    create_string(client, other, "unrelated", translations={"en": "Other"})

    response = client.get(f"/api/projects/{ref}/coverage")
    assert response.status_code == 200, response.text
    coverage = response.json()
    assert coverage == {
        "total": 3,
        "locales": [
            {"locale": "ja", "translated": 1, "missing": 2},
            {"locale": "en", "translated": 2, "missing": 1},
            {"locale": "fr", "translated": 0, "missing": 3},
        ],
    }
    assert client.get(f"/api/projects/{project['slug']}/coverage").json() == coverage
    for row in coverage["locales"]:
        missing = client.get(
            f"/api/projects/{ref}/strings", params={"missing_locale": row["locale"]}
        )
        complete = client.get(
            f"/api/projects/{ref}/strings", params={"complete_locale": row["locale"]}
        )
        assert missing.status_code == complete.status_code == 200
        assert missing.json()["total"] == row["missing"]
        assert complete.json()["total"] == row["translated"]


@pytest.mark.parametrize("targets", [[], ["en", "ja"]])
def test_empty_project_coverage(client, targets):
    response = client.post(
        "/api/projects", json={"name": "Empty", "base_language": "vi", "target_languages": targets}
    )
    assert response.status_code == 201, response.text
    result = client.get(f"/api/projects/{response.json()['id']}/coverage")
    assert result.status_code == 200
    assert result.json() == {
        "total": 0,
        "locales": [{"locale": locale, "translated": 0, "missing": 0} for locale in targets],
    }


@pytest.mark.parametrize("locale_count", [1, 30])
def test_coverage_uses_two_aggregate_queries_for_any_locale_count(client, locale_count):
    locales = LOCALES[:locale_count]
    project = make_project(client, targets=locales)
    create_string(client, project, "hello", translations={locale: "Hello" for locale in locales})
    session = app.dependency_overrides[get_db]()
    db = next(session)
    statements = []

    def record_query(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    try:
        loaded_project = db.get(Project, uuid.UUID(project["id"]))
        engine = db.get_bind()
        event.listen(engine, "before_cursor_execute", record_query)
        try:
            result = project_coverage(db, loaded_project)
        finally:
            event.remove(engine, "before_cursor_execute", record_query)
        assert len(statements) == 2
        assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
        assert result.total == 1
        assert len(result.locales) == locale_count
        assert all(row.translated == 1 and row.missing == 0 for row in result.locales)
    finally:
        session.close()


def test_coverage_requires_auth_and_scopes_api_keys_to_the_project(client, monkeypatch):
    project = make_project(client)
    other = make_project(client, name="Other")
    key = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "Coverage"})
    assert key.status_code == 201, key.text
    headers = {"X-API-Key": key.json()["key"]}
    client.cookies.clear()
    monkeypatch.setattr(settings, "auth_dev_bypass", False)

    assert client.get(f"/api/projects/{project['id']}/coverage").status_code == 401
    assert (
        client.get(f"/api/projects/{project['slug']}/coverage", headers=headers).status_code == 200
    )
    assert client.get(f"/api/projects/{other['id']}/coverage", headers=headers).status_code == 404
    assert client.get("/api/projects/not-found/coverage", headers=headers).status_code == 404
