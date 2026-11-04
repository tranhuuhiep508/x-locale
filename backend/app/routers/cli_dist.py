"""Serve the standalone `loc` CLI binaries and install scripts (no GitHub needed).

Files come from ``CLI_DIST_DIR``; see ``cli/README.md`` for how releases land there.
These are public, read-only downloads: the binaries contain no secrets.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse

from app.config import settings

router = APIRouter(tags=["cli"])

PLACEHOLDER = "__LOC_BASE_URL__"
_BINARY = re.compile(r"^loc-(linux|macos|windows)-(x64|arm64)(\.exe)?$")
_PLAIN = {"SHA256SUMS", "VERSION"}
_SCRIPTS = {"install.sh": "text/x-shellscript", "install.ps1": "text/plain"}


def _dist_dir() -> Path:
    directory = settings.cli_dist_directory
    if directory is None:
        raise HTTPException(404, "CLI downloads are not configured on this server")
    return directory


def _public_origin(request: Request) -> str:
    return (settings.public_url.strip() or str(request.base_url)).rstrip("/")


@router.get("/{name}")
def download(name: str, request: Request):
    directory = _dist_dir()
    if name in _SCRIPTS:
        path = directory / name
        if not path.is_file():
            raise HTTPException(404, "Not found")
        body = path.read_text(encoding="utf-8").replace(PLACEHOLDER, _public_origin(request))
        return PlainTextResponse(
            body, media_type=_SCRIPTS[name], headers={"Cache-Control": "no-cache"}
        )
    if name in _PLAIN or _BINARY.match(name):
        path = directory / name
        if path.is_file():
            kind = "text/plain" if name in _PLAIN else "application/octet-stream"
            return FileResponse(path, media_type=kind, headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, "Not found")
