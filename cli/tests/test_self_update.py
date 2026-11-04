"""``loc self-update``: checksum verification and binary replacement."""

from __future__ import annotations

import hashlib
import importlib
import sys
from pathlib import Path

import httpx
from typer.testing import CliRunner

from x_locale_cli.app import app

mod = importlib.import_module("x_locale_cli.commands.self_update")


def _serve(monkeypatch, files: dict[str, bytes]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = files.get(request.url.path.rsplit("/", 1)[-1])
        return httpx.Response(200, content=body) if body is not None else httpx.Response(404)

    real = httpx.Client
    monkeypatch.setattr(
        mod.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )


def _setup(monkeypatch, tmp_path: Path, binary: bytes, *, sums: str | None = None):
    asset = mod.asset_name()
    exe = tmp_path / "loc"
    exe.write_bytes(b"old")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe))
    digest = hashlib.sha256(binary).hexdigest()
    _serve(
        monkeypatch,
        {"VERSION": b"9.9.9\n", asset: binary, "SHA256SUMS": (sums or f"{digest}  {asset}\n").encode()},
    )
    return exe


def test_updates_binary_when_checksum_matches(monkeypatch, tmp_path):
    exe = _setup(monkeypatch, tmp_path, b"new-binary")
    result = CliRunner().invoke(app, ["self-update", "--server", "http://x.test"])
    assert result.exit_code == 0, result.output
    assert exe.read_bytes() == b"new-binary"


def test_checksum_mismatch_keeps_old_binary(monkeypatch, tmp_path):
    exe = _setup(monkeypatch, tmp_path, b"new-binary", sums=f"{'0' * 64}  {mod.asset_name()}\n")
    result = CliRunner().invoke(app, ["self-update", "--server", "http://x.test"])
    assert result.exit_code == 1
    assert "checksum mismatch" in result.output
    assert exe.read_bytes() == b"old"


def test_refuses_outside_standalone_binary(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    result = CliRunner().invoke(app, ["self-update", "--server", "http://x.test"])
    assert result.exit_code == 1
    assert "standalone binary" in result.output


def test_noop_when_already_latest(monkeypatch, tmp_path):
    exe = _setup(monkeypatch, tmp_path, b"new-binary")
    monkeypatch.setattr(mod, "__version__", "9.9.9")
    result = CliRunner().invoke(app, ["self-update", "--server", "http://x.test"])
    assert "already the latest" in result.output
    assert exe.read_bytes() == b"old"
