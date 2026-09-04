"""Windows shim installer — use after `uv tool install x-locale-cli` on Smart App Control systems."""

from __future__ import annotations

import shutil
import sys
import sysconfig
from importlib.resources import files
from pathlib import Path


def install_shim() -> bool:
    """Replace unsigned locale.exe with locale.cmd. Returns True if a change was made."""
    if sys.platform != "win32":
        return False

    scripts_dir = Path(sysconfig.get_path("scripts"))
    exe_path = scripts_dir / "locale.exe"
    cmd_path = scripts_dir / "locale.cmd"
    cmd_src = files("x_locale_cli").joinpath("locale.cmd")

    with cmd_src.open("rb") as src, cmd_path.open("wb") as dst:
        shutil.copyfileobj(src, dst)

    changed = exe_path.exists()
    if changed:
        exe_path.unlink()

    return changed or not cmd_path.exists()


def main() -> None:
    if sys.platform != "win32":
        print("Windows shim not needed on this platform.")
        return

    install_shim()
    print("locale command ready. Try: locale --help")


if __name__ == "__main__":
    main()
