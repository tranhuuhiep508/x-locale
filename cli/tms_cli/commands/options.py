"""Shared Typer option types reused by push, pull, sync, and status."""

from __future__ import annotations

from typing import Annotated

import typer

from tms_cli.models import Layout, Stage

OutputDirOption = Annotated[
    str | None,
    typer.Option("--output-dir", help="Override output directory"),
]
LayoutOption = Annotated[
    Layout | None,
    typer.Option("--layout", help="Override layout"),
]
StageOption = Annotated[
    Stage | None,
    typer.Option("--stage", help="Override stage"),
]
LocalesOption = Annotated[
    str | None,
    typer.Option("--locales", help="Comma-separated locale list"),
]
DryRunOption = Annotated[
    bool,
    typer.Option("--dry-run", help="Preview changes without applying"),
]
