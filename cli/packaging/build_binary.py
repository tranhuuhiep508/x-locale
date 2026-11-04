"""Build a standalone ``loc`` executable for the current OS/CPU with PyInstaller.

Usage (from ``cli/``)::

    uv run --group build python packaging/build_binary.py

Writes ``dist/loc-<os>-<arch>[.exe]`` and smoke-tests it. PyInstaller cannot
cross-compile, so run this once per target platform (CI does this in a matrix).
"""

from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from pathlib import Path

import PyInstaller.__main__
from x_locale_cli import __version__

CLI_ROOT = Path(__file__).resolve().parents[1]
DIST = CLI_ROOT / "dist"
BUILD = CLI_ROOT / "build"

_OS = {"linux": "linux", "darwin": "macos", "win32": "windows"}
_ARCH = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}


def target_name() -> str:
    os_name = _OS.get(sys.platform)
    arch = _ARCH.get(platform.machine().lower())
    if os_name is None or arch is None:
        raise SystemExit(f"unsupported platform: {sys.platform}/{platform.machine()}")
    suffix = ".exe" if os_name == "windows" else ""
    return f"loc-{os_name}-{arch}{suffix}"


def build() -> Path:
    shutil.rmtree(BUILD, ignore_errors=True)
    PyInstaller.__main__.run(
        [
            str(CLI_ROOT / "x_locale_cli" / "__main__.py"),
            "--onefile",
            "--name",
            "loc",
            "--clean",
            "--noconfirm",
            "--distpath",
            str(DIST),
            "--workpath",
            str(BUILD),
            "--specpath",
            str(BUILD),
            # rich loads its Unicode width tables with importlib at runtime.
            "--collect-submodules",
            "rich._unicode_data",
        ]
    )
    built = DIST / ("loc.exe" if sys.platform == "win32" else "loc")
    target = DIST / target_name()
    built.replace(target)
    return target


def smoke_test(binary: Path) -> None:
    out = subprocess.run(
        [str(binary), "--version"], check=True, capture_output=True, text=True
    ).stdout.strip()
    if out != f"loc {__version__}":
        raise SystemExit(f"unexpected --version output: {out!r}")
    subprocess.run([str(binary), "--help"], check=True, capture_output=True)
    print(f"built {binary} ({binary.stat().st_size / 1_000_000:.1f} MB): {out}")


if __name__ == "__main__":
    smoke_test(build())
