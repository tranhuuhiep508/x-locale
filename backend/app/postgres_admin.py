"""Create and drop Postgres databases without importing the application engine."""

from __future__ import annotations

import os
import re
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

# Throwaway names only. xlocale_test is the bootstrap database and is not included.
HARNESS_DATABASE_PREFIXES = ("xltest_", "xl_test_", "xlocale_cli_", "xlocale_e2e_")
STALE_HARNESS_DATABASE_AGE = timedelta(hours=2)
_MAX_IDENT = 63
_EPOCH_NAME = re.compile(r"_([0-9]{10})_[0-9a-f]+$")

_NAME_OK = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


def database_name(url: str) -> str:
    name = make_url(url).database
    if not name or any(char not in _NAME_OK for char in name):
        raise SystemExit(f"Refusing database name {name!r}.")
    return name


def harness_database_name(stem: str, *, epoch: int | None = None, unique: str | None = None) -> str:
    """``{stem}_{epoch}_{hex}``. One trailing underscore on ``stem`` is removed.

    The epoch is ten digits so a sweep can read the age from the name. The hex is
    shortened only when the identifier would exceed 63 characters.
    """
    if stem.endswith("_"):
        stem = stem[:-1]
    if not stem or any(char not in _NAME_OK for char in stem):
        raise SystemExit(f"Refusing database name {stem!r}.")
    stamp = int(time.time()) if epoch is None else int(epoch)
    stamp_text = str(stamp)
    if not re.fullmatch(r"[0-9]{10}", stamp_text):
        raise SystemExit(f"Refusing harness epoch {stamp_text!r}.")
    token = unique or uuid.uuid4().hex
    if not token or any(char not in "0123456789abcdef" for char in token):
        raise SystemExit(f"Refusing harness suffix {token!r}.")
    room = _MAX_IDENT - len(stem) - len(stamp_text) - 2
    if room < 8:
        raise SystemExit(f"Refusing database name {stem!r}. The prefix does not fit.")
    if len(token) > room:
        token = token[:room]
    return f"{stem}_{stamp_text}_{token}"


def _configured_bootstrap_name() -> str:
    """Database named by TEST_DATABASE_URL. Harnesses connect here, not to postgres."""
    configured = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not configured:
        raise SystemExit(
            "TEST_DATABASE_URL must name the bootstrap database used for CREATE and DROP."
        )
    name = make_url(configured).database
    if not name or any(char not in _NAME_OK for char in name):
        raise SystemExit(f"Refusing bootstrap database name {name!r}.")
    return name


def _maintenance_database(url: str) -> str:
    """Existing database to connect to while creating or dropping ``url``.

    Throwaway databases use the TEST_DATABASE_URL database. Creating that
    bootstrap database itself connects to the application database instead,
    so a CREATEDB role never needs the postgres database.
    """
    bootstrap = _configured_bootstrap_name()
    if database_name(url) != bootstrap:
        return bootstrap
    app_url = os.environ.get("DATABASE_URL", "").strip()
    if app_url:
        app_name = make_url(app_url).database
        if app_name and all(char in _NAME_OK for char in app_name) and app_name != bootstrap:
            return app_name
    return bootstrap


def _admin_engine(url: str):
    admin = make_url(url).set(database=_maintenance_database(url))
    return create_engine(
        admin.render_as_string(hide_password=False),
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )


def redact_database_url(url: str) -> str:
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return "unparsed database url"


def _create_database_sql(name: str, template: str) -> str:
    """template0 is required for LC_COLLATE. libc C keeps comparisons on datcollate."""
    return (
        f'CREATE DATABASE "{name}" TEMPLATE "{template}" '
        "LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C'"
    )


