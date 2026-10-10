"""Guards for throwaway databases: schema, exclusive create, CREATEDB, and stale sweep."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.postgres_admin import (
    create_database,
    database_name,
    drop_database,
    replace_database,
    sweep_stale_harness_databases,
)
from tests.pg import (
    assert_no_preexisting_app_tables,
    databases_created_by_this_run,
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


def test_missing_createdb_is_explained():
    role = f"xl_nocreatedb_{uuid.uuid4().hex[:8]}"
    admin = create_engine(
        replace_database(os_test_url(), "postgres"),
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )
    try:
        with admin.connect() as conn:
            conn.execute(
                text(f"CREATE ROLE {role} LOGIN PASSWORD 'nocreatedb' NOSUPERUSER NOCREATEDB")
            )
        url = _role_url(role, f"xl_test_{uuid.uuid4().hex}")
        with pytest.raises(SystemExit, match="CREATEDB"):
            create_database(url, exclusive=True)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        admin.dispose()


def test_sweep_drops_only_stale_unused_harness_databases():
    stale_url = _empty_database()
    fresh_url = _empty_database()
    busy_url = _empty_database()
    plain_url = new_database_url("xlkeep")
    create_database(plain_url, exclusive=True)
    busy = create_engine(busy_url, poolclass=NullPool)
    busy_conn = busy.connect()
    try:
        kept = sweep_stale_harness_databases(os_test_url(), min_age=timedelta(days=1))
        assert database_name(stale_url) not in kept
        assert database_name(stale_url) in _names()
        dropped = sweep_stale_harness_databases(
            os_test_url(),
            min_age=timedelta(0),
            exclude=set(databases_created_by_this_run()) | {database_name(fresh_url)},
        )
        assert database_name(stale_url) in dropped
        remaining = _names()
        assert database_name(stale_url) not in remaining
        assert database_name(fresh_url) in remaining
        assert database_name(busy_url) in remaining
        assert database_name(plain_url) in remaining
        assert "xlocale" in remaining
    finally:
        busy_conn.close()
        busy.dispose()
        for url in (stale_url, fresh_url, busy_url, plain_url):
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
    import os

    return os.environ["TEST_DATABASE_URL"]


def _role_url(role: str, name: str) -> str:
    return replace_database(
        f"postgresql+psycopg://{role}:nocreatedb@localhost:5432/postgres",
        name,
    )


def _names() -> set[str]:
    from app.postgres_admin import list_databases

    return list_databases(os_test_url())
