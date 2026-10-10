"""Guards for throwaway databases: schema, exclusive create, CREATEDB, and stale sweep."""

from __future__ import annotations

import os
import time
import uuid

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from app.postgres_admin import (
    STALE_HARNESS_DATABASE_AGE,
    create_database,
    database_name,
    drop_database,
    harness_database_name,
    replace_database,
    sweep_stale_harness_databases,
)
from tests.pg import (
    assert_no_preexisting_app_tables,
    forget_database_created_by_this_run,
    new_database_url,
    note_database_created_by_this_run,
)
from tests.postgres_support import set_sqlalchemy_url


def _empty_database():
    url = new_database_url("xl_test")
    create_database(url, exclusive=True)
    return url


def test_preexisting_alembic_version_and_app_tables_are_refused():
    url = _empty_database()
    name = database_name(url)
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))
        with pytest.raises(SystemExit, match="alembic_version"):
            assert_no_preexisting_app_tables(engine)
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE alembic_version"))
            conn.execute(text("CREATE TABLE users (id integer PRIMARY KEY)"))
        with pytest.raises(SystemExit, match="users"):
            assert_no_preexisting_app_tables(engine)
        note_database_created_by_this_run(name)
        assert_no_preexisting_app_tables(engine)
    finally:
        forget_database_created_by_this_run(name)
        engine.dispose()
        drop_database(url)


def test_create_new_refuses_a_database_that_already_exists():
    url = _empty_database()
    try:
        with pytest.raises(SystemExit, match="already exists"):
            create_database(url, exclusive=True)
    finally:
        drop_database(url)


def test_maintenance_database_is_the_bootstrap_not_postgres():
    from app.postgres_admin import _maintenance_database

    url = replace_database(os.environ["TEST_DATABASE_URL"], harness_database_name("xl_test"))
    bootstrap = make_url(os.environ["TEST_DATABASE_URL"]).database
    assert _maintenance_database(url) == bootstrap
    assert bootstrap != "postgres"


def test_missing_createdb_is_explained(monkeypatch):
    """The message uses this server's host, port, and credentials. No superuser role."""
    base = make_url(os.environ["TEST_DATABASE_URL"])
    url = base.set(database=harness_database_name("xl_test")).render_as_string(hide_password=False)
    probe = create_engine(base.render_as_string(hide_password=False), poolclass=NullPool)
    try:
        with probe.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        probe.dispose()

    def fail_create(engine_url: str):
        parsed = make_url(engine_url)
        assert parsed.host == base.host
        assert parsed.port == base.port
        assert parsed.username == base.username
        assert parsed.password == base.password
        assert parsed.database != "postgres"

        class _Result:
            def scalar(self):
                return None

        class _Conn:
            def execute(self, statement, params=None):
                if "CREATE DATABASE" in str(statement):
                    raise Exception("permission denied to create database")
                return _Result()

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

        class _Engine:
            def connect(self):
                return _Conn()

            def dispose(self):
                return None

        return _Engine()

    monkeypatch.setattr("app.postgres_admin._admin_engine", fail_create)
    with pytest.raises(SystemExit, match="CREATEDB"):
        create_database(url, exclusive=True)


def test_sweep_drops_only_stale_unused_harness_databases():
    token = uuid.uuid4().hex[:8]
    prefix = f"xl_test_{token}_"
    other = f"xl_test_{uuid.uuid4().hex[:8]}_"
    old = int(time.time()) - int(STALE_HARNESS_DATABASE_AGE.total_seconds()) - 120
    fresh_epoch = int(time.time())
    stale_url = _create_at(prefix, old)
    fresh_url = _create_at(prefix, fresh_epoch)
    busy_url = _create_at(prefix, old)
    other_url = _create_at(other, old)
    busy = create_engine(busy_url, poolclass=NullPool)
    busy_conn = busy.connect()
    try:
        dropped = sweep_stale_harness_databases(os_test_url(), prefixes=(prefix,))
        remaining = _names()
        assert database_name(stale_url) in dropped
        assert database_name(stale_url) not in remaining
        assert database_name(fresh_url) in remaining
        assert database_name(busy_url) in remaining
        assert database_name(other_url) in remaining
    finally:
        busy_conn.close()
        busy.dispose()
        for url in (stale_url, fresh_url, busy_url, other_url):
            drop_database(url)


def test_percent_in_database_url_round_trips_through_configparser():
    raw = "postgresql+psycopg://user:p%40ss@/xlocale_test?host=%2Fvar%2Frun%2Fpostgresql"
    cfg = Config()
    set_sqlalchemy_url(cfg, raw)
    assert cfg.get_main_option("sqlalchemy.url") == raw

    broken = Config()
    with pytest.raises(ValueError, match="interpolation"):
        broken.set_main_option("sqlalchemy.url", raw)


def os_test_url() -> str:
    return os.environ["TEST_DATABASE_URL"]


def _create_at(prefix: str, epoch: int) -> str:
    stem = prefix[:-1] if prefix.endswith("_") else prefix
    url = replace_database(os_test_url(), harness_database_name(stem, epoch=epoch))
    create_database(url, exclusive=True)
    return url


def _names() -> set[str]:
    from app.postgres_admin import list_databases

    return list_databases(os_test_url())
