"""Real import routes on disposable Postgres databases; setup is not timed.

Run from backend/: uv run python -m benchmarks.imports --size 20000 --trials 3
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
from contextlib import contextmanager
from time import perf_counter

from tests.pg import disposable_database, load_dotenv_defaults, validate_test_database_env

load_dotenv_defaults()

from fastapi import UploadFile  # noqa: E402
from openpyxl import Workbook  # noqa: E402
from sqlalchemy import create_engine, event, func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.database import Base, register_activity_listener  # noqa: E402
from app.models import Activity, Project, StringEntry, Translation  # noqa: E402
from app.routers.sync import import_project, import_strings_compat  # noqa: E402
from app.schemas import ImportPayload  # noqa: E402

FORMATS = ("json-flat", "json-modular", "cli-flat", "cli-modular", "xlsx-flat", "xlsx-modular")
LIMITS = {"fresh": 6.0, "unchanged": 2.0, "changed_10_percent": 2.0}


def payload(kind: str, size: int, changed: bool):
    format, layout = kind.split("-")
    modules = {}
    for index in range(size):
        slug = ("auth", "home", "common")[index % 3] if layout == "modular" else "strings"
        maps = modules.setdefault(slug, {"vi": {}, "en": {}, "fr": {}})
        key = f"key.{index}"
        maps["vi"][key] = f"Source {index}" + (" changed" if changed and index < size // 10 else "")
        maps["en"][key] = f"English {index}"
        maps["fr"][key] = f"French {index}"
    if format == "cli":
        return (
            ImportPayload(modules={slug: {"vi": maps["vi"]} for slug, maps in modules.items()})
            if layout == "modular"
            else ImportPayload(strings=modules["strings"]["vi"])
        )
    if format == "json":
        return json.dumps(
            {"modules": modules} if layout == "modular" else modules["strings"]
        ).encode()
    workbook = Workbook(write_only=True)
    for slug, maps in modules.items():
        sheet = workbook.create_sheet(slug)
        sheet.append(["key", "vi", "en", "fr"])
        for key in maps["vi"]:
            sheet.append([key, *(maps[locale][key] for locale in ("vi", "en", "fr"))])
    raw = io.BytesIO()
    workbook.save(raw)
    return raw.getvalue()


def run_case(kind: str, *, size: int = 20000, trials: int = 3) -> dict:
    import os

    validate_test_database_env(
        os.environ.get("TEST_DATABASE_URL", ""), os.environ.get("DATABASE_URL", "")
    )
    register_activity_listener()
    original, changed = payload(kind, size, False), payload(kind, size, True)
    measurements = {name: [] for name in LIMITS}
    counts = {name: [] for name in LIMITS}
    for _ in range(trials):
        with contextmanager(disposable_database)() as url:
            engine = create_engine(url)
            try:
                Base.metadata.create_all(engine)
                with Session(engine, autoflush=False) as db:
                    project = Project(
                        name="Import benchmark",
                        slug="import-bench",
                        base_language="vi",
                        target_languages=["en", "fr"],
                        layout=kind.split("-")[1],
                    )
                    db.add(project)
                    db.commit()
                    pid = project.id
                for scenario in LIMITS:
                    data = changed if scenario == "changed_10_percent" else original
                    count = 0

                    def observe(*_args):
                        nonlocal count
                        count += 1

                    with Session(engine, autoflush=False) as db:
                        project = db.get(Project, pid)
                        db.info["activity"] = {"actor_type": "system", "actor_label": "Benchmark"}
                        event.listen(engine, "before_cursor_execute", observe)
                        try:
                            start = perf_counter()
                            if kind.startswith("cli"):
                                result = import_strings_compat(data, project, db)
                            else:
                                result = import_project(
                                    project,
                                    db,
                                    UploadFile(
                                        file=io.BytesIO(data),
                                        filename="import.xlsx"
                                        if kind.startswith("xlsx")
                                        else "import.json",
                                    ),
                                )
                            measurements[scenario].append(perf_counter() - start)
                            counts[scenario].append(count)
                        finally:
                            event.remove(engine, "before_cursor_execute", observe)
                        assert result.total == size
                        assert result.created == (size if scenario == "fresh" else 0)
                        expected = size // 10 if scenario == "changed_10_percent" else 0
                        assert result.updated == expected
                        audited = db.scalar(
                            select(func.count())
                            .select_from(Activity)
                            .where(Activity.batch_id == result.batch_id)
                        )
                        assert audited == (size if scenario == "fresh" else expected)
                        assert db.scalar(select(func.count()).select_from(StringEntry)) == size
                        assert db.scalar(select(func.count()).select_from(Translation)) == size * 2
            finally:
                engine.dispose()
    return {
        "format": kind,
        "size": size,
        "trials": trials,
        "scenarios": {
            name: {
                "seconds": measurements[name],
                "median_seconds": statistics.median(measurements[name]),
                "sql_statements": counts[name],
            }
            for name in LIMITS
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int, default=20000)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--formats", nargs="+", choices=FORMATS, default=FORMATS)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for kind in args.formats:
        result = run_case(kind, size=args.size, trials=args.trials)
        print(json.dumps(result), flush=True)
        if args.check:
            for name, limit in LIMITS.items():
                assert result["scenarios"][name]["median_seconds"] < limit, (kind, name, result)


if __name__ == "__main__":
    main()
