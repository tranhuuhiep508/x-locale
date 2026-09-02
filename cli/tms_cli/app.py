"""Typer application: register commands and convert ``TmsError`` to exit 1."""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any

import typer

from tms_cli.commands import COMMANDS
from tms_cli.console import console
from tms_cli.errors import TmsError, TmsExit

app = typer.Typer(
    help="TMS CLI — sync translations with your TMS server",
    no_args_is_help=True,
    rich_markup_mode="rich",
    context_settings={"help_option_names": ["-h", "--help"]},
)


def _register(command: Callable[..., Any]) -> None:
    @functools.wraps(command)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        try:
            return command(*args, **kwargs)
        except TmsError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc
        except TmsExit as exc:
            raise typer.Exit(exc.code) from exc

    app.command()(wrapped)


for _command in COMMANDS:
    _register(_command)
