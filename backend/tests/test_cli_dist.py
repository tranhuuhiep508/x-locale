"""Public /cli downloads of the standalone `loc` binary."""

from __future__ import annotations

import pytest

from app.config import settings


@pytest.fixture()
def dist(tmp_path, monkeypatch):
    (tmp_path / "loc-linux-x64").write_bytes(b"\x7fELF")
    (tmp_path / "SHA256SUMS").write_text("abc  loc-linux-x64\n")
    (tmp_path / "VERSION").write_text("1.2.3\n")
    (tmp_path / "install.sh").write_text('BASE="${LOC_BASE_URL:-__LOC_BASE_URL__}"\n')
    (tmp_path / "secret.txt").write_text("nope")
    monkeypatch.setattr(settings, "cli_dist_dir", str(tmp_path))
    monkeypatch.setattr(settings, "public_url", "")
    return tmp_path


def test_serves_binary_and_metadata(client, dist):
    assert client.get("/cli/loc-linux-x64").content == b"\x7fELF"
    assert client.get("/cli/VERSION").text.strip() == "1.2.3"
    assert "loc-linux-x64" in client.get("/cli/SHA256SUMS").text


def test_install_script_gets_server_origin(client, dist):
    assert "http://testserver}" in client.get("/cli/install.sh").text
    settings.public_url = "https://x-locale.example.com/"
    assert "https://x-locale.example.com}" in client.get("/cli/install.sh").text


@pytest.mark.parametrize("name", ["secret.txt", "loc-linux-arm64", "..%2Fsecret.txt", "install.ps1"])
def test_unknown_or_unlisted_files_are_404(client, dist, name):
    assert client.get(f"/cli/{name}").status_code == 404


def test_404_when_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "cli_dist_dir", "")
    assert client.get("/cli/VERSION").status_code == 404
