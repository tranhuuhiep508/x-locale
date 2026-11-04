"""CLI command functions. Each module is a thin Typer command."""

from x_locale_cli.commands.init import init
from x_locale_cli.commands.pull import pull
from x_locale_cli.commands.push import push
from x_locale_cli.commands.self_update import self_update
from x_locale_cli.commands.status import status
from x_locale_cli.commands.sync import sync

COMMANDS = (init, push, pull, sync, status, self_update)

__all__ = ["COMMANDS", "init", "pull", "push", "self_update", "status", "sync"]
