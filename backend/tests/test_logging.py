"""JSON wire format and real Uvicorn output, without a database connection."""

import json
import logging
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import pytest

from app.logging import CustomJsonFormatter, HealthCheckFilter, _LogSettings

BACKEND = Path(__file__).resolve().parents[1]
KEYS = [
    "@timestamp",
    "log.level",
    "organization.name",
    "service.name",
    "event.dataset",
    "thread.name",
    "process.name",
    "log.logger",
    "log.origin.file.name",
    "log.origin.function",
    "log.origin.file.line",
    "message",
]


@pytest.fixture
def clean_metadata(monkeypatch):
    monkeypatch.setitem(_LogSettings.model_config, "env_file", None)
    monkeypatch.delenv("SCRUM_TEAM", raising=False)
    monkeypatch.delenv("APP_NAME", raising=False)


def assert_record(line):
    record = json.loads(line)
    assert list(record) == KEYS
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d{4}", record["@timestamp"])
    assert isinstance(record["log.origin.file.line"], int)
    return record


def test_format_and_metadata(clean_metadata, monkeypatch):
    record = logging.LogRecord(
        "different.logger",
        logging.INFO,
        "/src/analyze.py",
        120,
        "Started %s\nnext line",
        ("Tiếng Việt",),
        None,
        "analyze",
    )
    record.msecs = 7
    line = CustomJsonFormatter().format(record)
    assert len(line.splitlines()) == 1
    data = assert_record(line)
    assert data["@timestamp"].split(".")[1].startswith("007")
    assert data["organization.name"] == "digital"
    assert data["service.name"] == "x-locale"
    assert data["event.dataset"] == "application"
    assert data["log.logger"] == data["log.origin.file.name"] == "analyze.py"
    assert data["log.origin.function"] == "analyze"
    assert data["log.origin.file.line"] == 120
    assert data["message"] == "Started Tiếng Việt\nnext line"
    assert data["log.level"] == "INFO"
    assert data["thread.name"] == record.threadName
    assert data["process.name"] == record.processName
    monkeypatch.setenv("SCRUM_TEAM", "team")
    monkeypatch.setenv("APP_NAME", "service")
    overridden = assert_record(CustomJsonFormatter().format(record))
    assert overridden["organization.name"] == "team"
    assert overridden["service.name"] == "service"


def test_metadata_dotenv(clean_metadata, monkeypatch, tmp_path):
    dotenv = tmp_path / ".env"
    dotenv.write_text("SCRUM_TEAM=dotenv-team\nAPP_NAME=dotenv-app\nUNRELATED=value\n")
    monkeypatch.setitem(_LogSettings.model_config, "env_file", dotenv)
    assert CustomJsonFormatter().settings.scrum_team == "dotenv-team"
    monkeypatch.setenv("SCRUM_TEAM", "environment-team")
    assert CustomJsonFormatter().settings.scrum_team == "environment-team"


def test_exception_is_inside_message(clean_metadata):
    try:
        raise ValueError("example failure")
    except ValueError:
        record = logging.LogRecord(
            "example", logging.ERROR, __file__, 1, "Failed", (), sys.exc_info()
        )
    line = CustomJsonFormatter().format(record)
    assert len(line.splitlines()) == 1
    data = assert_record(line)
    assert data["log.level"] == "ERROR"
    assert "Failed\nTraceback" in data["message"]
    assert "ValueError: example failure" in data["message"]


@pytest.mark.parametrize("path", sorted(HealthCheckFilter._PATHS))
def test_health_filter_is_access_only(path, clean_metadata):
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("client", "GET", path + "?api_key=secret", "1.1", 200),
        None,
    )
    assert not HealthCheckFilter().filter(record)
    record.name = "app.example"
    assert HealthCheckFilter().filter(record)
    record.name = "uvicorn.access"
    record.args = ("client", "GET", path + "/other?api_key=secret", "1.1", 200)
    assert HealthCheckFilter().filter(record)
    message = assert_record(CustomJsonFormatter().format(record))["message"]
    assert "secret" not in message
    assert path + "/other" in message


def test_setup_replaces_handlers_and_preserves_migration_levels():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import logging
from app.logging import setup_logging
setup_logging()
setup_logging()
assert logging.getLogger('sqlalchemy.engine').getEffectiveLevel() == logging.WARNING
assert logging.getLogger('alembic').getEffectiveLevel() == logging.INFO
for name in ('example', 'uvicorn', 'uvicorn.error', 'uvicorn.access'):
    logging.getLogger(name).info('one message')
""",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stderr == ""
    assert len(result.stdout.splitlines()) == 4
    for line in result.stdout.splitlines():
        assert assert_record(line)["message"] == "one message"


@pytest.mark.parametrize("level, access", [("warning", True), ("debug", True), ("warning", False)])
def test_app_import_preserves_uvicorn_options(level, access):
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            f"""
import logging
from uvicorn import Config
config = Config('app.main:app', log_config='app/logging.json',
                log_level={level!r}, access_log={access!r})
