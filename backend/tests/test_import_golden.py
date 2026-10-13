"""Frozen ORM import behavior at f67116f, with consolidated Excel audit events."""

import io
import json
import uuid
from datetime import date, datetime
from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import select, update

from app.models import Activity, ApiKey, Module, StringEntry, StringTag, Tag, Translation, User
from app.services.activity_events import classify_event
from tests.helpers import json_upload, make_project, publish_strings

FIXTURE = Path(__file__).parent / "fixtures/import_golden.json"


def snapshot(db, pid, batch):
    strings = (
        db.execute(select(StringEntry.__table__).where(StringEntry.project_id == pid))
        .mappings()
        .all()
    )
    modules = db.execute(select(Module.__table__).where(Module.project_id == pid)).mappings().all()
    tags = db.execute(select(Tag.__table__).where(Tag.project_id == pid)).mappings().all()
    aliases = {pid: "project"}
    aliases.update({row["id"]: f"string:{row['key']}" for row in strings})
    aliases.update({row["id"]: f"module:{row['slug']}" for row in modules})
    aliases.update({row["id"]: f"tag:{row['name']}" for row in tags})
    aliases.update({row.id: f"user:{row.email}" for row in db.scalars(select(User))})
    aliases.update({row.id: f"api-key:{row.name}" for row in db.scalars(select(ApiKey))})
    translations = (
        db.execute(
            select(Translation.__table__).where(
                Translation.string_id.in_([row["id"] for row in strings])
            )
        )
        .mappings()
        .all()
    )
    aliases.update(
        {row["id"]: f"{aliases[row['string_id']]}:{row['locale']}" for row in translations}
    )
    string_tags = (
        db.execute(
            select(StringTag.__table__).where(
                StringTag.string_id.in_([row["id"] for row in strings])
            )
        )
        .mappings()
        .all()
    )

    def normalize(value):
        if isinstance(value, (datetime, date)):
            return "<time>"
        if isinstance(value, uuid.UUID):
            return aliases.get(value, str(value))
        if isinstance(value, str):
            try:
                return aliases.get(uuid.UUID(value), value)
            except ValueError:
                return value
        if isinstance(value, dict):
            result = {
                key: "<time>" if key.endswith("_at") and item is not None else normalize(item)
                for key, item in value.items()
            }
            if "tag_ids" in result:
                pairs = sorted(zip(result["tag_ids"], result["tag_names"], strict=True))
                result["tag_ids"] = [key for key, _ in pairs]
                result["tag_names"] = [name for _, name in pairs]
            return result
        if isinstance(value, list):
            return [normalize(item) for item in value]
        return value

    audit = {}
    for row in db.scalars(
        select(Activity)
        .where(Activity.batch_id == batch)
        .order_by(Activity.created_at, Activity.id)
    ):
        key = aliases[row.string_id]
        if key not in audit:
            audit[key] = {
                "before": row.before,
                "actor_type": row.actor_type,
                "actor_id": row.actor_id,
                "actor_label": row.actor_label,
                "batch_kind": row.batch_kind,
            }
        audit[key]["after"] = row.after
    for event in audit.values():
        action = "create" if event["before"] is None else "update"
        classified = classify_event(action=action, before=event["before"], after=event["after"])
        event.update(
            action=action,
            event_type=classified.event_type,
            locale=classified.locale,
            summary=classified.summary,
        )
    return {
        "tables": {
            name: sorted(
                (normalize(dict(row)) for row in rows),
                key=lambda row: json.dumps(row, sort_keys=True),
            )
            for name, rows in (
                ("strings", strings),
                ("translations", translations),
                ("modules", modules),
                ("tags", tags),
                ("string_tags", string_tags),
            )
        },
        "activities": normalize(audit),
    }


