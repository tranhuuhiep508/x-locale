"""Exercise real SDK serialization, parsing and retries without a live model."""

from __future__ import annotations

import json
import logging
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import httpx2
import pytest
from openai import DEFAULT_TIMEOUT, DefaultHttpxClient, OpenAI
from pydantic import ValidationError

from app import ai
from app.ai import AIConfigurationError, AITranslationError, TranslatedCell, TranslateItem
from app.config import Settings, settings

SECRET = "sentinel-credential"
UPSTREAM = "sentinel-upstream-content"
ITEM = TranslateItem("s1", "Lưu {name}", ("en",), "Use Save; concise UI tone")


@pytest.fixture
def ai_logs(caplog):
    # Alembic's fileConfig disables loggers that already exist. Turn this one back on.
    ai_logger = logging.getLogger("app.ai")
    ai_logger.disabled = False
    caplog.set_level(logging.ERROR, logger="app.ai")
    return caplog


def row(item_id="s1", **kwargs):
    return {
        "id": item_id,
        "translations": [{"locale": "en", "text": "Save", "confidence": 88, **kwargs}],
    }


def response_body(items=None, *, status="completed", text=None, content=None):
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 0,
        "model": "test-model",
        "status": status,
        "error": None,
        "incomplete_details": {"reason": "max_output_tokens"} if status == "incomplete" else None,
        "output": [
            {"id": "rs_test", "type": "reasoning", "summary": []},
            {
                "id": "msg_test",
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": content
                if content is not None
                else [
                    {
                        "type": "output_text",
                        "text": text
                        if text is not None
                        else json.dumps({"items": items if items is not None else [row()]}),
                        "annotations": [],
                    }
                ],
            },
        ],
    }


def prompt_items(request):
    return json.loads(json.loads(request.content)["input"].partition("Items:\n")[2])


def complete_response(request):
    return response_body(
        [
            {
                "id": item["id"],
                "translations": [
                    {"locale": loc, "text": f"{loc}:{item['source']}", "confidence": 88}
                    for loc in item["locales"]
                ],
            }
            for item in prompt_items(request)
        ]
    )


@pytest.fixture
def sdk(monkeypatch):
    ai.close_ai_client()
    monkeypatch.setattr(settings, "openai_api_key", SECRET)
    monkeypatch.setattr(settings, "openai_model", "test-model")
    monkeypatch.setattr(settings, "openai_base_url", "")
    monkeypatch.setattr(settings, "ai_translate_stub", False)
    monkeypatch.setattr(settings, "ai_translate_batch_size", 20)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 5)
    requests = []
    handler = Mock(side_effect=lambda req: httpx2.Response(200, json=complete_response(req)))

    def transport(request):
        requests.append(request)
        return handler(request)

    clients = []

    def create(**kwargs):
        assert "timeout" not in kwargs
        client = OpenAI(
            **kwargs, http_client=DefaultHttpxClient(transport=httpx2.MockTransport(transport))
        )
        assert client.timeout == DEFAULT_TIMEOUT
        clients.append(client)
        return client

    factory = Mock(side_effect=create)
    monkeypatch.setattr(ai, "OpenAI", factory)
    # Skip SDK backoff sleeping; retry policy and HTTP attempts remain real.
    monkeypatch.setattr("openai._base_client.time.sleep", lambda delay: None)
    yield handler, requests, factory, clients
    ai.close_ai_client()


def test_request_schema_model_tokens_prompt_and_base_url(sdk, monkeypatch):
    handler, requests, factory, clients = sdk
    monkeypatch.setattr(settings, "openai_max_output_tokens", 8000)
    monkeypatch.setattr(settings, "openai_base_url", " https://gateway.example/api/v1 ")
    assert ai.translate_batch("vi", [ITEM])["s1"]["en"].confidence == 88
    request = requests[0]
    body = json.loads(request.content)
    assert str(request.url) == "https://gateway.example/api/v1/responses"
    assert body["model"] == "test-model"
    assert body["max_output_tokens"] == 8000
    assert body["reasoning"] == {"effort": "none"}
    assert "timeout" not in body
    assert request.extensions["timeout"] == DEFAULT_TIMEOUT.as_dict()
    assert "Use Save; concise UI tone" in body["input"]
    assert "Preserve placeholders exactly" in body["input"]
    assert "mandatory and win over" in body["input"]
    assert "confidence 0-100" in body["input"]
    fmt = body["text"]["format"]
    assert fmt["strict"] is True
    schema = fmt["schema"]
    for obj in [schema, *schema["$defs"].values()]:
        assert obj["type"] == "object"
        assert obj["additionalProperties"] is False
        assert set(obj["required"]) == set(obj["properties"])
    assert schema["required"] == ["items"]
    factory.assert_called_once_with(
        api_key=SECRET, max_retries=2, base_url="https://gateway.example/api/v1"
    )


