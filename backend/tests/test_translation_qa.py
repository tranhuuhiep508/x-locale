"""Advisory translation QA: rules, proposal flows, and the read-only endpoint."""

from __future__ import annotations

from babel.core import Locale

from app.config import settings
from app.limits import TEXT_MAX_LENGTH
from app.services.translation_qa import MAX_NESTING, check_translation
from tests.helpers import make_project, publish_strings


def _codes(source: str, translation: str, locale: str = "en") -> list[str]:
    return [issue.code for issue in check_translation(source, translation, locale)]


def test_placeholders_compare_name_and_count():
    issues = check_translation("Hello {name} {name} %s %1$s", "Bonjour {name} %s %s", "en")
    assert [(issue.code, issue.detail["token"], issue.detail["source_count"], issue.detail["translation_count"]) for issue in issues] == [
        ("placeholder_missing", "%1$s", 1, 0),
        ("placeholder_extra", "%s", 1, 2),
        ("placeholder_missing", "{name}", 2, 1),
    ]
    assert all(issue.severity == "error" for issue in issues)
    assert check_translation("'{name}'", "'{name}'", "en") == []
    assert _codes("{name}", "'{name}'") == ["placeholder_missing"]
    assert _codes("{count, plural, other {{name}}}", "{count, plural, other {x}}", "ja") == [
        "placeholder_missing"
    ]


def test_icu_invalid_syntax():
    issues = check_translation("Hello {name}", "Hello {name", "en")
    assert [issue.code for issue in issues] == ["icu_syntax"]
    assert issues[0].severity == "error"
    assert issues[0].start == 11
    assert issues[0].detail["side"] == "translation"
    assert "EXPECT_ARGUMENT_CLOSING_BRACE" in issues[0].message


def test_icu_missing_other_branch():
    plural = check_translation(
        "{count, plural, one {# item} other {# items}}",
        "{count, plural, one {# élément}}",
        "en",
    )
    assert [(issue.code, issue.detail["kind"], issue.detail["name"]) for issue in plural] == [
        ("icu_other", "plural", "count")
    ]
    select = check_translation(
        "{gender, select, male {he} other {they}}",
        "{gender, select, male {il}}",
        "en",
    )
    assert [(issue.code, issue.detail["kind"]) for issue in select] == [("icu_other", "select")]


def test_icu_variable_names_match_source():
    issues = check_translation(
        "{count, plural, one {#} other {#}} {gender, select, other {they}}",
        "{n, plural, one {#} other {#}} {g, select, other {they}}",
        "en",
    )
    assert [
        (issue.detail["kind"], issue.detail["name"], issue.detail["translation_count"])
        for issue in issues
    ] == [
        ("plural", "count", 0),
        ("plural", "n", 1),
        ("select", "g", 1),
        ("select", "gender", 0),
    ]
    assert {issue.code for issue in issues} == {"icu_variable"}


def test_icu_plural_categories_come_from_babel():
    source = "{count, plural, one {#} other {#}}"
    only_other = "{count, plural, other {#}}"
    for locale in ("ru", "ar"):
        missing = {
            issue.detail["category"]
            for issue in check_translation(source, only_other, locale)
            if issue.code == "icu_plural"
        }
        assert missing == set(Locale.parse(locale).plural_form.tags)
    complete = "{count, plural, one {#} few {#} many {#} other {#}}"
    assert "icu_plural" not in _codes(source, complete, "ru")
    ordinal = "{n, selectordinal, other {#th}}"
    missing_ordinal = {
        issue.detail["category"]
        for issue in check_translation(ordinal, ordinal, "en")
        if issue.code == "icu_plural"
    }
    assert missing_ordinal == set(Locale.parse("en").ordinal_form.tags)
    assert _codes(only_other, only_other, "zz") == []


