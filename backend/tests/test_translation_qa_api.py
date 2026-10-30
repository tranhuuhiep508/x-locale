"""QA integration is read-only and never gates writes or publication."""

import pytest

from app.limits import TEXT_MAX_LENGTH
from tests.helpers import make_project, publish_strings


def endpoint(client):
    project = make_project(client, "QA", targets=["en", "fr"])
    return f"/api/projects/{project['id']}", project


def test_qa_unsaved_is_read_only_and_never_calls_ai(client, monkeypatch):
    root, _ = endpoint(client)

    def forbidden(*args, **kwargs):
        raise AssertionError("QA must not call AI")

    monkeypatch.setattr("app.services.translate.translate_batch", forbidden)
    before = client.get(f"{root}/activities").json()["total"]
    response = client.post(
        f"{root}/translate/qa",
        json={
            "source_text": "Hello {name}",
            "translations": {"en": "Hello", "fr": "Bonjour {name}"},
        },
    )
    assert response.status_code == 200
    qa = response.json()["qa"]
    assert qa["en"]["issues"][0]["code"] == "placeholder_missing"
    assert qa["fr"] == {"issues": [], "complete": True}
    assert client.get(f"{root}/activities").json()["total"] == before
    assert client.get(f"{root}/strings").json()["total"] == 0
    assert client.post(
        f"{root}/translate/qa", json={"source_text": "", "translations": {"en": "Hello"}}
    ).json() == {"qa": {}}


@pytest.mark.parametrize("locale", ["vi", "de", "not-a-locale"])
def test_qa_validates_targets(client, locale):
    root, _ = endpoint(client)
    response = client.post(
        f"{root}/translate/qa", json={"source_text": "Hi", "translations": {locale: "Hello"}}
    )
    assert response.status_code == 400


def test_qa_caps_text(client):
    root, _ = endpoint(client)
    for body in [
        {"source_text": "x" * (TEXT_MAX_LENGTH + 1), "translations": {}},
        {"source_text": "x", "translations": {"en": "x" * (TEXT_MAX_LENGTH + 1)}},
    ]:
        assert client.post(f"{root}/translate/qa", json=body).status_code == 422


def test_qa_project_access(client, monkeypatch):
    from app.config import settings
    from app.database import SessionLocal
    from app.models import ProjectMember

    root, project = endpoint(client)
    body = {"source_text": "Hi", "translations": {"en": "Hello"}}
    key = client.post(f"{root}/api-keys", json={"name": "QA key"})
    assert key.status_code == 201
    # Reuse the actual API-key response contract.
    raw = key.json()["key"]
    assert (
        client.post(f"{root}/translate/qa", json=body, headers={"X-API-Key": raw}).status_code
        == 200
    )
    other = make_project(client, "Other")
    assert (
        client.post(
            f"/api/projects/{other['id']}/translate/qa", json=body, headers={"X-API-Key": raw}
        ).status_code
        == 404
    )
    with SessionLocal() as db:
        db.query(ProjectMember).filter(ProjectMember.project_id == project["id"]).delete(
            synchronize_session=False
        )
        db.commit()
    assert client.post(f"{root}/translate/qa", json=body).status_code == 404
    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    client.cookies.clear()
    assert client.post(f"{root}/translate/qa", json=body).status_code == 401


def test_saved_qa_recomputes_and_does_not_block_publish(client):
    root, project = endpoint(client)
    created = client.post(
        f"{root}/strings",
        json={"key": "hello", "source_text": "Hello {name}", "translations": {"en": "Hello"}},
    )
    assert created.status_code == 201
    entry = created.json()
    assert next(t for t in entry["translations"] if t["locale"] == "en")["qa"]["issues"]
    publish_strings(client, project["id"], [entry["id"]])
    public = client.get(f"{root}/strings/{entry['id']}").json()
    assert public["status"] == "public"
    changed = client.patch(f"{root}/strings/{entry['id']}", json={"source_text": "Hello"}).json()
    assert next(t for t in changed["translations"] if t["locale"] == "en")["qa"]["issues"] == []
    assert changed["published_source_text"] == "Hello {name}"
    updated = client.put(
        f"{root}/strings/{entry['id']}/translations/en", json={"value": "Hello {extra}"}
    )
    assert updated.status_code == 200
    assert (
        next(t for t in updated.json()["translations"] if t["locale"] == "en")["qa"]["issues"][0][
            "code"
        ]
        == "placeholder_extra"
    )
    listed = client.get(f"{root}/strings").json()["items"][0]
    assert listed["translations"] == updated.json()["translations"]


@pytest.mark.parametrize("background", [False, True])
def test_proposals_preview_and_apply_include_advisory_qa(client, monkeypatch, background):
    from app.services import translate

    root, project = endpoint(client)
    entry = client.post(
        f"{root}/strings", json={"key": "hello", "source_text": "Hello {name}"}
    ).json()

    def fake_batch(base, items, on_progress=None):
        return {item.id: {locale: "Hello" for locale in item.locales} for item in items}

    monkeypatch.setattr(translate, "translate_batch", fake_batch)
    monkeypatch.setattr(translate, "SYNC_THRESHOLD", 0 if background else 20)
    # The router imports the threshold by value.
    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0 if background else 20)
    preview = client.post(
        f"{root}/translate/preview", json={"source_text": entry["source_text"], "locales": ["en"]}
    ).json()
    response = client.post(
        f"{root}/translate/proposals",
        json={"scope": "strings", "string_ids": [entry["id"]], "locales": ["en"]},
    )
    assert response.status_code == 200
    data = response.json()
    if background:
        job = client.get(f"/api/jobs/{data['job_id']}").json()
        assert job["status"] == "completed", job
        data = job["result"]
    proposal = data["items"][0]
    assert proposal["qa"] == preview["qa"]
    assert proposal["qa"]["en"]["issues"][0]["code"] == "placeholder_missing"
    applied = client.post(
        f"{root}/translate/apply",
        json={
            "items": [
                {
                    "string_id": entry["id"],
                    "expected_source_text": entry["source_text"],
                    "translations": proposal["translations"],
                }
            ]
        },
    )
    assert applied.status_code == 200 and applied.json()["translated_count"] == 1
    publish_strings(client, project["id"], [entry["id"]])
    stored = client.get(f"{root}/strings/{entry['id']}").json()
    assert stored["status"] == "public"
    assert (
        next(t for t in stored["translations"] if t["locale"] == "en")["published_value"] == "Hello"
    )
