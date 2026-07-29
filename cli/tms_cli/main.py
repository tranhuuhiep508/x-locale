from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import typer
import yaml
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="TMS CLI — sync translations with your code")
console = Console()

CONFIG_DIR = Path(".tms")
CONFIG_FILE = CONFIG_DIR / "config.yaml"


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        raise typer.Exit("No config found. Run `tms init` first.")
    with CONFIG_FILE.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_config(config: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        yaml.safe_dump(config, f, sort_keys=False)


def parse_locale_json(data: dict[str, Any]) -> dict[str, str]:
    strings: dict[str, str] = {}
    for key, value in data.items():
        if not isinstance(value, str):
            raise typer.Exit(
                f"Locale JSON requires string values; got {type(value).__name__} for key {key!r}"
            )
        strings[key] = value
    return strings


def locale_json_from_strings(strings: dict[str, str]) -> dict[str, str]:
    return dict(sorted(strings.items()))


def api_client(config: dict[str, Any]) -> httpx.Client:
    return httpx.Client(
        base_url=config["api_url"].rstrip("/"),
        params={"api_key": config["api_key"]},
        timeout=60.0,
    )


def discover_project_id(client: httpx.Client) -> str:
    response = client.get("/bootstrap/project")
    response.raise_for_status()
    return response.json()["id"]


@app.command()
def init(
    api_key: str = typer.Option(..., "-k", "--api-key", help="Project API key"),
    api_url: str = typer.Option("http://localhost:8000", "-u", "--api-url", help="TMS API URL"),
    output_dir: str = typer.Option("./locales", "-o", "--output-dir", help="Directory for locale JSON files"),
    base_language: str = typer.Option("en", help="Base/source language code"),
) -> None:
    """Initialize TMS config for this repository."""
    config = {
        "api_url": api_url,
        "api_key": api_key,
        "output_dir": output_dir,
        "base_language": base_language,
    }

    with api_client(config) as client:
        project_id = discover_project_id(client)
        config["project_id"] = project_id

    save_config(config)
    console.print(f"[green]Initialized TMS[/green] project={project_id}")
    console.print(f"Config written to {CONFIG_FILE}")


@app.command()
def push(
    source_file: Path = typer.Argument(..., help="Path to base language JSON file"),
) -> None:
    """Push local source strings to TMS."""
    config = load_config()
    if not source_file.exists():
        raise typer.Exit(f"File not found: {source_file}")

    with source_file.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise typer.Exit("Locale JSON must be a top-level object")

    strings = parse_locale_json(data)
    project_id = config.get("project_id")
    if not project_id:
        with api_client(config) as client:
            project_id = discover_project_id(client)
            config["project_id"] = project_id
            save_config(config)

    with api_client(config) as client:
        response = client.post(
            f"/projects/{project_id}/strings/import",
            json={"strings": strings},
        )
        response.raise_for_status()
        result = response.json()

    table = Table(title="Push result")
    table.add_column("Metric")
    table.add_column("Count")
    table.add_row("Created", str(result["created"]))
    table.add_row("Updated", str(result["updated"]))
    table.add_row("Total", str(result["total"]))
    console.print(table)


@app.command()
def pull(
    output_dir: Path | None = typer.Argument(None, help="Override output directory"),
) -> None:
    """Pull all translations from TMS to local JSON files."""
    config = load_config()
    out = Path(output_dir or config.get("output_dir", "./locales"))
    out.mkdir(parents=True, exist_ok=True)

    project_id = config.get("project_id")
    if not project_id:
        with api_client(config) as client:
            project_id = discover_project_id(client)
            config["project_id"] = project_id
            save_config(config)

    with api_client(config) as client:
        response = client.get(f"/projects/{project_id}/translations.json")
        response.raise_for_status()
        translations = response.json()

    for locale, strings in translations.items():
        payload = locale_json_from_strings(strings)
        target = out / f"{locale}.json"
        with target.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        console.print(f"[green]Wrote[/green] {target} ({len(strings)} keys)")


if __name__ == "__main__":
    app()
