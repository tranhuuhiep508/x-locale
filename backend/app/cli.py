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


@app.command("fake-confidence-scores")
def fake_confidence_scores(
    slug: str = typer.Option("demo-app", help="Project slug to populate"),
) -> None:
    """Fill translations with placeholder text and varied AI confidence scores (UI preview)."""
    from sqlalchemy.orm import joinedload

    from app.database import SessionLocal
    from app.models import Project, StringEntry

    # Cover high (>79), medium (50–79), and low (≤49) UI tiers.
    SCORE_CYCLE = (95, 82, 74, 68, 55, 42, 28, 88, 71, 49)
    LOCALE_LABEL = {"en": "EN", "ja": "JA", "vi": "VI"}

    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.slug == slug).first()
        if project is None:
            raise typer.Exit(f"Project not found: {slug}")

        entries = (
            db.query(StringEntry)
            .options(joinedload(StringEntry.translations))
            .filter(StringEntry.project_id == project.id, StringEntry.deleted_at.is_(None))
            .order_by(StringEntry.key)
            .all()
        )
        if not entries:
            raise typer.Exit(f"No strings in project: {slug}")

        updated = 0
        idx = 0
        for entry in entries:
            for translation in entry.translations:
                label = LOCALE_LABEL.get(translation.locale, translation.locale.upper())
                if not translation.value.strip():
                    translation.value = f"[{label}] {entry.key.replace('_', ' ')}"
                translation.confidence = SCORE_CYCLE[idx % len(SCORE_CYCLE)]
                idx += 1
                updated += 1

        db.commit()
        typer.echo(
            f"Set confidence scores on {updated} translations in {project.name} "
            f"(cycle: {', '.join(str(s) for s in SCORE_CYCLE)})"
        )
    finally:
        db.close()


@app.command("migrate")
def migrate() -> None:
    """Run Alembic migrations to head."""
    import subprocess
    import sys

    raise SystemExit(subprocess.call([sys.executable, "-m", "alembic", "upgrade", "head"]))


if __name__ == "__main__":
    app()
