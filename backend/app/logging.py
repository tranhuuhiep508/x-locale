"""Single-line JSON logs for container stdout collectors."""

import json
import logging
import logging.config
from datetime import datetime
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND = Path(__file__).resolve().parents[1]


class _LogSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_BACKEND / ".env", _BACKEND.parent / ".env"), extra="ignore"
    )
    scrum_team: str = "digital"
    app_name: str = "x-locale"


class CustomJsonFormatter(logging.Formatter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.settings = _LogSettings()

    def formatTime(self, record, datefmt=None):
        timestamp = datetime.fromtimestamp(record.created).astimezone()
        return (
            timestamp.strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{int(record.msecs):03d}"
            + timestamp.strftime("%z")
        )

    def format(self, record):
        message = record.getMessage()
        if (
            record.name == "uvicorn.access"
            and isinstance(record.args, tuple)
            and len(record.args) == 5
        ):
            # Query strings can contain API keys and OAuth authorization codes.
            client, method, target, version, status = record.args
            message = record.msg % (client, method, target.split("?", 1)[0], version, status)
        if record.exc_info:
            message += "\n" + self.formatException(record.exc_info)
        if record.stack_info:
            message += "\n" + self.formatStack(record.stack_info)
        return json.dumps(
            {
                "@timestamp": self.formatTime(record),
                "log.level": record.levelname,
                "organization.name": self.settings.scrum_team,
                "service.name": self.settings.app_name,
                "event.dataset": "application",
                "thread.name": record.threadName,
                "process.name": record.processName,
                "log.logger": record.filename,
                "log.origin.file.name": record.filename,
                "log.origin.function": record.funcName,
                "log.origin.file.line": record.lineno,
                "message": message,
            },
            ensure_ascii=False,
        )


class HealthCheckFilter(logging.Filter):
    _PATHS = {"/health", "/api/health", "/healthcheck/liveness", "/healthcheck/readiness"}

    def filter(self, record):
        if (
            record.name == "uvicorn.access"
            and isinstance(record.args, tuple)
            and len(record.args) == 5
        ):
            return record.args[2].split("?", 1)[0] not in self._PATHS
        return True


def setup_logging():
    # Uvicorn applies its CLI options after loading this config, before importing the app.
    if any(
        handler in logging.getLogger().handlers
        and isinstance(handler.formatter, CustomJsonFormatter)
        for handler in logging.getLogger("uvicorn").handlers
    ):
        return
    with (_BACKEND / "app" / "logging.json").open() as config:
        logging.config.dictConfig(json.load(config))
