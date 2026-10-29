"""Failed pull writes preserve the destination, including on partial writes."""

import json
import os
import stat
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from x_locale_cli import io
from x_locale_cli.models import Config


def write_output(kind: str, path: Path) -> str:
    if kind == "locale":
        io.write_locale_file(path, {"z": "Xin chào", "a": "A"})
        return '{\n  "a": "A",\n  "z": "Xin chào"\n}\n'
    manifest = {"modules": ["auth"], "locales": ["vi"], "base_language": "vi"}
    config = Config.from_dict(
        {"api_url": "http://localhost:8000", "api_key": "k", "layout": "modular"}
    )
    io.apply_pull_export(
        io.PullPlan(
            config=config,
            output_root=path.parent,
            writes=[],
            expected_paths={path},
            prune_paths=[],
            manifest_path=path,
            manifest=manifest,
            base_locale_touched=False,
        )
    )
    return json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"


@pytest.mark.parametrize("kind", ["locale", "manifest"])
@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("failure", ["write", "flush", "fsync", "replace"])
def test_failed_write_preserves_destination(tmp_path, kind, existing, failure):
    path = tmp_path / ("vi.json" if kind == "locale" else "manifest.json")
    previous = b'{"local_only": "Unpushed source"}\n'
    if existing:
        path.write_bytes(previous)
    error = OSError("injected disk failure")
    original_open = open

    @contextmanager
    def failing_open(*args, **kwargs):
        with original_open(*args, **kwargs) as stream:
            wrapper = Mock(wraps=stream)
            wrapper.name = stream.name

            def partial_write(text):
                stream.write(text[:5])
                stream.flush()
                raise error

            if failure == "write":
                wrapper.write.side_effect = partial_write
            else:
                wrapper.flush.side_effect = error
            yield wrapper

    with ExitStack() as stack:
        if failure in ("write", "flush"):
            stack.enter_context(patch.object(io, "open", failing_open, create=True))
        else:
            stack.enter_context(patch.object(io.os, failure, side_effect=error))
        with pytest.raises(OSError) as caught:
            write_output(kind, path)
    assert caught.value is error
    if existing:
        assert path.read_bytes() == previous
        assert json.loads(path.read_text(encoding="utf-8")) == {"local_only": "Unpushed source"}
    else:
        assert not path.exists()
    assert set(tmp_path.iterdir()) == ({path} if existing else set())


@pytest.mark.parametrize("kind", ["locale", "manifest"])
@pytest.mark.parametrize("existing", [False, True])
def test_successful_write_replaces_destination(tmp_path, kind, existing):
    path = tmp_path / ("vi.json" if kind == "locale" else "manifest.json")
    if existing:
        path.write_text("{}", encoding="utf-8")
        path.chmod(0o640)
    expected = write_output(kind, path)
    assert path.read_bytes() == expected.encode("utf-8")
    if existing:
        assert stat.S_IMODE(path.stat().st_mode) == 0o640
    assert set(tmp_path.iterdir()) == {path}


def test_replace_happens_after_flush_sync_and_close(tmp_path):
    path = tmp_path / "vi.json"
    original_open = open
    original_replace = io.os.replace
    original_fsync = io.os.fsync
    streams = []

    @contextmanager
    def track_open(*args, **kwargs):
        with original_open(*args, **kwargs) as stream:
            streams.append(stream)
            yield stream

    def check_fsync(fd):
        stream = streams[0]
        assert not stream.closed
        assert json.loads(Path(stream.name).read_text(encoding="utf-8")) == {"k": "v"}
        original_fsync(fd)

    def check_replace(source, destination):
        assert streams[0].closed
        synced.assert_called_once()
        assert source.parent == destination.parent
        original_replace(source, destination)

    with (
        patch.object(io, "open", track_open, create=True),
        patch.object(io.os, "fsync", side_effect=check_fsync) as synced,
        patch.object(io.os, "replace", side_effect=check_replace),
    ):
        io.write_locale_file(path, {"k": "v"})
    assert json.loads(path.read_text(encoding="utf-8")) == {"k": "v"}


@pytest.mark.skipif(os.name == "nt", reason="POSIX permission modes")
@pytest.mark.parametrize("kind", ["locale", "manifest"])
@pytest.mark.parametrize("mask", [0o022, 0o027, 0o077])
def test_new_file_permissions_respect_umask(tmp_path, kind, mask):
    path = tmp_path / ("vi.json" if kind == "locale" else "manifest.json")
    previous_mask = os.umask(mask)
    try:
        write_output(kind, path)
    finally:
        os.umask(previous_mask)
    assert stat.S_IMODE(path.stat().st_mode) == 0o666 & ~mask
