"""Domain types used across the CLI (config, layouts, reports)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

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
    project_slug: str = ""
    output_dir: str = DEFAULT_OUTPUT_DIR
    layout: Layout = DEFAULT_LAYOUT
    stage: Stage = DEFAULT_STAGE
    base_language: str = DEFAULT_BASE_LANGUAGE
    locales: list[str] = field(default_factory=list)
    manifest: bool = False
    web_url: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Config:
        raw = data or {}
        locales = parse_locales(raw.get("locales")) or []
        return cls(
            api_url=str(raw.get("api_url") or DEFAULT_API_URL),
            api_key=str(raw.get("api_key") or ""),
            project_id=str(raw.get("project_id") or ""),
            project_slug=str(raw.get("project_slug") or ""),
            output_dir=str(raw.get("output_dir") or DEFAULT_OUTPUT_DIR),
            layout=parse_layout(raw.get("layout")),
            stage=parse_stage(raw.get("stage")),
            base_language=str(raw.get("base_language") or DEFAULT_BASE_LANGUAGE),
            locales=locales,
            manifest=bool(raw.get("manifest", False)),
            web_url=str(raw.get("web_url") or "").strip(),
        )

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"api_url": self.api_url}
        if self.web_url:
            data["web_url"] = self.web_url
        data.update(
            {
                "api_key": self.api_key,
                "output_dir": self.output_dir,
                "layout": self.layout.value,
                "stage": self.stage.value,
                "base_language": self.base_language,
                "locales": list(self.locales),
                "manifest": self.manifest,
            }
        )
        if self.project_slug:
            data["project_slug"] = self.project_slug
        elif self.project_id:
            data["project_id"] = self.project_id
        return data

    @property
    def project_ref(self) -> str:
        return self.project_slug or self.project_id

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


def is_absolute_http_url(url: str) -> bool:
    """True when ``url`` has an http(s) scheme and a host."""
    parsed = urlsplit(url.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def normalize_web_base(url: str) -> str:
    """Trim a configured web origin and add ``http://`` when the scheme is omitted."""
    cleaned = url.strip()
    if not cleaned:
        return ""
    if "://" not in cleaned:
        cleaned = f"http://{cleaned}"
    return cleaned.rstrip("/")


def web_base_from_api_url(api_url: str) -> str:
    """API origin used when ``web_url`` is unset.

    Trailing slashes are removed. A single trailing ``/api`` path segment is
    removed when present; ``api_url`` is already the API origin in normal configs.
    """
    cleaned = api_url.strip().rstrip("/")
    parsed = urlsplit(cleaned)
    if parsed.path == "/api" or parsed.path.endswith("/api"):
        trimmed = urlunsplit((parsed.scheme, parsed.netloc, parsed.path[: -len("/api")], "", ""))
        return trimmed.rstrip("/")
    return cleaned


def resolve_web_base(
    config: Config,
    environ: Mapping[str, str] | None = None,
) -> str | None:
    """Absolute web origin for a push review link, or ``None`` when it cannot be resolved.

    ``config.web_url`` wins. ``XLOCALE_WEB_URL`` applies only when that field is
    unset. Otherwise the normalized API origin is used.
    """
    explicit = config.web_url.strip()
    if not explicit:
        env = os.environ if environ is None else environ
        explicit = env.get("XLOCALE_WEB_URL", "").strip()
    candidate = normalize_web_base(explicit) if explicit else web_base_from_api_url(config.api_url)
    if not is_absolute_http_url(candidate):
        return None
    return candidate.rstrip("/")


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
    """Export payload and sync-state from a pull, reusable by ``loc sync``."""

    export: Any
    state: dict[str, Any]


@dataclass(frozen=True)
class ChangeItem:
    """One created/updated/mismatched key in a sync report."""

    key: str
    extra: str = ""
