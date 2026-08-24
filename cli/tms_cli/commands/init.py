"""``tms init`` — discover the project and write ``.tms/config.yaml``."""

from __future__ import annotations

from typing import Annotated

import typer

from tms_cli.client import api_client, request_json
from tms_cli.config import CONFIG_FILE, save_config
from tms_cli.console import console
from tms_cli.models import (
    DEFAULT_API_URL,
    DEFAULT_BASE_LANGUAGE,
    DEFAULT_OUTPUT_DIR,
    Config,
    Layout,
    Stage,
    parse_layout,
)


def init(
    api_key: Annotated[str, typer.Option("-k", "--api-key", help="Project API key (tms_…)")],
    api_url: Annotated[
        str, typer.Option("-u", "--api-url", help="TMS server base URL")
    ] = DEFAULT_API_URL,
    output_dir: Annotated[
        str, typer.Option("-o", "--output-dir", help="Directory for locale files")
    ] = DEFAULT_OUTPUT_DIR,
    base_language: Annotated[
        str | None,
        typer.Option("--base-language", help="Override project base/source language"),
    ] = None,
    layout: Annotated[
        Layout | None,
        typer.Option("--layout", help="File layout: flat or modular"),
    ] = None,
    stage: Annotated[
        Stage, typer.Option("--stage", help="Default pull stage: draft or public")
    ] = Stage.draft,
) -> None:
    """Initialise TMS config by discovering the project linked to the API key."""
    bootstrap = Config(api_url=api_url, api_key=api_key)
    with api_client(bootstrap) as client:
        project = request_json(client, "GET", "/api/bootstrap", action="Bootstrap")

    project_id = str(project["id"])
    project_base = base_language or project.get("base_language") or DEFAULT_BASE_LANGUAGE
    target_languages: list[str] = project.get("target_languages") or []
    locales = [project_base, *[lc for lc in target_languages if lc != project_base]]
    effective_layout = layout if layout is not None else parse_layout(project.get("layout"))

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
    save_config(config)

    console.print(
        f"[green]Initialized[/green] project=[bold]{project['name']}[/bold] ({project_id})"
    )
    console.print(
        f"  Base: {project_base}  ·  Locales: {', '.join(locales)}"
        f"  ·  Layout: {effective_layout}  ·  Stage: {stage}"
    )
    console.print(f"Config saved to [bold]{CONFIG_FILE}[/bold]")