def test_default_url_and_reusable_client(sdk):
    _, requests, factory, _ = sdk
    ai.translate_batch("vi", [ITEM])
    ai.translate_batch("vi", [ITEM])
    assert len(requests) == 2
    factory.assert_called_once_with(api_key=SECRET, max_retries=2, data_residency="global")
    assert str(requests[0].url) == "https://api.openai.com/v1/responses"


@pytest.mark.parametrize(
    "code,attempts,message",
    [
        (400, 1, "rejected"),
        (401, 1, "authentication"),
        (403, 1, "permission"),
        (429, 3, "rate limit"),
        (500, 3, "upstream service"),
    ],
)
def test_http_errors_are_safe_and_sdk_retries(sdk, code, attempts, message, caplog):
    handler, requests, _, _ = sdk
    handler.side_effect = lambda req: httpx2.Response(
        code, json={"error": {"message": UPSTREAM + SECRET}}
    )
    with pytest.raises(AITranslationError, match=message) as error:
        ai.translate_batch("vi", [ITEM])
    assert len(requests) == attempts
    rendered = "".join(traceback.format_exception(error.value)) + caplog.text
    assert SECRET not in rendered and UPSTREAM not in rendered


@pytest.mark.parametrize(
    "failure,message",
    [(httpx2.ReadTimeout, "timed out"), (httpx2.ConnectError, "connection failed")],
)
def test_transport_errors_are_safe(sdk, failure, message):
    handler, requests, _, _ = sdk
    handler.side_effect = lambda req: (_ for _ in ()).throw(failure(UPSTREAM, request=req))
    with pytest.raises(AITranslationError, match=message) as error:
        ai.translate_batch("vi", [ITEM])
    assert len(requests) == 3
    assert UPSTREAM not in "".join(traceback.format_exception(error.value))


@pytest.mark.parametrize(
    "body",
    [
        response_body(status="incomplete"),
        response_body(content=[{"type": "refusal", "refusal": UPSTREAM}]),
        response_body(content=[]),
        response_body(text="{" + UPSTREAM),
        response_body(
            text=json.dumps(
                {"items": [{"id": "s1", "translations": [{"locale": "en", "text": UPSTREAM}]}]}
            )
        ),
        response_body(text=json.dumps({"items": [], "extra": UPSTREAM})),
        response_body([row(), row()]),
        response_body([{"id": "s1", "translations": [row()["translations"][0]] * 2}]),
    ],
)
def test_invalid_generations_fail_without_retry_or_gap_filling(sdk, body, caplog):
    handler, requests, _, _ = sdk
    handler.side_effect = lambda req: httpx2.Response(200, json=body)
    with pytest.raises(AITranslationError) as error:
        ai.translate_batch("vi", [ITEM])
    assert len(requests) == 1
    assert UPSTREAM not in "".join(traceback.format_exception(error.value)) + caplog.text


def test_filter_clamp_and_fill_only_missing_cells(sdk):
    handler, requests, _, _ = sdk
    handler.side_effect = [
        httpx2.Response(
            200,
            json=response_body(
                [
                    {
                        "id": "s1",
                        "translations": [
                            {"locale": "en", "text": "Save", "confidence": 150},
                            {"locale": "ja", "text": " ", "confidence": 50},
                            {"locale": "fr", "text": "ignored", "confidence": 50},
                        ],
                    },
                    row("unknown"),
                ]
            ),
        ),
        httpx2.Response(
            200,
            json=response_body(
                [
                    {
                        "id": "s1",
                        "translations": [
                            {"locale": "en", "text": "must not overwrite", "confidence": 0},
                            {"locale": "ja", "text": "保存", "confidence": -10},
                        ],
                    }
                ]
            ),
        ),
    ]
    events = []
    result = ai.translate_batch(
        "vi", [TranslateItem("s1", "Lưu", ("en", "ja"))], lambda *args: events.append(args)
    )
    assert result == {"s1": {"en": TranslatedCell("Save", 100), "ja": TranslatedCell("保存", 0)}}
    assert prompt_items(requests[1])[0]["locales"] == ["ja"]
    assert events == [("translating", 0, 1), ("filling_gaps", 0, 1), ("translating", 1, 1)]
    assert json.loads(requests[0].content)["text"] == json.loads(requests[1].content)["text"]


