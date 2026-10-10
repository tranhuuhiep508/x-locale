"""Schema shapes that module delete has to survive, each on a throwaway database."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.postgres_admin import create_database, drop_database
from tests.pg import new_database_url

BACKEND_DIR = Path(__file__).resolve().parents[1]


@contextmanager
def migration_database_url(url: str) -> Iterator[None]:
    """Point Alembic at url for the duration of the block, then restore it."""
    from app.config import settings

    previous = settings.database_url
    settings.database_url = url
    try:
        yield
    finally:
        settings.database_url = previous


def reset_public_schema(url: str) -> None:
    engine = create_engine(url, poolclass=NullPool)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
    engine.dispose()


def libpq_url(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://", 1).replace(
        "postgres+psycopg://", "postgresql://", 1
    )


def upgrade_head(url: str) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    with migration_database_url(url):
        command.upgrade(cfg, "head")


def _create_all(url: str) -> None:
    import app.models  # noqa: F401
    from app.database import Base

    engine = create_engine(url, poolclass=NullPool)
    Base.metadata.create_all(engine)
    engine.dispose()


def install_immediate_module_fks(url: str) -> None:
    """Recreate module FKs non-deferred, composite NO ACTION before SET NULL.

    That is the trigger order a pg_dump restore can produce for the old
    constraints: the NO ACTION check runs while module_id is still set.
    """
    engine = create_engine(url, poolclass=NullPool)
    with engine.begin() as conn:
        names = conn.execute(
            text(
                """
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_class ref ON ref.oid = con.confrelid
                WHERE rel.relname = 'strings'
                  AND ref.relname = 'modules'
                  AND con.contype = 'f'
                """
            )
        ).fetchall()
        for (name,) in names:
            conn.execute(text(f'ALTER TABLE strings DROP CONSTRAINT "{name}"'))
        conn.execute(
            text(
                """
                ALTER TABLE strings
                ADD CONSTRAINT fk_strings_project_module
                FOREIGN KEY (project_id, module_id)
                REFERENCES modules (project_id, id)
                ON DELETE NO ACTION
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE strings
                ADD CONSTRAINT fk_strings_project_published_module
                FOREIGN KEY (project_id, published_module_id)
                REFERENCES modules (project_id, id)
                ON DELETE NO ACTION
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE strings
                ADD CONSTRAINT strings_module_id_fkey
                FOREIGN KEY (module_id) REFERENCES modules (id)
                ON DELETE SET NULL
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE strings
                ADD CONSTRAINT fk_strings_published_module_id_modules
                FOREIGN KEY (published_module_id) REFERENCES modules (id)
                ON DELETE SET NULL
                """
            )
        )
    engine.dispose()


def dump_and_restore(url: str) -> None:
    """Round-trip the schema through pg_dump/pg_restore's SQL path."""
    if shutil.which("pg_dump") is None or shutil.which("psql") is None:
        raise RuntimeError("pg_dump and psql are required for the restore test")
    target = libpq_url(url)
    dumped = subprocess.run(
        [
            "pg_dump",
            "--format=plain",
            "--no-owner",
            "--no-acl",
            "--schema=public",
            target,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    filtered: list[str] = []
    for line in dumped.stdout.splitlines():
        if line.startswith("SET transaction_timeout"):
            continue
        if line.startswith("\\restrict") or line.startswith("\\unrestrict"):
            continue
        if line.startswith("CREATE SCHEMA public"):
            continue
        filtered.append(line)
    reset_public_schema(url)
    restored = subprocess.run(
        ["psql", target, "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input="\n".join(filtered) + "\n",
        check=False,
        capture_output=True,
        text=True,
    )
    if restored.returncode != 0:
        raise RuntimeError(restored.stderr or restored.stdout)


def prepare_schema(url: str, mode: str) -> None:
    reset_public_schema(url)
    if mode == "alembic":
        upgrade_head(url)
    elif mode == "create_all":
        _create_all(url)
    elif mode == "restored_order":
        upgrade_head(url)
        install_immediate_module_fks(url)
    elif mode == "pg_dump":
        upgrade_head(url)
        dump_and_restore(url)
    else:
        raise ValueError(f"unknown schema mode {mode}")


def alembic_check(url: str) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    with migration_database_url(url):
        command.check(cfg)


def _bind_dev_settings(monkeypatch, url: str) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "oidc_issuer", "")
    monkeypatch.setattr(settings, "oidc_client_id", "")
    monkeypatch.setattr(settings, "oidc_client_secret", "")


def _client_for(url: str) -> Iterator[tuple[TestClient, sessionmaker[Session]]]:
    from app.database import get_db, register_activity_listener
    from app.main import app

    engine: Engine = create_engine(url, poolclass=NullPool)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    register_activity_listener()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client, session_factory

    app.dependency_overrides.pop(get_db, None)
    engine.dispose()


SCHEMA_MODES = ("alembic", "create_all", "restored_order", "pg_dump")


@pytest.fixture(params=SCHEMA_MODES)
def pg_schema(request, monkeypatch) -> Iterator[tuple[TestClient, sessionmaker[Session], str]]:
    """API client on each schema shape module delete has to survive."""
    url = new_database_url()
    create_database(url)
    try:
        _bind_dev_settings(monkeypatch, url)
        prepare_schema(url, request.param)
        yield from _schema_client(url, request.param)
    finally:
        drop_database(url)


def _schema_client(url: str, mode: str) -> Iterator[tuple[TestClient, sessionmaker[Session], str]]:
    for client, session_factory in _client_for(url):
        yield client, session_factory, mode
