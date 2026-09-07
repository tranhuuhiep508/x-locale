"""Domain types used across the CLI (config, layouts, reports)."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any


DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_OUTPUT_DIR = "./locales"
DEFAULT_BASE_LANGUAGE = "en"
UNASSIGNED_SLUG = "_unassigned"


class Layout(str, Enum):
    """On-disk locale file layout. Stored on the project; overridable per command."""

    flat = "flat"
    modular = "modular"


class Stage(str, Enum):
    """Which string stage to export. Draft is the working copy; public is the last published snapshot."""

    draft = "draft"
    public = "public"


DEFAULT_LAYOUT = Layout.flat
DEFAULT_STAGE = Stage.draft


def parse_locales(value: str | list[str] | None) -> list[str] | None:
    """Parse a comma-separated locale list. ``None`` means “do not override”."""
    if value is None:
        return None
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_layout(value: Any, default: Layout = DEFAULT_LAYOUT) -> Layout:
    if isinstance(value, Layout):
        return value
    if value is None or value == "":
        return default
    try:
        return Layout(str(value))
    except ValueError:
        return default


def parse_stage(value: Any, default: Stage = DEFAULT_STAGE) -> Stage:
    if isinstance(value, Stage):
        return value
    if value is None or value == "":
        return default
    try:
        return Stage(str(value))
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    """Project config from ``.x-locale/config.yaml``, with optional CLI overrides."""

    api_url: str
    api_key: str
    project_id: str = ""
    output_dir: str = DEFAULT_OUTPUT_DIR
    layout: Layout = DEFAULT_LAYOUT
    stage: Stage = DEFAULT_STAGE
    base_language: str = DEFAULT_BASE_LANGUAGE
    locales: list[str] = field(default_factory=list)
    manifest: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Config:
        raw = data or {}
        locales = parse_locales(raw.get("locales")) or []
        return cls(
            api_url=str(raw.get("api_url") or DEFAULT_API_URL),
            api_key=str(raw.get("api_key") or ""),
            project_id=str(raw.get("project_id") or ""),
            output_dir=str(raw.get("output_dir") or DEFAULT_OUTPUT_DIR),
            layout=parse_layout(raw.get("layout")),
            stage=parse_stage(raw.get("stage")),
            base_language=str(raw.get("base_language") or DEFAULT_BASE_LANGUAGE),
            locales=locales,
            manifest=bool(raw.get("manifest", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "api_url": self.api_url,
            "project_id": self.project_id,
            "api_key": self.api_key,
            "output_dir": self.output_dir,
            "layout": self.layout.value,
            "stage": self.stage.value,
            "base_language": self.base_language,
            "locales": list(self.locales),
            "manifest": self.manifest,
        }

    def with_overrides(
        self,
        *,
        output_dir: str | None = None,
        layout: Layout | None = None,
        stage: Stage | None = None,
        locales: list[str] | None = None,
    ) -> Config:
        """Return a copy with any non-``None`` overrides applied."""
        return replace(
            self,
            output_dir=self.output_dir if output_dir is None else output_dir,
            layout=self.layout if layout is None else layout,
            stage=self.stage if stage is None else stage,
            locales=self.locales if locales is None else locales,
        )

    @property
    def output_path(self) -> Path:
        return Path(self.output_dir)

    @property
    def locale_filter(self) -> list[str] | None:
        """Locales to pull/status against, or ``None`` for every locale."""
        return self.locales or None


@dataclass
class PulledFileReport:
    path: Path
    keys: list[str] = field(default_factory=list)
    new_keys: list[str] = field(default_factory=list)
    updated_keys: list[str] = field(default_factory=list)
    removed_keys: list[str] = field(default_factory=list)
    written: bool = True


@dataclass
class PullResult:
    """Export payload and sync-state from a pull, reusable by ``locale sync``."""

    export: Any
    state: dict[str, Any]


@dataclass(frozen=True)
class ChangeItem:
    """One created/updated/mismatched key in a sync report."""

    key: str
    extra: str = ""
