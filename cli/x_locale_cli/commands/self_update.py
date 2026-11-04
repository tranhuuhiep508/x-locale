"""``loc self-update`` — replace the standalone binary with the one your server hosts."""

from __future__ import annotations

import hashlib
import os
import platform
import sys
from pathlib import Path
from typing import Annotated

import httpx
import typer

from x_locale_cli import __version__
from x_locale_cli.config import load_config
from x_locale_cli.console import console
from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import web_base_from_api_url

_OS = {"linux": "linux", "darwin": "macos", "win32": "windows"}
_ARCH = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}


def asset_name() -> str:

    os_name = _OS.get(sys.platform)
    arch = _ARCH.get(platform.machine().lower())
    if os_name is None or arch is None:
        raise XLocaleError(f"unsupported platform: {sys.platform}/{platform.machine()}")
    return f"loc-{os_name}-{arch}{'.exe' if os_name == 'windows' else ''}"


def _get(client: httpx.Client, url: str) -> httpx.Response:
    try:
        response = client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise XLocaleError(f"download failed: {url} ({exc})") from exc
    return response


def replace_binary(target: Path, data: bytes) -> None:
    """Swap ``target`` for ``data``; Windows cannot overwrite a running exe, so rename it."""
    new = target.with_name(target.name + ".new")
    new.write_bytes(data)
    new.chmod(0o755)
    if os.name == "nt":
        old = target.with_name(target.name + ".old")
        old.unlink(missing_ok=True)
        target.rename(old)
        new.rename(target)
    else:
        new.replace(target)


def self_update(
    server: Annotated[
        str | None,
        typer.Option("--server", help="x-locale server origin (default: api_url from config)."),
    ] = None,
) -> None:
    """Update this standalone `loc` binary from your x-locale server."""
    if not getattr(sys, "frozen", False):
        raise XLocaleError(
            "self-update only works for the standalone binary; "
            "with Python, upgrade the package (e.g. `uv tool upgrade x-locale-cli`)."
        )
    base = web_base_from_api_url(server or load_config().api_url) + "/cli"
    asset = asset_name()
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        latest = _get(client, f"{base}/VERSION").text.strip()
        if latest == __version__:
            console.print(f"loc {__version__} is already the latest version.")
            return
        data = _get(client, f"{base}/{asset}").content
        sums = _get(client, f"{base}/SHA256SUMS").text.splitlines()
    expected = next(
        (line.split()[0] for line in sums if line.split()[-1:] == [asset]), None
    )
    if expected is None:
        raise XLocaleError(f"{asset} is missing from SHA256SUMS")
    if hashlib.sha256(data).hexdigest() != expected.lower():
        raise XLocaleError(f"checksum mismatch for {asset}; nothing was changed")
    replace_binary(Path(sys.executable), data)
    console.print(f"Updated loc {__version__} -> {latest}")
