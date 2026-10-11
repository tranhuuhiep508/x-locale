"""Measure the real undo service against disposable Postgres databases.

Run from backend/:
  PYTHONPATH=. uv run --no-sync python benchmarks/undo.py --sizes 100 500 1000 --trials 3

DATABASE_URL must be a Postgres URL on the server that will host the throwaway
databases. Each trial is cloned from a seeded template with CREATE DATABASE
... TEMPLATE. The configured database itself is not written.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

_configured = os.environ.get("DATABASE_URL", "").strip().lower()
if not _configured.startswith(("postgresql://", "postgresql+", "postgres://", "postgres+")):
    os.environ["DATABASE_URL"] = "postgresql+psycopg://xlocale:xlocale@localhost:5432/xlocale"

from sqlalchemy import create_engine, event, func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.database import Base, register_activity_listener  # noqa: E402
from app.models import (  # noqa: E402
    Activity,
    Module,
    Project,
    StringEntry,
    Tag,
    Translation,
)
from app.postgres_admin import (  # noqa: E402
    create_database,
    database_name,
    drop_database,
    recreate_from_template,
    replace_database,
)
from app.services.activities import (  # noqa: E402
    _live_snapshot,
    preview_revert_batch,
    revert_batch,
)

ACTOR = {"actor_type": "user", "actor_id": "bench", "actor_label": "Benchmark"}


def engine_for(url: str):
    return create_engine(url, pool_pre_ping=True, poolclass=NullPool)


def seed(url: str, size: int, rich: bool, forced: bool):
    engine = engine_for(url)
    Base.metadata.create_all(engine)
    batch = uuid.uuid4()
    locales = ["en"] if not rich else ["en", "fr", "de", "es", "it", "pt", "ja", "ko", "zh", "th"]
    with Session(engine, autoflush=False) as db:
        # Seed explicit original audit snapshots without incidental setup markers.
        db.info["activity"] = {**ACTOR, "batch_kind": "revert"}
        project = Project(
            name="Disposable undo benchmark",
            slug="undo-bench",
            base_language="vi",
            target_languages=locales,
        )
        db.add(project)
        db.flush()
        project_id = project.id
        modules = (
            [Module(project_id=project.id, slug=f"mod-{i}", name=f"Module {i}") for i in range(10)]
            if rich
            else []
        )
        tags = [Tag(project_id=project.id, name=f"Tag {i}") for i in range(12)] if rich else []
        db.add_all(modules + tags)
        db.flush()
        originals = []
        entries = []
        for index in range(size):
            module = modules[index % len(modules)] if rich else None
            entry = StringEntry(
                project_id=project.id,
                key=f"bench.{index}",
                source_text="A1",
                status="public" if rich else "draft",
                module_id=module.id if module else None,
                pending_delete=False,
            )
            if rich:
                entry.published_key = entry.key
                entry.published_source_text = "Published A1"
                entry.published_module_id = module.id
                entry.published_at = datetime(2026, 1, 1, tzinfo=UTC)
                entry.tags = [tags[(index + i) % len(tags)] for i in range(3)]
            entry.translations = [
                Translation(
                    locale=locale,
                    value=f"{locale} V1",
                    published_value=f"{locale} Public" if rich else None,
                )
                for locale in locales
            ]
            db.add(entry)
            entries.append(entry)
        db.flush()
        for entry in entries:
            before = _live_snapshot(entry)
            entry.source_text = "A2"
            for translation in entry.translations:
                translation.value = f"{translation.locale} V2"
            after = _live_snapshot(entry)
            originals.append(
                Activity(
                    project_id=project.id,
                    actor_type="user",
                    actor_id="bench",
                    actor_label="Benchmark",
                    action="update",
                    entity_type="string",
                    entity_id=str(entry.id),
                    string_id=entry.id,
                    before=before,
                    after=after,
                    event_type="string.source_updated",
                    summary=f"Updated {entry.key}",
                    batch_id=batch,
                    batch_kind="import",
                    is_revertible=True,
                )
            )
            if forced:
                entry.source_text = "A3"
        db.add_all(originals)
        db.commit()
    engine.dispose()
    return project_id, batch, locales


def sql_counter(counter: Counter):
    def count(conn, cursor, statement, parameters, context, executemany):
        counter["statements"] += 1
        normalized = " ".join(statement.lower().split()).replace('"', "")
        kind = normalized.split(" ", 1)[0]
        counter[kind] += 1
        if kind == "select":
            if "from strings" in normalized and "strings.source_text" in normalized:
                counter["string_full_loads"] += 1
            elif "from tags" in normalized or "join tags" in normalized:
                counter["tag_reads"] += 1
            elif "from strings" in normalized:
                counter["key_checks"] += 1
            elif "from modules" in normalized:
                counter["module_reads"] += 1
            elif "from activities" in normalized:
                counter["activity_reads"] += 1
            elif "from translations" in normalized:
                counter["translation_reads"] += 1
        if executemany:
            counter["executemany_calls"] += 1

    return count


def validate(engine, batch, size, rich, locales, forced):
    with Session(engine) as db:
        assert (
            db.scalar(
                select(func.count()).select_from(StringEntry).where(StringEntry.source_text == "A1")
            )
            == size
        )
        assert db.scalar(
            select(func.count()).select_from(Translation).where(Translation.value.like("% V1"))
        ) == size * len(locales)
        assert (
            db.scalar(
                select(func.count())
                .select_from(Activity)
                .where(Activity.batch_id == batch, Activity.reverted_by_id.is_not(None))
            )
            == size
        )
        markers = db.scalars(select(Activity).where(Activity.revert_of_id.is_not(None))).all()
        assert len(markers) == size
        originals = {
            row.id: row for row in db.scalars(select(Activity).where(Activity.batch_id == batch))
        }
        assert len({marker.batch_id for marker in markers}) == 1
        for marker in markers:
            original = originals[marker.revert_of_id]
            assert original.reverted_by_id == marker.id
            assert marker.after == original.before
            expected_before = {**original.after, "source_text": marker.before["source_text"]}
            assert marker.before == expected_before
            assert (
                marker.before["source_text"] == ("A3" if forced else "A2")
                and marker.after["source_text"] == "A1"
            )
            if rich:
                assert marker.after["published_source_text"] == "Published A1"
                assert marker.after["status"] == "public"
        assert db.scalar(select(func.count()).select_from(Activity)) == size * 2


def run_case(
    size: int,
    rich: bool,
    forced: bool,
    trials: int,
    implementation: str,
    combined_warmup: bool = False,
):
    admin = os.environ["DATABASE_URL"]
    suffix = uuid.uuid4().hex
    template_url = replace_database(admin, f"xlbench_{suffix}_seed")
    work_url = replace_database(admin, f"xlbench_{suffix}_work")
    create_database(template_url)
    engine = None
    try:
        project_id, batch, locales = seed(template_url, size, rich, forced)
        template_name = database_name(template_url)
        times = []
        preview_times = []
        query_metrics = {}
        # Warm-up, instrumented counting pass, then uninstrumented timed trials.
        counting_iteration = 0 if combined_warmup else 1
        timing_start = 1 if combined_warmup else 2
        for iteration in range(trials + timing_start):
            if engine is not None:
                engine.dispose()
            recreate_from_template(work_url, template_name)
            engine = engine_for(work_url)
            phase_times = {}
            for phase in ["preview", "undo"]:
                # Match the UI: preview and execution use separate request sessions.
                with Session(engine, autoflush=False) as db:
                    db.info["activity"] = dict(ACTOR)
                    project = db.get(Project, project_id)
                    counter = Counter()
                    hook = sql_counter(counter)
                    if iteration == counting_iteration:
                        event.listen(engine, "before_cursor_execute", hook)
                    started = perf_counter()
                    result = (
                        preview_revert_batch(db, project, batch)
                        if phase == "preview"
                        else revert_batch(db, project, batch, force=forced)
                    )
                    phase_times[phase] = perf_counter() - started
                    if iteration == counting_iteration:
                        event.remove(engine, "before_cursor_execute", hook)
                        query_metrics[phase] = dict(counter)
                    if phase == "undo":
                        assert result["reverted"] == size
                    else:
                        assert result.can_revert and result.requires_force == forced
            if iteration >= timing_start:
                times.append(phase_times["undo"])
                preview_times.append(phase_times["preview"])
            validate(engine, batch, size, rich, locales, forced)
        result = {
            "implementation": implementation,
            "size": size,
            "profile": "rich" if rich else "plain",
            "force": forced,
            "locales": len(locales),
            "tags_per_string": 3 if rich else 0,
            "trials": trials,
            "undo_median_s": round(statistics.median(times), 4),
            "undo_min_s": round(min(times), 4),
            "undo_max_s": round(max(times), 4),
            "preview_median_s": round(statistics.median(preview_times), 4),
            "undo_samples_s": [round(value, 4) for value in times],
            "query_counts": query_metrics,
            "correctness": (
                "all persisted content, original revert links, markers, "
                "and published state verified"
            ),
        }
        print(json.dumps(result), flush=True)
        return result
    finally:
        if engine is not None:
            engine.dispose()
        drop_database(work_url)
        drop_database(template_url)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", nargs="+", type=int, default=[1, 10, 100, 500, 1000])
    parser.add_argument(
        "--profiles", nargs="+", choices=["plain", "rich"], default=["plain", "rich"]
    )
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument(
        "--implementation",
        default="service",
        help="Result label; runs the imported production service",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--combined-warmup", action="store_true")
    parser.add_argument("--output", default="/tmp/x-locale-undo-benchmark-results.json")
    args = parser.parse_args()
    register_activity_listener()
    implementations = [args.implementation]
    results = [
        run_case(
            size,
            profile == "rich",
            args.force,
            args.trials,
            implementation,
            args.combined_warmup,
        )
        for profile in args.profiles
        for size in args.sizes
        for implementation in implementations
    ]
    payload = {
        "python": platform.python_version(),
        "database": "disposable Postgres databases cloned with CREATE DATABASE ... TEMPLATE",
        "database_url_host": os.environ["DATABASE_URL"].rsplit("@", 1)[-1],
        "warmup": "one combined warm-up/counting run"
        if args.combined_warmup
        else "one warm-up plus one counting run",
        "method": "actual production service, full audit listener, same autoflush=False setting as application; seed/clone/auth/setup/validation excluded from timing; uninstrumented timing trials; preview and Undo use separate fresh sessions",
        "results": results,
    }
    Path(args.output).write_text(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
