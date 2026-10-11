"""XLOCALE-46: full and intermediate Alembic downgrades on real Postgres."""

from __future__ import annotations

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

from alembic import command
from tests.postgres_support import BACKEND_DIR, migration_database_url, set_sqlalchemy_url


@pytest.fixture()
def migration_config(throwaway_database):
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    set_sqlalchemy_url(cfg, throwaway_database)
    with migration_database_url(throwaway_database):
        yield cfg


def test_upgrade_head_downgrade_base_and_upgrade_again(migration_config, throwaway_database):
    command.upgrade(migration_config, "head")
    command.check(migration_config)
    command.downgrade(migration_config, "base")

    engine = create_engine(throwaway_database, poolclass=NullPool)
    try:
        assert inspect(engine).get_table_names() == ["alembic_version"]
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 0
    finally:
        engine.dispose()

    command.upgrade(migration_config, "head")
    command.check(migration_config)


def test_event_type_survives_until_its_original_revision(migration_config, throwaway_database):
    command.upgrade(migration_config, "head")
    command.downgrade(migration_config, "g7b8293a4c5d")

    engine = create_engine(throwaway_database, poolclass=NullPool)
    try:
        inspector = inspect(engine)
        columns = {column["name"]: column for column in inspector.get_columns("activities")}
        assert "event_type" in columns
        assert columns["event_type"]["nullable"] is False
        indexes = {index["name"]: index for index in inspector.get_indexes("activities")}
        assert indexes["ix_activities_event_type"]["column_names"] == ["event_type"]

        command.downgrade(migration_config, "f60718293b4c")
        inspector = inspect(engine)
        assert "event_type" in {column["name"] for column in inspector.get_columns("activities")}
        assert "ix_activities_event_type" in {
            index["name"] for index in inspector.get_indexes("activities")
        }

        command.downgrade(migration_config, "e5f60718293a")
        inspector = inspect(engine)
        assert "event_type" not in {
            column["name"] for column in inspector.get_columns("activities")
        }
        assert "ix_activities_event_type" not in {
            index["name"] for index in inspector.get_indexes("activities")
        }
    finally:
        engine.dispose()
