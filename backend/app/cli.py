"""Backend management CLI: seed-demo, etc."""

from __future__ import annotations

import os

import typer

app = typer.Typer(help="x-locale backend management commands", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """x-locale backend management commands."""


@app.command("seed-demo")
def seed_demo(force: bool = typer.Option(False, "--force", help="Recreate demo project")) -> None:
    """Seed the Demo App project (Vietnamese base, modular layout)."""
    from app.config import require_postgres_database_url, settings

    require_postgres_database_url(settings.database_url)
    if not force and _seed_demo_refused(settings):
        typer.echo(
            "seed-demo refuses to run when OIDC is configured or ENV=production. "
            "Pass --force to seed anyway.",
            err=True,
        )
        raise typer.Exit(1)
    from app.seed import seed_demo_data

    project = seed_demo_data(force=force)
    if project:
        typer.echo(f"Demo project ready: {project.name} ({project.id}) slug={project.slug}")
    else:
        typer.echo("Seed failed")


@app.command("migrate")
def migrate() -> None:
    """Run Alembic migrations to head."""
    import subprocess
    import sys

    raise SystemExit(subprocess.call([sys.executable, "-m", "alembic", "upgrade", "head"]))


@app.command("prune-activities")
def prune_activities_cmd() -> None:
    """Delete activity rows older than ACTIVITY_RETENTION_DAYS. No-op when 0.

    Run on a schedule (cron / after deploy). The API does not prune on startup.
    """
    from app.config import settings
    from app.database import SessionLocal
    from app.services.activities import prune_activities

    db = SessionLocal()
    try:
        deleted = prune_activities(db, days=settings.activity_retention_days)
        db.commit()
        if settings.activity_retention_days <= 0:
            typer.echo("ACTIVITY_RETENTION_DAYS=0; nothing pruned")
        else:
            typer.echo(
                f"Pruned {deleted} activity rows older than {settings.activity_retention_days} days"
            )
    finally:
        db.close()


def _seed_demo_refused(settings) -> bool:
    """Production must not receive the default demo API key. A fresh clone may seed."""
    if settings.oidc_configured:
        return True
    return os.environ.get("ENV", "").strip().lower() == "production"


if __name__ == "__main__":
    app()