def _terminate_own_backends(conn, name: str) -> None:
    """Signal only this role's sessions. Autovacuum belongs to a superuser."""
    conn.execute(
        text(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = :name
              AND pid <> pg_backend_pid()
              AND usename = current_user
            """
        ),
        {"name": name},
    )


def _role_can_force_drop(conn) -> bool:
    return bool(
        conn.execute(text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).scalar()
    )


def _is_missing_createdb(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "permission denied to create database" in message


def create_database(url: str, *, template: str = "template0", exclusive: bool = False) -> None:
    """Create url's database from template0 unless it already exists.

    ``exclusive=True`` refuses an existing database. Harnesses use that so a
    reused name cannot migrate or drop a database this run did not create.
    """
    if any(char not in _NAME_OK for char in template):
        raise SystemExit(f"Refusing template name {template!r}.")
    name = database_name(url)
    engine = _admin_engine(url)
    try:
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": name},
            ).scalar()
            if exists:
                if exclusive:
                    raise SystemExit(
                        f"Database {name!r} already exists. "
                        "Refusing to reuse a database this run did not create."
                    )
                return
            try:
                conn.execute(text(_create_database_sql(name, template)))
            except Exception as exc:
                if _is_missing_createdb(exc):
                    raise SystemExit(
                        "The database role lacks CREATEDB, so the database cannot be created. "
                        "Grant CREATEDB or use a superuser, then retry."
                    ) from None
                raise
    finally:
        engine.dispose()


def drop_database(url: str) -> None:
    name = database_name(url)
    engine = _admin_engine(url)
    try:
        with engine.connect() as conn:
            _terminate_own_backends(conn, name)
            if _role_can_force_drop(conn):
                conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            else:
                conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    finally:
        engine.dispose()


def list_databases(url: str) -> set[str]:
    engine = _admin_engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT datname FROM pg_database")).scalars()
            return set(rows)
    finally:
        engine.dispose()


def recreate_from_template(url: str, template: str) -> None:
    """Drop url's database and recreate it from template.

    Postgres requires the template database to have no other connections.
    """
    if any(char not in _NAME_OK for char in template):
        raise SystemExit(f"Refusing template name {template!r}.")
    drop_database(url)
    name = database_name(url)
    engine = _admin_engine(url)
    try:
        with engine.connect() as conn:
            _terminate_own_backends(conn, template)
            conn.execute(text(f'CREATE DATABASE "{name}" TEMPLATE "{template}"'))
    finally:
        engine.dispose()


def _harness_name_clause(prefixes: tuple[str, ...]) -> str:
    """LIKE patterns with escaped underscores. ``_`` is a single-character wildcard."""
    clauses = []
    for prefix in prefixes:
        if not prefix or any(char not in _NAME_OK for char in prefix):
            raise SystemExit(f"Refusing harness prefix {prefix!r}.")
        pattern = prefix.replace("_", r"\_") + "%"
        clauses.append(f"d.datname LIKE '{pattern}' ESCAPE '\\'")
    return " OR ".join(clauses)


def sweep_stale_harness_databases(
    url: str,
    *,
    min_age: timedelta = STALE_HARNESS_DATABASE_AGE,
    exclude: set[str] | None = None,
    prefixes: tuple[str, ...] | None = None,
) -> list[str]:
    """Drop unused harness databases this role owns whose name-encoded age is past ``min_age``.

    Names look like ``xl_test_{epoch}_{hex}`` (and the same shape for ``xltest_``,
    ``xlocale_cli_``, and ``xlocale_e2e_``). Age is the ten-digit epoch in the name.
    ``datdba`` must be the current role. ``xlocale_test`` does not match. A name
    with no epoch, another owner, or another session is left alone. ``prefixes``
    limits the sweep to names the caller created.
    """
    selected = prefixes if prefixes is not None else HARNESS_DATABASE_PREFIXES
    if not selected:
        return []
    kept = exclude or set()
    cutoff = int((datetime.now(UTC) - min_age).timestamp())
    engine = _admin_engine(url)
    dropped: list[str] = []
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT d.datname
                    FROM pg_database d
                    WHERE d.datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                      AND ({_harness_name_clause(selected)})
                      AND substring(d.datname from '_([0-9]{{10}})_[0-9a-f]+$')
                          ~ '^[0-9]{{10}}$'
                      AND substring(d.datname from '_([0-9]{{10}})_[0-9a-f]+$')::bigint
                          <= :cutoff
                      AND NOT EXISTS (
                          SELECT 1
                          FROM pg_stat_activity a
                          WHERE a.datname = d.datname
                            AND a.pid <> pg_backend_pid()
                      )
                    """
                ),
                {"cutoff": cutoff},
            ).scalars()
            stale = [name for name in rows if name not in kept and _EPOCH_NAME.search(name)]
        for name in stale:
            try:
                drop_database(replace_database(url, name))
            except Exception:
                continue
            dropped.append(name)
        return dropped
    finally:
        engine.dispose()


def replace_database(url: str, name: str) -> str:
    if any(char not in _NAME_OK for char in name):
        raise SystemExit(f"Refusing database name {name!r}.")
    return make_url(url).set(database=name).render_as_string(hide_password=False)


def main() -> None:
    actions = {"create", "create-new", "drop", "sweep"}
    if len(sys.argv) != 3 or sys.argv[1] not in actions:
        raise SystemExit(
            "usage: python -m app.postgres_admin create|create-new|drop|sweep DATABASE_URL"
        )
    action, url = sys.argv[1], sys.argv[2]
    if action == "create":
        create_database(url)
    elif action == "create-new":
        create_database(url, exclusive=True)
    elif action == "drop":
        drop_database(url)
    else:
        for name in sweep_stale_harness_databases(url):
            print(name)


if __name__ == "__main__":
    main()