def test_remaining_gaps_are_omitted_after_one_pass(sdk):
    handler, requests, _, _ = sdk
    handler.side_effect = lambda req: httpx2.Response(200, json=response_body([]))
    assert ai.translate_batch("vi", [ITEM]) == {}
    assert len(requests) == 2


def test_stub_empty_input_and_shutdown_without_credentials(sdk, monkeypatch):
    _, requests, factory, _ = sdk
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "openai_model", "")
    assert ai.translate_batch("vi", []) == {}
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    monkeypatch.setattr(settings, "ai_translate_stub_delay_ms", 0)
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    events = []
    assert ai.translate_batch(
        "vi", [ITEM, TranslateItem("s2", "Hi", ("en",))], lambda *args: events.append(args)
    )
    assert events[-1] == ("translating", 2, 2)
    ai.close_ai_client()
    factory.assert_not_called()
    assert not requests


@pytest.mark.parametrize("setting", ["openai_api_key", "openai_model"])
def test_missing_configuration(sdk, monkeypatch, setting):
    monkeypatch.setattr(settings, setting, " ")
    with pytest.raises(AIConfigurationError, match=setting.upper()):
        ai.translate_batch("vi", [ITEM])
    sdk[2].assert_not_called()


@pytest.mark.parametrize(
    "setting", ["openai_max_output_tokens", "ai_translate_batch_size", "ai_translate_max_workers"]
)
@pytest.mark.parametrize("value", [0, -1])
def test_positive_configuration(setting, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{setting: value})


def test_workers_overlap_and_queue_runs_before_slowest_finishes(sdk, monkeypatch):
    handler, _, factory, _ = sdk
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 2)
    first_two = threading.Barrier(2)
    third_started = threading.Event()
    lock = threading.Lock()
    active = peak = 0

    def handle(request):
        nonlocal active, peak
        name = prompt_items(request)[0]["id"]
        with lock:
            active += 1
            peak = max(peak, active)
        try:
            if name in {"0", "1"}:
                first_two.wait(timeout=5)
            if name == "0":
                assert third_started.wait(5)
            if name == "2":
                third_started.set()
            return httpx2.Response(200, json=complete_response(request))
        finally:
            with lock:
                active -= 1

    handler.side_effect = handle
    items = [TranslateItem(str(i), "Text", ("en",)) for i in range(4)]
    assert len(ai.translate_batch("vi", items)) == 4
    assert peak == 2
    factory.assert_called_once()


def test_concurrent_operations_share_client_and_shutdown_waits(sdk):
    handler, _, factory, clients = sdk
    entered = threading.Barrier(3)
    release = threading.Event()
    closing = threading.Event()

    def handle(request):
        entered.wait(timeout=5)
        assert release.wait(5)
        return httpx2.Response(200, json=complete_response(request))

    def close():
        closing.set()
        ai.close_ai_client()

    handler.side_effect = handle
    with ThreadPoolExecutor(max_workers=3) as pool:
        work = [pool.submit(ai.translate_batch, "vi", [ITEM]) for _ in range(2)]
        entered.wait(timeout=5)
        close_spy = Mock(wraps=clients[0].close)
        clients[0].close = close_spy
        stopped = pool.submit(close)
        try:
            assert closing.wait(5)
            assert not stopped.done()
            close_spy.assert_not_called()
        finally:
            release.set()
        for future in work:
            assert future.result(timeout=5)
        stopped.result(timeout=5)
    factory.assert_called_once()
    close_spy.assert_called_once()
    assert ai._client is None
    ai.close_ai_client()
    close_spy.assert_called_once()


@pytest.mark.parametrize(
    "value,expected",
    [(None, None), (True, None), ("", None), ("bad", None), ("85.6", 86), (-2, 0), (101, 100)],
)
def test_confidence_normalization(value, expected):
    assert ai.clamp_confidence(value) == expected


