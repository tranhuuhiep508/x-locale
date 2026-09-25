"""Backend management CLI: seed-demo, etc."""

from __future__ import annotations

import typer

app = typer.Typer(help="x-locale backend management commands", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """x-locale backend management commands."""


@app.command("seed-demo")
def seed_demo(force: bool = typer.Option(False, "--force", help="Recreate demo project")) -> None:
    """Seed the Demo App project (Vietnamese base, modular layout)."""
    from app.config import settings

    if not settings.auth_dev_bypass:
        typer.echo("seed-demo is only allowed when AUTH_DEV_BYPASS=true", err=True)
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
                f"Pruned {deleted} activity rows older than "
                f"{settings.activity_retention_days} days"
            )
    finally:
        db.close()


if __name__ == "__main__":
    app()
