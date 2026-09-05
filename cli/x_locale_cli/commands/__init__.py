"""CLI command functions. Each module is a thin Typer command."""

from x_locale_cli.commands.init import init
from x_locale_cli.commands.pull import pull
from x_locale_cli.commands.push import push
from x_locale_cli.commands.status import status
from x_locale_cli.commands.sync import sync

COMMANDS = (init, push, pull, sync, status)

__all__ = ["COMMANDS", "init", "push", "pull", "sync", "status"]
