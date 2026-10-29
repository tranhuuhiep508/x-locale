"""Reject oversized uploads before authentication or unbounded temporary writes."""

import tempfile

import httpx
import pytest

from app.config import settings
from app.limits import IMPORT_MAX_BYTES, IMPORT_REQUEST_MAX_BYTES
from app.main import app
from tests.helpers import make_project

CHUNK_SIZE = 64 * 1024
CONTENT_TYPE = b"multipart/form-data; boundary=upload-test"


def multipart(*files: bytes, padding: bytes = b"") -> bytes:
    parts = []
    for index, content in enumerate(files):
        name = "file" if index == 0 else "extra"
        parts.append(
            b"--upload-test\r\n"
            + f'Content-Disposition: form-data; name="{name}"; filename="vi.json"\r\n'.encode()
            + b"Content-Type: application/json\r\n\r\n"
            + content
            + b"\r\n"
        )
    if padding:
        parts.append(
            b'--upload-test\r\nContent-Disposition: form-data; name="padding"\r\n\r\n'
            + padding
            + b"\r\n"
        )
    return b"".join(parts) + b"--upload-test--\r\n"


async def upload(path, body, headers=(), *, chunk_size=CHUNK_SIZE, content_type=CONTENT_TYPE):
    """Control ASGI chunks and headers without a client's automatic Content-Length."""
    received = 0
    messages = []

    async def receive():
        nonlocal received
        chunk = body[received : received + chunk_size]
        received += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": received < len(body)}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", content_type), *headers],
        "server": ("testserver", 80),
        "client": ("testclient", 1234),
    }
    await app(scope, receive, send)
    starts = [message for message in messages if message["type"] == "http.response.start"]
    assert len(starts) == 1
    response = httpx.Response(
        starts[0]["status"],
        headers=starts[0]["headers"],
        content=b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        ),
    )
    return response, received


@pytest.fixture()
def import_target(client, monkeypatch):
    project = make_project(client, layout="flat")
    key = client.post(f"/api/projects/{project['id']}/api-keys", json={"name": "upload test"})
    assert key.status_code == 201, key.text
    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    client.cookies.clear()
    return f"/api/projects/{project['id']}/import", [(b"x-api-key", key.json()["key"].encode())]


@pytest.fixture()
def temporary_files(monkeypatch, tmp_path):
    files = []

    class TrackedFile(tempfile.SpooledTemporaryFile):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs, dir=tmp_path)
            self.written = 0
            self.disk_file = None
            files.append(self)

        def write(self, data):
            result = super().write(data)
            self.written += len(data)
            return result

        def rollover(self):
            super().rollover()
            self.disk_file = self._file

    monkeypatch.setattr("starlette.formparsers.SpooledTemporaryFile", TrackedFile)
    yield files
    assert all(file.closed for file in files)
    assert all(file.disk_file is None or file.disk_file.closed for file in files)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("authenticated", [False, True])
async def test_declared_oversized_upload_never_reads_body(
    import_target, temporary_files, authenticated
):
    path, credentials = import_target
    headers = credentials if authenticated else []
    headers = [*headers, (b"content-length", str(IMPORT_REQUEST_MAX_BYTES + 1).encode())]
    response, received = await upload(path, multipart(b"{}"), headers)
    assert response.status_code == 413, response.text
    assert str(IMPORT_REQUEST_MAX_BYTES) in response.json()["detail"]
    assert received == 0
    assert temporary_files == []


@pytest.mark.asyncio
@pytest.mark.parametrize("authenticated", [False, True])
@pytest.mark.parametrize("length", ["missing", "chunked", "understated"])
async def test_streamed_oversized_upload_stops_and_closes_disk_files(
    import_target, temporary_files, authenticated, length
):
    path, credentials = import_target
    headers = credentials if authenticated else []
    if length == "chunked":
        headers = [*headers, (b"transfer-encoding", b"chunked")]
    elif length == "understated":
        headers = [*headers, (b"content-length", b"1")]
    body = multipart(b"x" * (IMPORT_REQUEST_MAX_BYTES + 2 * CHUNK_SIZE))
    response, received = await upload(path, body, headers)
    assert response.status_code == 413, response.text
    assert IMPORT_REQUEST_MAX_BYTES < received <= IMPORT_REQUEST_MAX_BYTES + CHUNK_SIZE
    assert received < len(body)
    assert len(temporary_files) == 1
    assert temporary_files[0].written <= IMPORT_REQUEST_MAX_BYTES
    assert temporary_files[0].disk_file is not None


