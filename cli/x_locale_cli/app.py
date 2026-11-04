"""Typer application: register commands and convert ``XLocaleError`` to exit 1."""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any

import typer

from x_locale_cli import __version__
from x_locale_cli.commands import COMMANDS
from x_locale_cli.console import console
from x_locale_cli.errors import XLocaleError, XLocaleExit

app = typer.Typer(
    help="x-locale CLI — sync translations with your x-locale server",
    no_args_is_help=True,
    rich_markup_mode="rich",
    context_settings={"help_option_names": ["-h", "--help"]},
)


def _print_version(value: bool) -> None:
    if value:
        typer.echo(f"loc {__version__}")
        raise typer.Exit()


@app.callback()
def _root(
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        callback=_print_version,
        is_eager=True,
        help="Show the version and exit.",
    ),
) -> None:
    """x-locale CLI — sync translations with your x-locale server."""


def _register(command: Callable[..., Any]) -> None:
    @functools.wraps(command)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        try:
            return command(*args, **kwargs)
        except XLocaleError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(1) from exc
        except XLocaleExit as exc:
            raise typer.Exit(exc.code) from exc

    app.command()(wrapped)


for _command in COMMANDS:
    _register(_command)
