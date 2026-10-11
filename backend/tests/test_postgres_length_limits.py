"""XLOCALE-43: a 512-character key must import and push on real Postgres."""

from __future__ import annotations

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import Activity, StringEntry, Translation, User
from tests.helpers import json_upload, make_project
from tests.postgres_support import BACKEND_DIR, alembic_check, prepare_schema, upgrade_head

MAX_KEY = "k" * 512
PUSH_KEY = "p" * 512
LONG_EMAIL = ("e" * 308) + "@example.com"
BASE_LOCALE = "abc-12345678"
TARGET_LOCALE = "en-abcdefgh"


def test_alembic_check_reports_no_string_length_drift(throwaway_database):
    upgrade_head(throwaway_database)
    alembic_check(throwaway_database)


def _string_tags_pk(url: str) -> str | None:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return connection.execute(
                text(
                    """
                    SELECT conname
                    FROM pg_constraint
                    WHERE conrelid = 'string_tags'::regclass
                      AND contype = 'p'
                    """
                )
            ).scalar()
    finally:
        engine.dispose()


def test_create_all_pk_rename_is_guarded_both_ways(throwaway_database, monkeypatch):
    """create_all already names the PK string_tags_pkey.

    Upgrade from a stamp below r7 must leave that name alone. Downgrade must
    rename it to uq_string_tag, and the next upgrade must rename it back.
    """
    url = throwaway_database
    monkeypatch.setattr(settings, "database_url", url)
    prepare_schema(url, "create_all")
    assert _string_tags_pk(url) == "string_tags_pkey"

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    command.stamp(cfg, "q6c94f5a6789")
    command.upgrade(cfg, "head")
    assert _string_tags_pk(url) == "string_tags_pkey"

    command.downgrade(cfg, "q6c94f5a6789")
    assert _string_tags_pk(url) == "uq_string_tag"

    command.upgrade(cfg, "head")
    assert _string_tags_pk(url) == "string_tags_pkey"
    alembic_check(url)


def _activity_for_key(db: Session, key: str) -> Activity:
    rows = db.query(Activity).all()
    matched = [row for row in rows if key in (row.summary or "")]
    assert matched, f"no activity summary contains the {len(key)}-character key"
    return matched[0]


def test_import_and_push_store_512_character_keys(client, session_factory):
    project = make_project(client, name="Long key import", layout="flat")
    pid = project["id"]

    uploaded = client.post(
        f"/api/projects/{pid}/import",
        files=json_upload({MAX_KEY: "Xin chào"}),
    )
    assert uploaded.status_code == 200, uploaded.text

    pushed = client.post(
        f"/api/projects/{pid}/strings/import",
        json={"strings": {PUSH_KEY: "Đăng nhập"}, "base_language": "vi"},
    )
    assert pushed.status_code == 200, pushed.text

    with session_factory() as db:
        stored = {row.key: row for row in db.query(StringEntry).all()}
        assert set(stored) == {MAX_KEY, PUSH_KEY}
        for key in (MAX_KEY, PUSH_KEY):
            activity = _activity_for_key(db, key)
            assert len(activity.summary) > 512
            payload = activity.after or {}
            assert payload.get("key") == key
            assert stored[key].key == key


def test_regex_max_locale_is_stored_on_translations_and_activities(client, session_factory):
    created = client.post(
        "/api/projects",
        json={
            "name": "Locale width",
            "base_language": BASE_LOCALE,
            "target_languages": [TARGET_LOCALE],
            "layout": "flat",
        },
    )
    assert created.status_code == 201, created.text
    pid = created.json()["id"]
    string = client.post(
        f"/api/projects/{pid}/strings",
        json={
            "key": "hello",
            "source_text": "Xin chào",
            "translations": {TARGET_LOCALE: "Hello"},
        },
    )
    assert string.status_code == 201, string.text
    sid = string.json()["id"]
    updated = client.put(
        f"/api/projects/{pid}/strings/{sid}/translations/{TARGET_LOCALE}",
        json={"value": "Hi"},
    )
    assert updated.status_code == 200, updated.text

    with session_factory() as db:
        locales = {row.locale for row in db.query(Translation).all()}
        assert TARGET_LOCALE in locales
        activity_locales = {row.locale for row in db.query(Activity).all()}
        assert TARGET_LOCALE in activity_locales


def test_actor_label_stores_a_full_length_email(client, session_factory):
    assert len(LONG_EMAIL) == 320
    me = client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    with session_factory() as db:
        user = db.query(User).one()
        user.email = LONG_EMAIL
        db.commit()

    project = make_project(client, name="Long actor", layout="flat")
    created = client.post(
        f"/api/projects/{project['id']}/strings",
        json={"key": "hello", "source_text": "Xin chào"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["created_by_label"] == LONG_EMAIL

    with session_factory() as db:
        activity = db.query(Activity).filter(Activity.summary.contains("hello")).one()
        assert activity.actor_label == LONG_EMAIL