@pytest.mark.parametrize("mode", ["sync", "proposals", "translate_job", "proposal_job"])
@pytest.mark.parametrize("gap_failure", [False, True])
def test_batch_failure_never_saves_partial_work(
    sdk, client, session_factory, monkeypatch, mode, gap_failure, caplog
):
    import uuid

    from app.models import Activity, Job, JobStatus, StringEntry, Translation
    from app.services import translate
    from tests.helpers import make_project
    from tests.test_job_recovery import running_job

    project = make_project(client)
    ids = []
    for i in range(2):
        created = client.post(
            f"/api/projects/{project['id']}/strings",
            json={"key": f"key{i}", "source_text": f"Text {i}"},
        )
        assert created.status_code == 201
        ids.append(uuid.UUID(created.json()["id"]))
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 1)
    handler, requests, _, _ = sdk

    def handle(request):
        if len(requests) == 1:
            return httpx2.Response(200, json=complete_response(request))
        if gap_failure and len(requests) == 2:
            return httpx2.Response(200, json=response_body([]))
        return httpx2.Response(200, json=response_body(text="{" + UPSTREAM + SECRET))

    handler.side_effect = handle
    with session_factory() as db:
        baseline = db.query(Activity).count()
    if mode in {"sync", "proposals"}:
        suffix = "" if mode == "sync" else "/proposals"
        response = client.post(
            f"/api/projects/{project['id']}/translate{suffix}",
            json={"scope": "missing", "locales": ["en"]},
        )
        assert response.status_code == 502, response.text
        assert "invalid or unsuccessful output" in response.json()["detail"]
        rendered = response.text
    else:
        kind = "translate" if mode == "translate_job" else "translate_proposals"
        job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)
        args = (uuid.UUID(project["id"]), ids, ["en"], False)
        with pytest.raises(AITranslationError) as error:
            if mode == "translate_job":
                translate.run_translate_job(*args, uuid.uuid4(), job_id)
            else:
                translate.run_propose_job(*args, job_id)
        rendered = "".join(traceback.format_exception(error.value))
        body = client.get(f"/api/jobs/{job_id}").json()
        assert body["status"] == "failed"
        assert "invalid or unsuccessful output" in body["error"]
        assert not body["result"]
        rendered += json.dumps(body)
        with session_factory() as db:
            assert db.get(Job, job_id).status == JobStatus.failed
    assert len(requests) == (3 if gap_failure else 2)
    assert SECRET not in rendered + caplog.text
    assert UPSTREAM not in rendered + caplog.text
    with session_factory() as db:
        assert db.query(Activity).count() == baseline
        assert not db.query(Translation).filter(Translation.value != "").count()
        assert all(entry.status.value == "draft" for entry in db.query(StringEntry).all())


@pytest.mark.parametrize(
    "failure,status",
    [
        (AIConfigurationError("OPENAI_API_KEY is not configured"), 503),
        (RuntimeError(UPSTREAM + SECRET), 502),
    ],
)
def test_http_error_boundary_is_safe(sdk, client, monkeypatch, failure, status, ai_logs):
    from app.services import translate
    from tests.helpers import make_project

    project = make_project(client)
    monkeypatch.setattr(translate, "translate_batch", Mock(side_effect=failure))
    response = client.post(
        f"/api/projects/{project['id']}/translate/preview",
        json={"source_text": "Hi", "locales": ["en"]},
    )
    assert response.status_code == status
    assert SECRET not in response.text + ai_logs.text
    assert UPSTREAM not in response.text + ai_logs.text
    if isinstance(failure, AIConfigurationError):
        assert "AI translation failed (" not in ai_logs.text
    else:
        assert "AI translation failed (RuntimeError)" in ai_logs.text


def test_startup_does_not_create_client(sdk, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "openai_model", "")
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
    sdk[2].assert_not_called()


def test_invalid_client_configuration_is_safe(sdk):
    sdk[2].side_effect = ValueError(SECRET + UPSTREAM)
    with pytest.raises(AIConfigurationError) as error:
        ai.translate_batch("vi", [ITEM])
    assert SECRET not in "".join(traceback.format_exception(error.value))


def test_defaults(monkeypatch):
    for name in (
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_BASE_URL",
        "OPENAI_MAX_OUTPUT_TOKENS",
        "AI_TRANSLATE_BATCH_SIZE",
        "AI_TRANSLATE_MAX_WORKERS",
    ):
        monkeypatch.delenv(name, raising=False)
    config = Settings(_env_file=None)
    assert config.openai_api_key == config.openai_base_url == ""
    assert config.openai_model == "gpt-6-luna"
    assert config.openai_max_output_tokens == 16000
    assert config.ai_translate_batch_size == 20
    assert config.ai_translate_max_workers == 5


@pytest.mark.parametrize("ambient_url", ["", "   ", "https://ignored.example/v1"])
def test_empty_configured_base_url_ignores_sdk_environment_fallback(sdk, monkeypatch, ambient_url):
    monkeypatch.setenv("OPENAI_BASE_URL", ambient_url)
    ai.translate_batch("vi", [ITEM])
    assert str(sdk[1][0].url) == "https://api.openai.com/v1/responses"
    assert "base_url" not in sdk[2].call_args.kwargs


