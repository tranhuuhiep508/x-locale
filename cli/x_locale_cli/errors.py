"""User-facing CLI errors.

Business logic raises ``XLocaleError``. The Typer app converts it into a printed
message and exit code 1, so commands stay free of ``typer.Exit``.
"""

from __future__ import annotations


class XLocaleError(Exception):
    """Recoverable failure shown to the user without a traceback."""


class JobFailedError(XLocaleError):
    """A background job ended as failed; its transaction was rolled back."""

    def __init__(self, message: str, *, status_code: int | None) -> None:
        self.status_code = status_code
        super().__init__(message)


class XLocaleExit(Exception):
    """Exit after a report was already printed (no extra error line)."""

    def __init__(self, code: int = 1) -> None:
        self.code = code
        super().__init__(f"exit {code}")
