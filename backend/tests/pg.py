"""Postgres URLs, session truncate, and throwaway databases for tests."""

from __future__ import annotations

import os
import re
import uuid
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url

from app.postgres_admin import (
    create_database,
    database_name,
    drop_database,
    replace_database,
    sweep_stale_harness_databases,
)

POOL_SIZE = 5
POOL_MAX_OVERFLOW = 20

REPO_ROOT = Path(__file__).resolve().parents[2]


def is_postgres_url(url: str | None) -> bool:
    lowered = (url or "").strip().lower()
    return lowered.startswith(("postgresql://", "postgresql+", "postgres://", "postgres+"))


def load_dotenv_defaults() -> None:
    """Fill empty process env from the repo .env without overriding real variables."""
    for path in (REPO_ROOT / ".env", REPO_ROOT / "backend" / ".env"):
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if os.environ.get(key, "").strip():
                continue
            os.environ[key] = value.strip().strip('"').strip("'")


_TARGET_QUERY_KEYS = frozenset({"dbname", "service", "servicefile"})
_CREATED_BY_THIS_RUN: set[str] = set()


def is_dedicated_test_database_name(name: str) -> bool:
    """True when ``name`` is lowercase and ``test`` is a whole ``_``-separated token.

    ``xlocale_test`` and ``test_xlocale`` pass. ``latest`` and ``contest_prod`` do not.
    """
    return bool(re.fullmatch(r"[a-z0-9_]*", name) and re.search(r"(^|_)test(_|$)", name))


def note_database_created_by_this_run(name: str) -> None:
    _CREATED_BY_THIS_RUN.add(name)


def forget_database_created_by_this_run(name: str) -> None:
    _CREATED_BY_THIS_RUN.discard(name)


def databases_created_by_this_run() -> frozenset[str]:
    return frozenset(_CREATED_BY_THIS_RUN)


def _database_endpoint(url: str) -> tuple[str, int, str]:
    """Host, port, and database after SQLAlchemy parses the URL.

    ``localhost`` and ``127.0.0.1`` are the same host. An omitted port is 5432.
    """
    parsed = make_url(url)
    host = (parsed.host or "").strip().lower()
    if host == "localhost":
        host = "127.0.0.1"
    return host, parsed.port or 5432, parsed.database or ""


def validate_test_database_env(test_url: str, app_url: str) -> str:
    """Return the test URL or exit before pytest can truncate a dev database."""
    test_url = test_url.strip()
    app_url = app_url.strip()
    if not test_url:
        raise SystemExit(
            "TEST_DATABASE_URL is required and must be a Postgres URL. "
            "Refusing to run tests without a database."
        )
    if not is_postgres_url(test_url):
        raise SystemExit("TEST_DATABASE_URL must be a Postgres URL.")
    # psycopg merges these libpq keys over the URL path, so ?dbname= can point
    # the suite at a different database than the one the guard parsed.
    if _TARGET_QUERY_KEYS & {key.lower() for key in make_url(test_url).query}:
        raise SystemExit(
            "TEST_DATABASE_URL must name its database in the path, not the query string."
        )
    test_host, test_port, test_db = _database_endpoint(test_url)
    if app_url and is_postgres_url(app_url):
        app_host, app_port, app_db = _database_endpoint(app_url)
        same_endpoint = (test_host, test_port, test_db) == (app_host, app_port, app_db)
        same_database = bool(test_db) and test_db == app_db
        if same_endpoint or same_database:
            raise SystemExit(
                "TEST_DATABASE_URL must not point at the DATABASE_URL database. "
                "Refusing to TRUNCATE a database the app is configured to use."
            )
    if not is_dedicated_test_database_name(test_db):
        raise SystemExit(
            "TEST_DATABASE_URL must name a dedicated test database "
            "(a '_'-separated 'test' token, e.g. xlocale_test)."
        )
    return test_url


def path_database_name(url: str) -> str:
    """Database name from a Postgres URL path. Empty when the URL is not Postgres."""
    if not is_postgres_url(url):
        return ""
    return make_url(url.strip()).database or ""


def assert_connected_test_database(engine: Engine, test_url: str, app_database_name: str) -> None:
    """Refuse to continue unless this session is the dedicated test database.

    ``current_database()`` is the name the server actually opened. It must match
    the path in ``test_url``, contain ``test``, and differ from the app database.
    """
    expected = make_url(test_url).database or ""
    with engine.connect() as conn:
        actual = conn.execute(text("SELECT current_database()")).scalar()
    name = "" if actual is None else str(actual)
    if name != expected or not is_dedicated_test_database_name(name) or name == app_database_name:
        raise SystemExit(
            f"Connected to {actual!r}, not a dedicated test database. Refusing to TRUNCATE."
        )


def assert_no_preexisting_app_tables(engine: Engine) -> None:
    """Refuse to truncate a database this run did not create when it already has schema.

    ``alembic_version`` and any application table count. A database recorded by
    ``note_database_created_by_this_run`` is the empty database this process
    just created, so later ``create_all`` is allowed.
    """
    import app.models  # noqa: F401
    from app.database import Base

    with engine.connect() as conn:
        actual = conn.execute(text("SELECT current_database()")).scalar()
        name = "" if actual is None else str(actual)
        if name in _CREATED_BY_THIS_RUN:
            return
        names = [table.name for table in Base.metadata.sorted_tables]
        names.append("alembic_version")
        found = (
            conn.execute(
                text(
                    """
                    SELECT c.relname
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public'
                      AND c.relkind = 'r'
                      AND c.relname = ANY(:names)
                    ORDER BY c.relname
                    """
                ),
                {"names": names},
            )
            .scalars()
            .all()
        )
    if found:
        raise SystemExit(
            f"Database {name!r} already has application tables {list(found)}. "
            "Refusing to TRUNCATE a database this run did not create."
        )


def open_engine(url: str | None = None) -> Engine:
    target = url or os.environ["DATABASE_URL"]
    return create_engine(
        target,
        pool_pre_ping=True,
        pool_size=POOL_SIZE,
        max_overflow=POOL_MAX_OVERFLOW,
    )


def truncate_all(engine: Engine) -> None:
    from app.database import Base

    tables = list(Base.metadata.sorted_tables)
    if not tables:
        return
    quoted = ", ".join(f'"{table.name}"' for table in tables)
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL lock_timeout = '5s'"))
        conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))


def new_database_url(prefix: str = "xltest") -> str:
    name = f"{prefix}_{uuid.uuid4().hex}"
    return replace_database(os.environ["TEST_DATABASE_URL"], name)


def disposable_database(prefix: str = "xltest") -> Iterator[str]:
    url = new_database_url(prefix)
    create_database(url, exclusive=True)
    name = database_name(url)
    note_database_created_by_this_run(name)
    try:
        yield url
    finally:
        drop_database(url)
        forget_database_created_by_this_run(name)


def prepare_session_database(test_url: str) -> str:
    """Create this process's database and point later connections at it.

    The name is ``xl_test_`` plus a unique suffix, so two pytest processes on
    one server do not share or truncate each other's database. Stale harness
    databases from a killed run are dropped first.
    """
    os.environ["TEST_DATABASE_URL"] = test_url
    sweep_stale_harness_databases(test_url, exclude=set(_CREATED_BY_THIS_RUN))
    url = new_database_url("xl_test")
    create_database(url, exclusive=True)
    note_database_created_by_this_run(database_name(url))
    return url
