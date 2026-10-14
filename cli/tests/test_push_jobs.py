"""Push waits for a background import job before it touches the push index."""

from __future__ import annotations

import json
from importlib import import_module

import httpx
import pytest
from tests.test_sync_safety import Api, config_for
from typer.testing import CliRunner
from x_locale_cli.app import app
from x_locale_cli.client import api_client, is_job_accepted, progress_label, wait_for_job
from x_locale_cli.errors import JobFailedError, XLocaleError
from x_locale_cli.ops import push_strings
from x_locale_cli.push_index import (
    atomic_write_push_index,
    catalog_hashes_flat,
    index_file_path,
    pending_file_path,
    scope_from_config,
)

JOB_ID = "11111111-1111-1111-1111-111111111111"
RESULT = {"created": 1, "updated": 0, "total": 1, "dry_run": False, "diff": {"create_count": 1}}


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".x-locale").mkdir()
    monkeypatch.setattr("x_locale_cli.client.time.sleep", lambda _seconds: None)
    return tmp_path


class JobApi(Api):
    """Import answers 202; each job poll returns the next queued job state."""

    def __init__(self, config, states):
        super().__init__(config)
        self.import_status = 202
        self.import_body = {"job_id": JOB_ID, "status": "running", "kind": "import"}
        self.states = list(states)
        self.polls = 0

    def handle(self, request):
        if request.url.path == f"/api/jobs/{JOB_ID}":
            self.calls.append(request)
            self.polls += 1
            state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
            if isinstance(state, int):
                return httpx.Response(state, json={"detail": "Job not found"})
            return httpx.Response(200, json={"id": JOB_ID, "kind": "import", **state})
        return super().handle(request)


def running(phase="writing", done=1, total=3):
    return {
        "status": "running",
        "progress": {"phase": phase, "chunks_done": done, "chunks_total": total},
    }


def failed(status_code, detail, error=None):
    return {
        "status": "failed",
        "error": error or (detail if isinstance(detail, str) else detail["message"]),
        "result": {"error": {"status_code": status_code, "detail": detail}},
    }


def seed_index(config):
    atomic_write_push_index(scope_from_config(config), catalog_hashes_flat({"k": "Old"}))
    return index_file_path().read_bytes()


def test_api_client_opts_in_to_async_imports(workspace):
    with api_client(config_for(workspace)) as client:
        assert client.headers["Prefer"] == "respond-async"
        assert client.headers["X-API-Key"] == "test"


def test_job_helpers():
    assert is_job_accepted({"job_id": JOB_ID, "status": "running", "kind": "import"})
    assert not is_job_accepted(RESULT)
    assert not is_job_accepted({**RESULT, "job_id": JOB_ID})
    assert progress_label(None) == "running"
    assert progress_label({"phase": "queued", "chunks_done": 0, "chunks_total": 0}) == "queued"
    assert progress_label({"phase": "writing", "chunks_done": 2, "chunks_total": 3}) == "writing 2/3"


def test_push_waits_for_completed_job_then_updates_index(workspace):
    config = config_for(workspace)
    seed_index(config)
    api = JobApi(config, [running("queued", 0, 0), running(), {"status": "completed", "result": RESULT}])
    push_strings(config, client=api.client)
    assert [request.method for request in api.calls] == ["GET", "POST", "GET", "GET", "GET"]
    assert api.polls == 3
    assert json.loads(index_file_path().read_text())["entries"] == catalog_hashes_flat({"k": "Local"})
    assert not pending_file_path().exists()


@pytest.mark.parametrize("preexisting", [False, True])
def test_rejected_job_leaves_index_and_clears_only_new_marker(workspace, monkeypatch, preexisting):
    config = config_for(workspace)
    before = seed_index(config)
    if preexisting:
        pending_file_path().write_text("preexisting")
    detail = {"code": "deleted_keys", "message": "Keys were deleted remotely"}
    api = JobApi(config, [running(), failed(409, detail)])
    command = import_module("x_locale_cli.commands.push")
    monkeypatch.setattr(command, "runtime_config", lambda **kwargs: config)
    monkeypatch.setattr("x_locale_cli.ops.api_client", lambda config: api.client)
    result = CliRunner().invoke(app, ["push"])
    assert result.exit_code == 1
    output = " ".join(result.output.split())
    assert "Push failed (409): Keys were deleted remotely" in output
    assert JOB_ID in output
    assert index_file_path().read_bytes() == before
    assert pending_file_path().exists() == preexisting


def test_unexpected_job_failure_keeps_marker(workspace):
    config = config_for(workspace)
    before = seed_index(config)
    api = JobApi(config, [failed(500, "Job failed unexpectedly")])
    with pytest.raises(JobFailedError, match=r"Push failed \(500\)"):
        push_strings(config, client=api.client)
    assert index_file_path().read_bytes() == before
    assert pending_file_path().exists()


@pytest.mark.parametrize("poll_error", [404, 503])
def test_poll_errors_keep_marker_even_when_status_is_allowlisted(workspace, poll_error):
    config = config_for(workspace)
    before = seed_index(config)
    api = JobApi(config, [poll_error])
    with pytest.raises(XLocaleError, match="may still finish on the server") as caught:
        push_strings(config, client=api.client)
    assert caught.value.__cause__ is None
    assert index_file_path().read_bytes() == before
    assert pending_file_path().exists()


def test_job_timeout_keeps_marker_and_reports_job(workspace, monkeypatch):
    monkeypatch.setenv("X_LOCALE_JOB_TIMEOUT", "0")
    config = config_for(workspace)
    before = seed_index(config)
    api = JobApi(config, [running()])
    with pytest.raises(XLocaleError, match=rf"still running on the server after 0s \(job {JOB_ID}\)"):
        push_strings(config, client=api.client)
    assert index_file_path().read_bytes() == before
    assert pending_file_path().exists()


def test_wait_for_job_backs_off_and_reports_progress():
    states = [running("queued", 0, 0)] * 4 + [{"status": "completed", "result": RESULT}]
    delays, seen = [], []

    def handle(request):
        return httpx.Response(200, json={"id": JOB_ID, **states.pop(0)})

    client = httpx.Client(transport=httpx.MockTransport(handle), base_url="https://example.test")
    result = wait_for_job(
        client, JOB_ID, action="Push", timeout=60, on_progress=seen.append, sleep=delays.append,
        clock=lambda: 0.0,
    )
    assert result == RESULT
    assert delays == [1.0, 1.5, 2.25, 3.0]
    assert [progress["phase"] for progress in seen] == ["queued"] * 4


def test_sync_200_response_is_unchanged(workspace):
    config = config_for(workspace)
    api = Api(config)
    push_strings(config, client=api.client)
    assert [request.method for request in api.calls] == ["GET", "POST"]
    assert json.loads(index_file_path().read_text())["entries"] == catalog_hashes_flat({"k": "Local"})