def test_html_markup():
    broken = check_translation("<b>Hi</b>", "<b>Hi</i>", "en")
    assert broken[0].code == "html_broken"
    assert broken[0].severity == "error"
    assert "does not match" in broken[0].message
    missing = check_translation("<b>Hi</b>", "Hi", "en")
    assert missing[0].code == "html_mismatch"
    assert missing[0].detail == {"tag": "b", "source_count": 1, "translation_count": 0}
    extra = check_translation("Hi", "<i>Hi</i>", "en")
    assert extra[0].detail["tag"] == "i"
    assert extra[0].detail["translation_count"] == 1
    assert check_translation("a<br>b", "a<br/>b", "en") == []
    dropped = check_translation(
        '<a href="{url}">Save {name}</a>',
        '<a href="{url}">Sauver</a>',
        "fr",
    )
    assert [issue.code for issue in dropped] == ["placeholder_missing"]
    assert dropped[0].detail["token"] == "{name}"


def test_length_is_a_warning():
    assert check_translation("Hi", "x" * 42, "en") == []
    issues = check_translation("Hi", "x" * 43, "en")
    assert [(issue.code, issue.severity, issue.detail) for issue in issues] == [
        ("length", "warning", {"length": 43, "limit": 42})
    ]


def test_qa_refuses_oversized_or_deeply_nested_input():
    oversized = check_translation("x" * (TEXT_MAX_LENGTH + 1), "y", "en")
    assert [issue.code for issue in oversized] == ["qa_limit"]
    assert oversized[0].severity == "warning"
    deep = check_translation("{" * (MAX_NESTING + 1), "ok", "en")
    assert [issue.code for issue in deep] == ["qa_limit"]
    assert deep[0].detail["limit"] == MAX_NESTING


def _return(text: str):
    def fake_batch(source_locale, items, on_progress=None):
        return {item.id: {locale: text for locale in item.locales} for item in items}

    return fake_batch


def test_batch_proposals_include_qa(client, monkeypatch):
    project = make_project(client, "QA batch", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hello {name}"},
    ).json()
    monkeypatch.setattr("app.services.translate.translate_batch", _return("Hello"))
    body = client.post(f"/api/projects/{pid}/translate/proposals", json={"locales": ["en"]}).json()
    assert body["job_id"] is None
    item = body["items"][0]
    assert item["string_id"] == created["id"]
    assert item["translations"]["en"] == "Hello"
    assert item["issues"]["en"][0]["code"] == "placeholder_missing"
    stored = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert all(row["value"] == "" for row in stored["translations"])


def test_retranslate_proposals_include_qa(client, monkeypatch):
    project = make_project(client, "QA retranslate", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hello {name}", "translations": {"en": "Hello"}},
    ).json()
    monkeypatch.setattr("app.services.translate.translate_batch", _return("Hi"))
    body = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"], "overwrite": True},
    ).json()
    assert body["items"][0]["translations"]["en"] == "Hi"
    assert body["items"][0]["issues"]["en"][0]["code"] == "placeholder_missing"
    stored = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert next(row["value"] for row in stored["translations"] if row["locale"] == "en") == "Hello"


def test_single_string_preview_includes_qa(client, monkeypatch):
    project = make_project(client, "QA preview", targets=["en"])
    pid = project["id"]
    monkeypatch.setattr("app.services.translate.translate_batch", _return("Hello"))
    before = client.get(f"/api/projects/{pid}/activities").json()["total"]
    body = client.post(
        f"/api/projects/{pid}/translate/preview",
        json={"source_text": "Hello {name}", "locales": ["en"]},
    ).json()
    assert body["translations"]["en"] == "Hello"
    issue = body["issues"]["en"][0]
    assert issue["code"] == "placeholder_missing"
    assert set(issue) == {"code", "severity", "message", "start", "end", "detail"}
    assert client.get(f"/api/projects/{pid}/activities").json()["total"] == before


def test_proposal_job_includes_qa(client, session_factory, monkeypatch):
    project = make_project(client, "QA job", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hello {name}"},
    ).json()
    monkeypatch.setattr("app.services.translate.SessionLocal", session_factory)
    monkeypatch.setattr("app.services.translate.translate_batch", _return("Hello"))
    monkeypatch.setattr("app.routers.translate.SYNC_THRESHOLD", 0)
    response = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"]},
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/jobs/{response.json()['job_id']}").json()
    assert job["status"] == "completed", job
    assert job["result"]["items"][0]["issues"]["en"][0]["code"] == "placeholder_missing"


