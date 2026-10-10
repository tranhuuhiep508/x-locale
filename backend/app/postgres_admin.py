"""Create and drop Postgres databases without importing the application engine."""

from __future__ import annotations

import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

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


def create_database(url: str, *, template: str = "template0") -> None:
    """Create url's database from template0 unless it already exists."""
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
                return
            conn.execute(text(_create_database_sql(name, template)))
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


def replace_database(url: str, name: str) -> str:
    if any(char not in _NAME_OK for char in name):
        raise SystemExit(f"Refusing database name {name!r}.")
    return make_url(url).set(database=name).render_as_string(hide_password=False)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"create", "drop"}:
        raise SystemExit("usage: python -m app.postgres_admin create|drop DATABASE_URL")
    if sys.argv[1] == "create":
        create_database(sys.argv[2])
    else:
        drop_database(sys.argv[2])


if __name__ == "__main__":
    main()
