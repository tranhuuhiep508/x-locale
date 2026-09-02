"""``tms init`` — discover the project and write ``.tms/config.yaml``."""

from __future__ import annotations

import sys
from typing import Annotated, Any

import typer
from rich.markup import escape

from tms_cli.client import api_client, request_json
from tms_cli.config import CONFIG_FILE, save_config
from tms_cli.console import console
from tms_cli.errors import TmsError
from tms_cli.models import (
    DEFAULT_API_URL,
    DEFAULT_BASE_LANGUAGE,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_STAGE,
    Config,
    Layout,
    Stage,
    parse_layout,
)

_STAGE_CHOICES = ", ".join(item.value for item in Stage)


def init(
    api_key: Annotated[
        str | None,
        typer.Option("-k", "--api-key", help="Project API key (tms_…). Prompted if omitted."),
    ] = None,
    api_url: Annotated[
        str | None,
        typer.Option("-u", "--api-url", help="TMS server base URL"),
    ] = None,
    output_dir: Annotated[
        str | None,
        typer.Option("-o", "--output-dir", help="Directory for locale files"),
    ] = None,
    base_language: Annotated[
        str | None,
        typer.Option("--base-language", help="Override project base/source language"),
    ] = None,
    layout: Annotated[
        Layout | None,
        typer.Option("--layout", help="Override file layout (otherwise taken from the project)"),
    ] = None,
    stage: Annotated[
        Stage | None,
        typer.Option("--stage", help="Default pull stage: draft or public"),
    ] = None,
    yes: Annotated[
        bool,
        typer.Option("-y", "--yes", help="Skip prompts and overwrite existing config"),
    ] = False,
) -> None:
    """Initialise TMS config from the project linked to an API key.

    Run with no flags in a terminal for an interactive wizard. Flags skip the
    matching prompt; ``-y/--yes`` uses defaults and overwrites
    ``.tms/config.yaml`` without asking. Layout, locales, and base language
    come from the server unless overridden.
    """
    wizard = _use_wizard(
        yes=yes,
        api_key=api_key,
        api_url=api_url,
        output_dir=output_dir,
        layout=layout,
        stage=stage,
        base_language=base_language,
    )
    if wizard:
        console.print(
            "[bold]TMS init[/bold] — connect this directory to a project",
            highlight=False,
        )

    api_url = _normalize_api_url(
        _value_or_prompt(
            api_url,
            label="API URL",
            default=DEFAULT_API_URL,
            prompt=wizard,
        )
    )
    api_key = _require_api_key(api_key, prompt=wizard)

    console.print("Discovering project…", highlight=False)
    project = _discover_project(api_url, api_key)
    project_id = str(project["id"])
    project_name = str(project.get("name") or project_id)
    project_base = base_language or project.get("base_language") or DEFAULT_BASE_LANGUAGE
    target_languages: list[str] = project.get("target_languages") or []
    locales = [project_base, *[lc for lc in target_languages if lc != project_base]]
    effective_layout = layout if layout is not None else parse_layout(project.get("layout"))

    _print_discovered(
        name=project_name,
        project_id=project_id,
        base=project_base,
        locales=locales,
        layout=effective_layout,
    )

    output_dir = _value_or_prompt(
        output_dir,
        label="Output directory",
        default=DEFAULT_OUTPUT_DIR,
        prompt=wizard,
    ).strip() or DEFAULT_OUTPUT_DIR
    stage = _resolve_stage(stage, prompt=wizard)

    config = Config(
        api_url=api_url,
        project_id=project_id,
        api_key=api_key,
        output_dir=output_dir,
        layout=effective_layout,
        stage=stage,
        base_language=project_base,
        locales=locales,
        manifest=True,
    )
    _confirm_write(yes=yes)

    save_config(config)
    console.print(
        f"[green]Initialized[/green] project=[bold]{escape(project_name)}[/bold] ({project_id})",
        highlight=False,
    )
    console.print(
        f"  Base: {project_base}  ·  Locales: {', '.join(locales)}"
        f"  ·  Layout: {effective_layout.value}  ·  Stage: {stage.value}",
        highlight=False,
    )
    console.print(f"Config saved to [bold]{CONFIG_FILE}[/bold]", highlight=False)


def _stdin_is_tty() -> bool:
    isatty = getattr(sys.stdin, "isatty", None)
    return bool(isatty()) if callable(isatty) else False


def _use_wizard(
    *,
    yes: bool,
    api_key: str | None,
    api_url: str | None,
    output_dir: str | None,
    layout: Layout | None,
    stage: Stage | None,
    base_language: str | None,
) -> bool:
    """Prompt for omitted values only when `tms init` is run with no flags."""
    if yes or not _stdin_is_tty():
        return False
    return all(
        value is None
        for value in (api_key, api_url, output_dir, layout, stage, base_language)
    )


def _normalize_api_url(url: str) -> str:
    cleaned = url.strip()
    if not cleaned:
        raise TmsError("API URL is required.")
    if "://" not in cleaned:
        cleaned = f"http://{cleaned}"
    return cleaned.rstrip("/")


def _value_or_prompt(
    value: str | None,
    *,
    label: str,
    default: str,
    prompt: bool,
) -> str:
    if value is not None:
        return value
    if prompt:
        return str(typer.prompt(label, default=default))
    return default


def _require_api_key(value: str | None, *, prompt: bool) -> str:
    if value is not None and value.strip():
        return value.strip()
    if not prompt:
        raise TmsError("API key is required. Pass -k/--api-key or run `tms init` in a terminal.")
    hide_input = sys.stdin.isatty()
    while True:
        typed = str(typer.prompt("API key", hide_input=hide_input)).strip()
        if typed:
            return typed
        console.print("[red]API key cannot be empty.[/red]", highlight=False)


def _resolve_stage(value: Stage | None, *, prompt: bool) -> Stage:
    if value is not None:
        return value
    if not prompt:
        return DEFAULT_STAGE
    while True:
        raw = str(typer.prompt("Pull stage", default=DEFAULT_STAGE.value)).strip().lower()
        try:
            return Stage(raw)
        except ValueError:
            console.print(f"[red]Stage must be {_STAGE_CHOICES}.[/red]", highlight=False)


def _discover_project(api_url: str, api_key: str) -> dict[str, Any]:
    bootstrap = Config(api_url=api_url, api_key=api_key)
    with api_client(bootstrap) as client:
        project = request_json(client, "GET", "/api/bootstrap", action="Bootstrap")
    if not isinstance(project, dict) or not project.get("id"):
        raise TmsError("Bootstrap failed: server did not return a project.")
    return project


def _print_discovered(
    *,
    name: str,
    project_id: str,
    base: str,
    locales: list[str],
    layout: Layout,
) -> None:
    console.print(f"Found: [bold]{escape(name)}[/bold]", highlight=False)
    console.print(f"  id:      {project_id}", highlight=False)
    console.print(f"  base:    {base}", highlight=False)
    console.print(f"  locales: {', '.join(locales) if locales else '—'}", highlight=False)
    console.print(f"  layout:  {layout.value}  (from project)", highlight=False)


def _confirm_write(*, yes: bool) -> None:
    if not CONFIG_FILE.exists() or yes:
        return
    if _stdin_is_tty():
        if typer.confirm(f"{CONFIG_FILE} already exists. Overwrite?", default=False):
            return
        raise TmsError("Cancelled — existing config was not changed.")
    raise TmsError(f"{CONFIG_FILE} already exists. Re-run with --yes to overwrite.")
