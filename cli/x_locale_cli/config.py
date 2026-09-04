"""Load, save, and override ``.x-locale/config.yaml``."""

from __future__ import annotations

from pathlib import Path

import yaml

from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import Config, Layout, Stage, parse_locales

CONFIG_DIR = Path(".x-locale")
CONFIG_FILE = CONFIG_DIR / "config.yaml"


def load_config(path: Path = CONFIG_FILE) -> Config:
    if not path.exists():
        raise XLocaleError("No config found. Run `locale init` first.")
    with path.open("r", encoding="utf-8") as fh:
        return Config.from_dict(yaml.safe_load(fh) or {})


def save_config(config: Config, path: Path = CONFIG_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(config.to_dict(), fh, sort_keys=False)


def require_project_id(config: Config) -> str:
    if not config.project_id:
        raise XLocaleError("project_id missing from config. Run `locale init` first.")
    return config.project_id


def runtime_config(
    *,
    output_dir: str | None = None,
    layout: Layout | None = None,
    stage: Stage | None = None,
    locales: str | None = None,
) -> Config:
    """Config file plus the shared per-command override flags."""
    return load_config().with_overrides(
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        locales=parse_locales(locales),
    )