def test_failed_batch_does_not_start_queued_batches(sdk, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    handler, _, _, _ = sdk
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 2)
    started = threading.Barrier(2)
    cancelled = threading.Event()
    seen: list[str] = []
    original_shutdown = ThreadPoolExecutor.shutdown

    def shutdown(self, wait=True, *, cancel_futures=False):
        if cancel_futures:
            cancelled.set()
        return original_shutdown(self, wait=wait, cancel_futures=cancel_futures)

    monkeypatch.setattr(ThreadPoolExecutor, "shutdown", shutdown)

    def handle(request):
        name = prompt_items(request)[0]["id"]
        seen.append(name)
        if name not in {"0", "1"}:
            return httpx2.Response(200, json=response_body(text="{"))
        started.wait(timeout=5)
        if name == "1":
            cancelled.wait(5)
            return httpx2.Response(200, json=complete_response(request))
        return httpx2.Response(200, json=response_body(text="{"))

    handler.side_effect = handle
    items = [TranslateItem(str(i), "Text", ("en",)) for i in range(4)]
    with pytest.raises(AITranslationError):
        ai.translate_batch("vi", items)
    assert cancelled.is_set()
    assert set(seen) == {"0", "1"}


def test_immediate_batch_failure_is_the_translation_error(sdk, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 5)

    def boom(source_locale, items, client, on_filling=None):
        if items[0].id == "0":
            raise AITranslationError("invalid or unsuccessful output")
        return {}

    monkeypatch.setattr(ai, "_translate_chunk", boom)
    items = [TranslateItem(str(i), "Text", ("en",)) for i in range(6)]
    for _ in range(20):
        with pytest.raises(AITranslationError, match="invalid or unsuccessful"):
            ai.translate_batch("vi", items)


def test_one_worker_processes_every_chunk(sdk, monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 1)
    items = [TranslateItem(str(i), "Text", ("en",)) for i in range(3)]
    assert len(ai.translate_batch("vi", items)) == 3
    assert len(sdk[1]) == 3


@pytest.mark.parametrize("kind", ["translate", "translate_proposals"])
def test_unexpected_job_error_hides_raw_exception(
    sdk, client, session_factory, monkeypatch, kind, ai_logs
):
    import uuid

    from app.models import JobStatus
    from app.services import translate
    from tests.helpers import make_project
    from tests.test_job_recovery import running_job

    project = make_project(client)
    job_id = running_job(session_factory, project, kind=kind, status=JobStatus.pending)
    monkeypatch.setattr(
        translate, "_load_entries_by_ids", Mock(side_effect=RuntimeError(SECRET + UPSTREAM))
    )
    args = (uuid.UUID(project["id"]), [], ["en"], False)
    with pytest.raises(AITranslationError) as error:
        if kind == "translate":
            translate.run_translate_job(*args, uuid.uuid4(), job_id)
        else:
            translate.run_propose_job(*args, job_id)
    body = client.get(f"/api/jobs/{job_id}").json()
    assert body["status"] == "failed"
    assert body["error"] == "AI translation failed. Please try again."
    rendered = json.dumps(body) + "".join(traceback.format_exception(error.value)) + ai_logs.text
    assert SECRET not in rendered and UPSTREAM not in rendered
    assert "AI translation failed (RuntimeError)" in ai_logs.text


def test_gap_filling_runs_while_another_batch_is_active(sdk, monkeypatch):
    handler = sdk[0]
    monkeypatch.setattr(settings, "ai_translate_batch_size", 1)
    monkeypatch.setattr(settings, "ai_translate_max_workers", 2)
    initial = threading.Barrier(2)
    filled = threading.Event()
    count = 0

    def handle(request):
        nonlocal count
        item_id = prompt_items(request)[0]["id"]
        if item_id == "s1":
            count += 1
            if count == 1:
                initial.wait(timeout=5)
                return httpx2.Response(200, json=response_body([]))
            filled.set()
        else:
            initial.wait(timeout=5)
            assert filled.wait(5)
        return httpx2.Response(200, json=complete_response(request))

    handler.side_effect = handle
    result = ai.translate_batch("vi", [ITEM, TranslateItem("s2", "Text", ("en",))])
    assert len(result) == 2
    assert count == 2


def test_id_and_locale_whitespace_normalization_is_preserved(sdk):
    sdk[0].side_effect = lambda req: httpx2.Response(
        200, json=response_body([row(" s1 ", locale=" en ")])
    )
    assert ai.translate_batch("vi", [ITEM]) == {"s1": {"en": TranslatedCell("Save", 88)}}
    assert len(sdk[1]) == 1
