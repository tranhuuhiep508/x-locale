"""Backend management CLI: seed-demo, etc."""

from __future__ import annotations

import typer

app = typer.Typer(help="TMS backend management commands", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """TMS backend management commands."""


@app.command("seed-demo")
def seed_demo(force: bool = typer.Option(False, "--force", help="Recreate demo project")) -> None:
    """Seed the Demo App project (Vietnamese base, modular layout)."""
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


if __name__ == "__main__":
    app()