@pytest.mark.asyncio
async def test_total_limit_includes_all_files(import_target, temporary_files):
    path, credentials = import_target
    body = multipart(b"x" * (12 * 1024 * 1024), b"y" * (12 * 1024 * 1024))
    response, received = await upload(path, body, credentials)
    assert response.status_code == 413, response.text
    assert received < len(body)
    assert len(temporary_files) == 2
    assert sum(file.written for file in temporary_files) <= IMPORT_REQUEST_MAX_BYTES
    assert all(file.disk_file is not None for file in temporary_files)


@pytest.mark.asyncio
async def test_total_limit_includes_multipart_overhead_and_fields(
    import_target, temporary_files, monkeypatch
):
    monkeypatch.setattr("app.upload_limits.IMPORT_REQUEST_MAX_BYTES", 1024)
    path, credentials = import_target
    body = multipart(b"x" * 800, padding=b"y" * 400)
    response, _ = await upload(path, body, credentials, chunk_size=128)
    assert response.status_code == 413, response.text
    assert sum(file.written for file in temporary_files) <= 1024


@pytest.mark.asyncio
@pytest.mark.parametrize("extra_byte", [0, 1])
async def test_file_limit_preserves_existing_boundary(import_target, temporary_files, extra_byte):
    path, credentials = import_target
    content = b'{"hello":"world"}'
    content = content.ljust(IMPORT_MAX_BYTES + extra_byte, b" ")
    body = multipart(content)
    headers = [*credentials, (b"content-length", str(len(body)).encode())]
    response, received = await upload(path, body, headers)
    assert response.status_code == (400 if extra_byte else 200), response.text
    if extra_byte:
        assert str(IMPORT_MAX_BYTES) in response.json()["detail"]
    else:
        assert response.json()["created"] == 1
    assert received == len(body)
    assert temporary_files[0].disk_file is not None


@pytest.mark.asyncio
async def test_exact_request_limit_is_accepted(import_target, temporary_files, monkeypatch):
    path, credentials = import_target
    body = multipart(b'{"hello":"world"}')
    monkeypatch.setattr("app.upload_limits.IMPORT_REQUEST_MAX_BYTES", len(body))
    response, received = await upload(path, body, credentials)
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1
    assert received == len(body)


@pytest.mark.asyncio
async def test_small_unauthenticated_upload_still_returns_401(import_target, temporary_files):
    path, _ = import_target
    response, _ = await upload(path, multipart(b"{}"))
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_unrelated_multipart_error_remains_400(import_target, temporary_files):
    path, credentials = import_target
    response, _ = await upload(path, b"", credentials, content_type=b"multipart/form-data")
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Missing boundary in multipart."


@pytest.mark.asyncio
@pytest.mark.parametrize("length", [b"invalid", b"-1"])
async def test_invalid_content_length_returns_400(import_target, temporary_files, length):
    path, credentials = import_target
    response, received = await upload(
        path, multipart(b"{}"), [*credentials, (b"content-length", length)]
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid Content-Length"
    assert received == 0


def test_cli_json_import_is_not_subject_to_upload_cap(client, import_target, monkeypatch):
    path, credentials = import_target
    monkeypatch.setattr("app.upload_limits.IMPORT_REQUEST_MAX_BYTES", 1)
    response = client.post(
        path.replace("/import", "/strings/import"),
        headers=dict(credentials),
        json={"strings": {"hello": "world"}, "base_language": "vi"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1


def test_upload_limit_is_documented_only_on_file_import():
    paths = app.openapi()["paths"]
    assert "413" in paths["/api/projects/{project_id}/import"]["post"]["responses"]
    assert "413" not in paths["/api/projects/{project_id}/strings/import"]["post"]["responses"]
