"""User-facing CLI errors.

Business logic raises ``XLocaleError``. The Typer app converts it into a printed
message and exit code 1, so commands stay free of ``typer.Exit``.
"""

from __future__ import annotations


class XLocaleError(Exception):
    """Recoverable failure shown to the user without a traceback."""


class XLocaleExit(Exception):
    """Exit after a report was already printed (no extra error line)."""

    def __init__(self, code: int = 1) -> None:
        self.code = code
        super().__init__(f"exit {code}")