def test_qa_does_not_block_save_apply_or_publish(client, monkeypatch):
    project = make_project(client, "QA advisory", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hello {name}"},
    ).json()
    monkeypatch.setattr("app.services.translate.translate_batch", _return("Hello"))

    proposals = client.post(
        f"/api/projects/{pid}/translate/proposals",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"]},
    ).json()
    assert proposals["items"][0]["issues"]["en"][0]["severity"] == "error"
    applied = client.post(
        f"/api/projects/{pid}/translate/apply",
        json={
            "items": [
                {
                    "string_id": created["id"],
                    "expected_source_text": "Hello {name}",
                    "translations": {"en": "Hello"},
                }
            ]
        },
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["translated_count"] == 1

    saved = client.patch(
        f"/api/projects/{pid}/strings/{created['id']}",
        json={"translations": {"en": "Hi"}},
    )
    assert saved.status_code == 200, saved.text
    direct = client.post(
        f"/api/projects/{pid}/translate",
        json={"scope": "strings", "string_ids": [created["id"]], "locales": ["en"], "overwrite": True},
    )
    assert direct.status_code == 200, direct.text
    assert direct.json()["translated_count"] == 1
    published = publish_strings(client, pid, [created["id"]])
    assert published["affected"] == 1
    stored = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert stored["status"] == "public"
    assert next(row["value"] for row in stored["translations"] if row["locale"] == "en") == "Hello"


def test_qa_endpoint_is_read_only_and_checks_access(client, monkeypatch):
    project = make_project(client, "QA endpoint", targets=["en"])
    other = make_project(client, "QA other", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hello {name}"},
    ).json()
    path = f"/api/projects/{pid}/translate/qa"
    body = {"source_text": "Hello {name}", "translation": "Hello", "locale": "en"}
    before = client.get(f"/api/projects/{pid}/activities").json()["total"]

    checked = client.post(path, json=body)
    assert checked.status_code == 200, checked.text
    issue = checked.json()["issues"][0]
    assert issue["code"] == "placeholder_missing"
    assert issue["severity"] == "error"
    assert set(issue) == {"code", "severity", "message", "start", "end", "detail"}
    clean = client.post(path, json={**body, "translation": "Bonjour {name}"})
    assert clean.status_code == 200, clean.text
    assert clean.json()["issues"] == []
    assert client.get(f"/api/projects/{pid}/activities").json()["total"] == before
    stored = client.get(f"/api/projects/{pid}/strings/{created['id']}").json()
    assert all(row["value"] == "" for row in stored["translations"])

    assert client.post(path, json={**body, "locale": "vi"}).status_code == 400
    assert client.post(path, json={**body, "locale": "fr"}).status_code == 400

    key = client.post(f"/api/projects/{pid}/api-keys", json={"name": "qa"})
    assert key.status_code == 201, key.text
    headers = {"X-API-Key": key.json()["key"]}
    client.cookies.clear()
    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, json=body, headers=headers).status_code == 200
    assert client.post(f"/api/projects/{other['id']}/translate/qa", json=body, headers=headers).status_code == 404
    assert client.post("/api/projects/not-found/translate/qa", json=body, headers=headers).status_code == 404


def test_catalog_and_missing_list_do_not_run_qa(client, monkeypatch):
    project = make_project(client, "QA catalog", targets=["en", "ja"])
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "hi", "source_text": "Hello {name}", "translations": {"en": "Hello"}},
    )

    def fail_batch(*args, **kwargs):
        raise AssertionError("listing missing strings must not translate or run QA")

    monkeypatch.setattr("app.services.translate.translate_batch", fail_batch)
    listed = client.get(f"/api/projects/{pid}/strings").json()["items"][0]
    assert "issues" not in listed
    assert all("issues" not in row for row in listed["translations"])
    missing = client.post(f"/api/projects/{pid}/translate/missing", json={"locales": ["en", "ja"]}).json()
    assert missing["items"]
    assert all(item["issues"] == {} for item in missing["items"])
    assert missing["items"][0]["translations"]["ja"] == ""
