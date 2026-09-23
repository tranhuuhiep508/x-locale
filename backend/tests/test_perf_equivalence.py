"""Characterization snapshots for the safe performance refactors.

Locks export JSON, sync-state, translations.json, import results, activity
before/after rows, and publish-preview items. Ids and timestamps are rewritten
to stable tokens so the snapshots survive a fresh SQLite database. Translation
and tag list order is normalized because those collections have no defined
order.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

from tests.helpers import json_upload, make_project, preview_publish, publish_strings

GOLDEN = Path(__file__).parent / "fixtures" / "perf_equivalence_golden.json"
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_TS = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]")


def _session():
    from app.database import get_db
    from app.main import app

    gen = app.dependency_overrides[get_db]()
    return gen, next(gen)


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _as_uuid(value: str | uuid.UUID) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _id_map(db, project_id: str) -> dict[str, str]:
    from app.models import Module, StringEntry, Tag, Translation

    project_uuid = _as_uuid(project_id)
    mapping = {str(project_uuid): "project"}
    for module in db.query(Module).filter(Module.project_id == project_uuid):
        mapping[str(module.id)] = f"module:{module.slug}"
    for tag in db.query(Tag).filter(Tag.project_id == project_uuid):
        mapping[str(tag.id)] = f"tag:{tag.name}"
    entries = {
        entry.id: entry.key
        for entry in db.query(StringEntry).filter(StringEntry.project_id == project_uuid)
    }
    for entry_id, key in entries.items():
        mapping[str(entry_id)] = f"string:{key}"
    for translation in (
        db.query(Translation).filter(Translation.string_id.in_(list(entries))).all()
    ):
        mapping[str(translation.id)] = (
            f"translation:{entries[translation.string_id]}:{translation.locale}"
        )
    return mapping


def _stabilize(value, mapping: dict[str, str]):
    if isinstance(value, dict):
        out = {key: _stabilize(item, mapping) for key, item in value.items()}
        translations = out.get("translations")
        if isinstance(translations, list):
            out["translations"] = sorted(
                translations, key=lambda item: json.dumps(item, sort_keys=True)
            )
        tags = out.get("tags")
        if isinstance(tags, list):
            out["tags"] = sorted(tags, key=lambda item: json.dumps(item, sort_keys=True))
        return out
    if isinstance(value, list):
        return [_stabilize(item, mapping) for item in value]
    if isinstance(value, str):
        if value in mapping:
            return mapping[value]
        if _UUID.match(value):
            raise AssertionError(f"unstabilized uuid {value}")
        if _TS.match(value):
            return "<timestamp>"
    return value


def _activities(project_id: str, batch_id: str | None) -> list[dict]:
    from app.models import Activity

    gen, db = _session()
    try:
        mapping = _id_map(db, project_id)
        query = db.query(Activity).filter(Activity.project_id == _as_uuid(project_id))
        if batch_id:
            query = query.filter(Activity.batch_id == _as_uuid(batch_id))
        rows = [
            {
                "event_type": row.event_type,
                "before": _stabilize(row.before, mapping),
                "after": _stabilize(row.after, mapping),
            }
            for row in query.all()
        ]
    finally:
        _close(gen)
    rows.sort(key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
    return rows


def _import_body(payload: dict) -> dict:
    body = dict(payload)
    batch_id = body.pop("batch_id", None)
    if batch_id is not None:
        uuid.UUID(batch_id)
    return body


def _build_catalog(client):
    project = make_project(client, "Perf Equiv", targets=["en", "ja"], layout="modular")
    pid = project["id"]
    modules = {}
    for slug in ("auth", "home"):
        created = client.post(
            f"/api/projects/{pid}/modules",
            json={"slug": slug, "name": slug},
        )
        assert created.status_code == 201, created.text
        modules[slug] = created.json()["id"]
    tag = client.post(
        f"/api/projects/{pid}/tags",
        json={"name": "ship", "color": "#112233"},
    )
    assert tag.status_code == 201, tag.text
    tag_id = tag.json()["id"]

    def add(key, source, **extra):
        body = {"key": key, "source_text": source, **extra}
        created = client.post(f"/api/projects/{pid}/strings", json=body)
        assert created.status_code == 201, created.text
        return created.json()["id"]

    draft_id = add(
        "draft_only",
        "Bản nháp",
        module_id=modules["auth"],
        description="never published",
        translations={"en": "Draft", "ja": ""},
    )
    published_id = add(
        "published",
        "Đã xuất bản",
        module_id=modules["auth"],
        translations={"en": "Published", "ja": "公開"},
    )
    edited_id = add(
        "edited",
        "Cũ",
        module_id=modules["auth"],
        translations={"en": "Old", "ja": "旧"},
    )
    moved_id = add(
        "moved",
        "Di chuyển",
        module_id=modules["auth"],
        translations={"en": "Move", "ja": "移動"},
    )
    pending_id = add(
        "soon_gone",
        "Sắp xóa",
        module_id=modules["home"],
        translations={"en": "Going", "ja": "削除予定"},
    )
    buried_id = add(
        "buried",
        "Đã xóa",
        module_id=modules["home"],
        translations={"en": "Buried"},
    )
    loose_id = add("loose", "Không module", translations={"en": "Loose", "ja": ""})
    tagged_id = add(
        "tagged",
        "Có thẻ",
        module_id=modules["home"],
        tag_ids=[tag_id],
        translations={"en": "Tagged", "ja": "タグ"},
    )
    empty_id = add(
        "empty_targets",
        "Trống",
        module_id=modules["auth"],
        translations={"en": "", "ja": ""},
    )

    publish_strings(
        client,
        pid,
        [published_id, edited_id, moved_id, pending_id, tagged_id],
    )
    edited = client.patch(
        f"/api/projects/{pid}/strings/{edited_id}",
        json={"source_text": "Mới", "translations": {"en": "New", "ja": "新"}},
    )
    assert edited.status_code == 200, edited.text
    moved = client.patch(
        f"/api/projects/{pid}/strings/{moved_id}",
        json={"module_id": modules["home"]},
    )
    assert moved.status_code == 200, moved.text
    deleted = client.delete(f"/api/projects/{pid}/strings/{pending_id}")
    assert deleted.status_code == 204, deleted.text
    tombstone = client.delete(f"/api/projects/{pid}/strings/{buried_id}")
    assert tombstone.status_code == 204, tombstone.text
    return {
        "project_id": pid,
        "ids": {
            "draft_only": draft_id,
            "published": published_id,
            "edited": edited_id,
            "moved": moved_id,
            "soon_gone": pending_id,
            "buried": buried_id,
            "loose": loose_id,
            "tagged": tagged_id,
            "empty_targets": empty_id,
        },
    }


def test_export_sync_state_and_translations_json(client):
    built = _build_catalog(client)
    pid = built["project_id"]
    snapshots = {}
    for layout in ("flat", "modular"):
        for stage in ("draft", "public"):
            for locale in (None, "vi", "en"):
                params = {"format": "json", "layout": layout, "stage": stage}
                label = locale or "all"
                if locale:
                    params["locale"] = locale
                response = client.get(f"/api/projects/{pid}/export", params=params)
                assert response.status_code == 200, response.text
                assert response.headers["content-type"].startswith("application/json")
                snapshots[f"export:{layout}:{stage}:{label}"] = response.json()
            state = client.get(
                f"/api/projects/{pid}/sync-state",
                params={"layout": layout, "stage": stage},
            )
            assert state.status_code == 200, state.text
            snapshots[f"sync-state:{layout}:{stage}"] = state.json()
    for stage in ("draft", "public"):
        compat = client.get(
            f"/api/projects/{pid}/translations.json", params={"stage": stage}
        )
        assert compat.status_code == 200, compat.text
        snapshots[f"translations.json:{stage}"] = compat.json()
    _assert_or_record("export", snapshots)


def test_export_gzip_round_trip(client):
    built = _build_catalog(client)
    pid = built["project_id"]
    long_text = "Xin chào " * 200
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "long_export", "source_text": long_text},
    )
    assert created.status_code == 201, created.text
    params = {"format": "json", "layout": "modular", "stage": "draft"}
    url = f"/api/projects/{pid}/export"
    plain = client.get(url, params=params, headers={"Accept-Encoding": "identity"})
    compressed = client.get(url, params=params, headers={"Accept-Encoding": "gzip"})
    assert plain.status_code == 200, plain.text
    assert compressed.status_code == 200, compressed.text
    assert "content-encoding" not in plain.headers
    assert compressed.headers.get("content-encoding") == "gzip"
    # The test client decodes gzip before exposing the body.
    assert compressed.json() == plain.json()


def test_publish_preview_snapshot(client):
    built = _build_catalog(client)
    pid = built["project_id"]
    first = preview_publish(client, pid, filt={})
    second = preview_publish(client, pid, filt={})
    assert first["fingerprint"] == second["fingerprint"]
    assert re.fullmatch(r"[0-9a-f]{64}", first["fingerprint"])
    gen, db = _session()
    try:
        mapping = _id_map(db, pid)
    finally:
        _close(gen)
    items = _stabilize(first["items"], mapping)
    _assert_or_record(
        "publish_preview",
        {"fingerprint": "<sha256>", "items": items},
    )


def test_editor_list_snapshot(client):
    built = _build_catalog(client)
    pid = built["project_id"]
    gen, db = _session()
    try:
        mapping = _id_map(db, pid)
    finally:
        _close(gen)
    live = client.get(f"/api/projects/{pid}/strings", params={"page_size": 50})
    deleted = client.get(
        f"/api/projects/{pid}/strings",
        params={"page_size": 50, "deleted": True},
    )
    one = client.get(f"/api/projects/{pid}/strings/{built['ids']['edited']}")
    assert live.status_code == 200, live.text
    assert deleted.status_code == 200, deleted.text
    assert one.status_code == 200, one.text
    _assert_or_record(
        "editor_list",
        {
            "live": _stabilize(live.json(), mapping),
            "deleted": _stabilize(deleted.json(), mapping),
            "edited": _stabilize(one.json(), mapping),
        },
    )


def _push(client, pid, strings, **params):
    response = client.post(
        f"/api/projects/{pid}/strings/import",
        params=params,
        json={"strings": strings},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_import_unchanged_base_push(client):
    project = make_project(client, "Push Unchanged", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    )
    assert created.status_code == 201, created.text
    result = _push(client, pid, {"save": "Lưu"})
    _assert_or_record(
        "import_unchanged",
        {
            "result": _import_body(result),
            "activities": _activities(pid, result["batch_id"]),
        },
    )


def test_import_edited_base_push(client):
    project = make_project(client, "Push Edited", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    )
    assert created.status_code == 201, created.text
    result = _push(client, pid, {"save": "Lưu lại"})
    listed = client.get(f"/api/projects/{pid}/strings", params={"page_size": 20})
    assert listed.json()["items"][0]["source_text"] == "Lưu lại"
    _assert_or_record(
        "import_edited",
        {
            "result": _import_body(result),
            "activities": _activities(pid, result["batch_id"]),
        },
    )


def test_import_revives_tombstone(client):
    project = make_project(client, "Push Revive", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    )
    assert created.status_code == 201, created.text
    deleted = client.delete(f"/api/projects/{pid}/strings/{created.json()['id']}")
    assert deleted.status_code == 204, deleted.text
    result = _push(client, pid, {"save": "Lưu lại"})
    _assert_or_record(
        "import_revive",
        {
            "result": _import_body(result),
            "activities": _activities(pid, result["batch_id"]),
        },
    )


def test_import_with_tags(client):
    project = make_project(client, "Push Tags", targets=["en"], layout="modular")
    pid = project["id"]
    module = client.post(
        f"/api/projects/{pid}/modules",
        json={"slug": "auth", "name": "Auth"},
    )
    assert module.status_code == 201, module.text
    tag = client.post(f"/api/projects/{pid}/tags", json={"name": "ship", "color": "#abcdef"})
    assert tag.status_code == 201, tag.text
    existing = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "save",
            "source_text": "Lưu",
            "module_id": module.json()["id"],
            "translations": {"en": "Save"},
        },
    )
    assert existing.status_code == 201, existing.text
    response = client.post(
        f"/api/projects/{pid}/import",
        params={
            "locale": "vi",
            "partial": True,
            "module_id": module.json()["id"],
            "tag_ids": tag.json()["id"],
        },
        files=json_upload({"save": "Lưu lại", "fresh": "Mới"}),
    )
    assert response.status_code == 200, response.text
    result = response.json()
    _assert_or_record(
        "import_tags",
        {
            "result": _import_body(result),
            "activities": _activities(pid, result["batch_id"]),
        },
    )


def test_import_locale_map(client):
    project = make_project(client, "Locale Map", targets=["en", "ja"])
    pid = project["id"]
    response = client.post(
        f"/api/projects/{pid}/import",
        params={"partial": True},
        files=json_upload(
            {
                "vi": {"hello": "Xin chào", "bye": "Tạm biệt"},
                "en": {"hello": "Hello", "bye": "Bye"},
                "ja": {"hello": "こんにちは"},
            }
        ),
    )
    assert response.status_code == 200, response.text
    result = response.json()
    _assert_or_record(
        "import_locale_map",
        {
            "result": _import_body(result),
            "activities": _activities(pid, result["batch_id"]),
        },
    )


def test_import_dry_run(client):
    project = make_project(client, "Push Dry", targets=["en"])
    pid = project["id"]
    created = client.post(
        f"/api/projects/{pid}/strings",
        json={"key": "save", "source_text": "Lưu", "translations": {"en": "Save"}},
    )
    assert created.status_code == 201, created.text
    result = _push(client, pid, {"save": "Lưu lại", "fresh": "Mới"}, dry_run=True)
    listed = client.get(f"/api/projects/{pid}/strings", params={"page_size": 20}).json()
    assert [item["key"] for item in listed["items"]] == ["save"]
    assert listed["items"][0]["source_text"] == "Lưu"
    _assert_or_record(
        "import_dry_run",
        {
            "result": _import_body(result),
            "activities": _activities(pid, result["batch_id"]),
        },
    )


def _assert_or_record(name: str, actual) -> None:
    golden = _load_golden()
    if os.environ.get("RECORD_PERF_EQUIV") == "1":
        golden[name] = actual
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(golden, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return
    assert name in golden, f"missing golden snapshot {name}; record with RECORD_PERF_EQUIV=1"
    assert actual == golden[name]


def _load_golden() -> dict:
    if not GOLDEN.exists():
        return {}
    return json.loads(GOLDEN.read_text(encoding="utf-8"))