@pytest.mark.parametrize("kind", ["json", "cli", "xlsx"])
@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_frozen_import_state_and_audit(client, session_factory, kind, layout):
    project = make_project(client, "Golden import", targets=["en", "fr"], layout=layout)
    pid = project["id"]
    root = f"/api/projects/{pid}"
    module_id = None
    if layout == "modular":
        module_id = client.post(
            f"{root}/modules", json={"slug": "stable", "name": "Stable"}
        ).json()["id"]
    original_tag = client.post(f"{root}/tags", json={"name": "original"}).json()["id"]
    selected_tag = client.post(f"{root}/tags", json={"name": "selected"}).json()["id"]
    ids = {}
    for key in ("existing", "revived", "unrelated"):
        response = client.post(
            f"{root}/strings",
            json={
                "key": key,
                "source_text": f"Original {key}",
                "module_id": module_id,
                "description": "Original context",
                "tag_ids": [original_tag],
                "translations": {"en": "Original English", "fr": "Original French"},
            },
        )
        assert response.status_code == 201, response.text
        ids[key] = response.json()["id"]
    publish_strings(client, pid, [ids["existing"]])
    if kind != "cli":
        assert client.delete(f"{root}/strings/{ids['existing']}").status_code == 204
        assert client.delete(f"{root}/strings/{ids['revived']}").status_code == 204
    with session_factory() as db:
        db.execute(
            update(Translation)
            .where(Translation.string_id == uuid.UUID(ids["existing"]))
            .values(confidence=83)
        )
        db.commit()
    headers = {}
    if kind == "cli":
        api_key = client.post(f"{root}/api-keys", json={"name": "Golden CLI"}).json()["key"]
        headers = {"X-API-Key": api_key}
    observed = []
    for stage in ("fresh", "changed", "unchanged", "partial", "overlay"):
        if (
            kind == "xlsx"
            and stage in {"partial", "overlay"}
            or kind == "cli"
            and stage == "overlay"
        ):
            continue
        prefix = "First" if stage == "fresh" else "Second"
        values = {key: f"{prefix} {key}" for key in ("existing", "revived", "new")}
        params = {}
        if stage == "partial":
            values = {"existing": "Partial source"}
            params["partial"] = True
        if kind == "cli":
            payload = (
                {
                    "modules": {
                        "stable": {"vi": {key: val for key, val in values.items() if key != "new"}},
                        "new": {"vi": {"new": values["new"]}},
                    }
                }
                if layout == "modular" and "new" in values
                else {"modules": {"stable": {"vi": values}}}
                if layout == "modular"
                else {"strings": values}
            )
            response = client.post(
                f"{root}/strings/import", json=payload, params=params, headers=headers
            )
        elif kind == "json":

            def maps(mapping):
                return {
                    "vi": mapping,
                    "en": {key: f"English {val}" for key, val in mapping.items()},
                }

            payload = (
                {
                    "modules": {
                        "stable": maps({key: val for key, val in values.items() if key != "new"}),
                        "new": maps({"new": values["new"]}),
                    }
                }
                if layout == "modular" and "new" in values
                else {"modules": {"stable": maps(values)}}
                if layout == "modular"
                else maps(values)
            )
            params["tag_ids"] = [selected_tag]
            if stage == "overlay":
                payload = {"existing": "Overlay English"}
                params = {"locale": "en", "partial": True}
                if module_id:
                    params["module_id"] = module_id
            response = client.post(f"{root}/import", files=json_upload(payload), params=params)
        else:
            workbook = Workbook()
            workbook.remove(workbook.active)
            for slug in ("stable", "new") if layout == "modular" else ("strings",):
                sheet = workbook.create_sheet(slug)
                sheet.append(["key", "vi", "en", "description", "tags"])
                for key, value in values.items():
                    if layout == "modular" and (slug == "new") != (key == "new"):
                        continue
                    if stage == "changed" and key == "existing":
                        sheet.append(
                            [
                                key,
                                "Intermediate",
                                "Intermediate EN",
                                "Intermediate context",
                                "original",
                            ]
                        )
                    sheet.append([key, value, f"English {value}", "Imported context", "selected"])
            raw = io.BytesIO()
            workbook.save(raw)
            response = client.post(
                f"{root}/import", files={"file": ("golden.xlsx", raw.getvalue())}
            )
        assert response.status_code == 200, response.text
        result = response.json()
        batch = uuid.UUID(result.pop("batch_id"))
        with session_factory() as db:
            observed.append(
                {"stage": stage, "result": result, **snapshot(db, uuid.UUID(pid), batch)}
            )
    name = f"{kind}-{layout}"
    assert observed == json.loads(FIXTURE.read_text())[name]
