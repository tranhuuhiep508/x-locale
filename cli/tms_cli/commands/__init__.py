"""CLI command functions. Each module is a thin Typer command."""

from tms_cli.commands.init import init
from tms_cli.commands.pull import pull
from tms_cli.commands.push import push
from tms_cli.commands.status import status
from tms_cli.commands.sync import sync

COMMANDS = (init, push, pull, sync, status)

__all__ = ["COMMANDS", "init", "push", "pull", "sync", "status"]
