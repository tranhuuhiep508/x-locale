"""Shared Typer option types reused by push, pull, sync, and status."""

from typing import Annotated, Optional

import typer

from x_locale_cli.models import Layout, Stage

OutputDirOption = Annotated[
    Optional[str],
    typer.Option("--output-dir", help="Override output directory"),
]
LayoutOption = Annotated[
    Optional[Layout],
    typer.Option("--layout", help="Override layout"),
]
StageOption = Annotated[
    Optional[Stage],
    typer.Option("--stage", help="Override stage"),
]
LocalesOption = Annotated[
    Optional[str],
    typer.Option("--locales", help="Comma-separated locale list"),
]
DryRunOption = Annotated[
    bool,
    typer.Option("--dry-run", help="Preview changes without applying"),
]
FullPushOption = Annotated[
    bool,
    typer.Option(
        "--full",
        help="Push the entire base-language catalog (ignore push-index delta)",
    ),
]
