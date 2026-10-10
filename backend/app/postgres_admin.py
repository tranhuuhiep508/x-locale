"""Create and drop Postgres databases without importing the application engine."""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

# Throwaway names only. xlocale_test is the long-lived dev database and is not included.
HARNESS_DATABASE_PREFIXES = ("xltest_", "xl_test_", "xlocale_cli_", "xlocale_e2e_")
STALE_HARNESS_DATABASE_AGE = timedelta(hours=2)

_NAME_OK = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


def database_name(url: str) -> str:
    name = make_url(url).database
    if not name or any(char not in _NAME_OK for char in name):
        raise SystemExit(f"Refusing database name {name!r}.")
    return name


def _admin_engine(url: str):
    admin = make_url(url).set(database="postgres")
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


def _harness_name_clause() -> str:
    """LIKE patterns with escaped underscores. ``_`` is a single-character wildcard."""
    clauses = []
    for prefix in HARNESS_DATABASE_PREFIXES:
        pattern = prefix.replace("_", r"\_") + "%"
        clauses.append(f"d.datname LIKE '{pattern}' ESCAPE '\\'")
    return " OR ".join(clauses)


def sweep_stale_harness_databases(
    url: str,
    *,
    min_age: timedelta = STALE_HARNESS_DATABASE_AGE,
    exclude: set[str] | None = None,
) -> list[str]:
    """Drop unused harness databases owned by this role and older than ``min_age``.

    Names must match a harness prefix (``xltest_``, ``xl_test_``, ``xlocale_cli_``,
    ``xlocale_e2e_``). ``xlocale_test`` does not match. Databases with another
    session, a different owner, or no readable age are left alone. A role that
    cannot read file timestamps skips the sweep instead of guessing.
    """
    kept = exclude or set()
    engine = _admin_engine(url)
    dropped: list[str] = []
    try:
        with engine.connect() as conn:
            try:
                rows = conn.execute(
                    text(
                        f"""
                        SELECT d.datname,
                               (pg_stat_file('base/' || d.oid || '/PG_VERSION')).modification
                                   AS modified
                        FROM pg_database d
                        WHERE d.datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                          AND ({_harness_name_clause()})
                          AND NOT EXISTS (
                              SELECT 1
                              FROM pg_stat_activity a
                              WHERE a.datname = d.datname
                                AND a.pid <> pg_backend_pid()
                          )
                        """
                    )
                ).all()
            except Exception as exc:
                if "permission denied" in str(exc).lower():
                    return []
                raise
            cutoff = datetime.now(UTC) - min_age
            stale: list[str] = []
            for name, modified in rows:
                if name in kept or modified is None:
                    continue
                if modified.tzinfo is None:
                    modified = modified.replace(tzinfo=UTC)
                if modified <= cutoff:
                    stale.append(name)
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