handler = logging.getLogger().handlers[0]
config.load_app()
assert logging.getLogger().handlers == [handler]
assert logging.getLogger('uvicorn.error').getEffectiveLevel() == logging.{level.upper()}
assert logging.getLogger('uvicorn.access').getEffectiveLevel() == logging.{level.upper()}
assert logging.getLogger('uvicorn.access').propagate is {access!r}
""",
        ],
        cwd=BACKEND,
        env={
            **os.environ,
            "DATABASE_URL": "postgresql+psycopg://unused:unused@localhost/unused",
            "SECRET_ENABLE": "false",
        },
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stderr == result.stdout == ""


@pytest.mark.parametrize(
    "failure",
    [
        "CommandError(\"Can't locate revision identified by 'missing_revision'\")",
        "RuntimeError('Example connection failure')",
        "SystemExit('A Postgres DATABASE_URL is required')",
    ],
)
def test_migrate_failures_are_json_and_exit_nonzero(failure):
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            f"""
from unittest.mock import patch
from alembic.util import CommandError
from app.cli import app
with patch('alembic.command.upgrade', side_effect={failure}):
    app(['migrate'])
""",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert result.stderr == ""
    records = [assert_record(line) for line in result.stdout.splitlines()]
    assert len(records) == 1
    assert records[0]["log.level"] == "ERROR"
    assert records[0]["message"].startswith("Database migration failed\nTraceback")
    assert "FAILED:" not in result.stdout


def test_migrate_uses_bundled_config_and_upgrades_head():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import logging
from pathlib import Path
from unittest.mock import patch
from app.cli import app
def upgrade(config, revision):
    assert Path(config.config_file_name).is_absolute()
    assert Path(config.config_file_name).is_file()
    assert revision == 'head'
    logging.info('Migration succeeded')
with patch('alembic.command.upgrade', side_effect=upgrade):
    app(['migrate'])
""",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stderr == ""
    records = [assert_record(line) for line in result.stdout.splitlines()]
    assert sum(record["message"] == "Migration succeeded" for record in records) == 1


def test_alembic_configuration_uses_json_without_disabling_existing_loggers():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import logging
from logging.config import fileConfig
existing = logging.getLogger('app.existing')
fileConfig('alembic.ini', disable_existing_loggers=False)
logging.getLogger('alembic').info('Migration started')
existing.warning('Existing logger still works')
""",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stderr == ""
    records = [assert_record(line) for line in result.stdout.splitlines()]
    assert [record["message"] for record in records] == [
        "Migration started",
        "Existing logger still works",
    ]


@pytest.mark.parametrize("mode", ["single", "reload", "workers"])
def test_uvicorn_stdout(tmp_path, mode):
    # Import the real entry module, but bypass lifespan/database work for this wire-format check.
    (tmp_path / "logging_probe.py").write_text("""
import logging
from app.main import app
from app.database import get_db
class Database:
    def execute(self, statement):
        pass
app.dependency_overrides[get_db] = lambda: Database()
@app.get("/logging-probe")
def probe():
    logging.info("Logging probe started")
    try:
        raise ValueError("Logging probe failure")
    except ValueError:
        logging.error("Logging probe failed", exc_info=True)
    return {"ok": True}
""")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "logging_probe:app",
        "--app-dir",
        str(tmp_path),
        "--log-config",
        "app/logging.json",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--lifespan",
        "off",
    ]
    if mode == "reload":
        command += ["--reload", "--reload-dir", str(tmp_path)]
    elif mode == "workers":
        command += ["--workers", "2"]
    env = {
        **os.environ,
        "DATABASE_URL": "postgresql+psycopg://unused:unused@localhost/unused",
        "SECRET_ENABLE": "false",
        "SCRUM_TEAM": "digital",
        "APP_NAME": "x-locale",
    }
    with (tmp_path / "stdout").open("w+") as stdout, (tmp_path / "stderr").open("w+") as stderr:
        process = subprocess.Popen(command, cwd=BACKEND, env=env, stdout=stdout, stderr=stderr)
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    with urlopen(f"http://127.0.0.1:{port}/health", timeout=1):
                        break
                except URLError:
                    assert process.poll() is None, "Uvicorn exited before serving requests"
                    assert time.monotonic() < deadline, "Uvicorn did not start"
                    time.sleep(0.1)
            for path in sorted(HealthCheckFilter._PATHS):
                with urlopen(f"http://127.0.0.1:{port}{path}?api_key=private-key", timeout=5):
                    pass
            with urlopen(f"http://127.0.0.1:{port}/logging-probe?api_key=private-key", timeout=5):
                pass
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        stdout.seek(0)
        stderr.seek(0)
        output = stdout.read()
        assert stderr.read() == ""
    assert "private-key" not in output
    records = [assert_record(line) for line in output.splitlines()]
    messages = [record["message"] for record in records]
    assert "Logging probe started" in messages
    assert any("ValueError: Logging probe failure" in message for message in messages)
    accesses = [message for message in messages if '"GET ' in message]
    assert len(accesses) == 1
    assert '"GET /logging-probe HTTP/1.1" 200' in accesses[0]
    assert any("Started server process" in message for message in messages)
    assert any("Finished server process" in message for message in messages)
    if mode == "reload":
        assert any("Started reloader process" in message for message in messages)
    elif mode == "workers":
        assert any("Started parent process" in message for message in messages)
