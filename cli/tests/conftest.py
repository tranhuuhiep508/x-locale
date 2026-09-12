import os
import re

import pytest

# Disable colored CLI help so substring assertions stay stable. Rich still emits
# bold/dim ANSI when FORCE_COLOR is set (pytest and some CI runners do this),
# which splits "--layout" into styled "-" + "-layout" and breaks assertIn.
os.environ["NO_COLOR"] = "1"
os.environ["TERM"] = "dumb"
os.environ.pop("FORCE_COLOR", None)

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from CLI/help output."""
    return _ANSI_RE.sub("", text)


@pytest.fixture(autouse=True)
def _disable_cli_color() -> None:
    os.environ["NO_COLOR"] = "1"
    os.environ["TERM"] = "dumb"
    os.environ.pop("FORCE_COLOR", None)
