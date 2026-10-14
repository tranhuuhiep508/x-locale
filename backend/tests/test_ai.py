"""Unit tests for Bedrock tool and JSON Schema batch translation."""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import boto3
import pytest
from botocore.awsrequest import AWSResponse
from botocore.exceptions import ClientError, NoCredentialsError
from pydantic import ValidationError

from app.ai import (
    BATCH_SIZE,
    TOOL_NAME,
    TranslatedCell,
    TranslateItem,
    clamp_confidence,
    translate_batch,
)
from app.config import Settings, settings


def fake_converse_body(items: list[dict], stop_reason: str = "tool_use") -> dict:
    return {
        "stopReason": stop_reason,
        "output": {
            "message": {
                "content": [
                    {
                        "toolUse": {
                            "name": TOOL_NAME,
                            "toolUseId": "t1",
                            "input": {"items": items},
                        }
                    }
                ]
            }
        },
    }


def fake_json_body(items: list[dict], stop_reason: str = "end_turn") -> dict:
    return {
        "stopReason": stop_reason,
        "output": {"message": {"content": [{"text": json.dumps({"items": items})}]}},
    }


def items_from_prompt(prompt: str) -> list[dict]:
    _, _, rest = prompt.partition("Items:\n")
    return json.loads(rest)


def complete_tool_response(prompt: str) -> dict:
    return fake_converse_body(
        [
            {
                "id": item["id"],
                "translations": [
                    {"locale": locale, "text": f"{locale}:{item['source']}", "confidence": 88}
                    for locale in item["locales"]
                ],
            }
            for item in items_from_prompt(prompt)
        ]
    )


@pytest.fixture(autouse=True)
def default_model(monkeypatch):
    monkeypatch.setattr(settings, "bedrock_model_id", "us.amazon.nova-2-lite-v1:0")
    monkeypatch.setattr(settings, "bedrock_output_mode", "tool")
    monkeypatch.setattr(settings, "bedrock_tool_choice", "tool")
    monkeypatch.setattr(settings, "bedrock_json_schema_strict", False)


@pytest.fixture
def converse(monkeypatch) -> MagicMock:
    mock_converse = MagicMock()
    client = MagicMock()
    client.converse = mock_converse
    session = MagicMock()
    session.client.return_value = client
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)
    return mock_converse


def test_translate_batch_empty_list_does_not_call_bedrock(converse):
    assert translate_batch("vi", []) == {}
    converse.assert_not_called()


@pytest.mark.parametrize(
    ("model_id", "tool_choice"),
    [
        ("us.amazon.nova-2-lite-v1:0", "tool"),
        ("us.anthropic.claude-sonnet-5-5", "auto"),
        ("openai.gpt-oss-120b-1:0", "auto"),
        ("us.openai.gpt-6-luna", "auto"),
        ("global.openai.gpt-6-sol", "auto"),
        ("us.openai.gpt-6-astra", "auto"),
        (
            "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/custom",
            "auto",
        ),
    ],
)
def test_translate_batch_uses_default_sampling_and_configured_tool_choice(
    converse, monkeypatch, model_id, tool_choice
):
    monkeypatch.setattr(settings, "bedrock_model_id", model_id)
    monkeypatch.setattr(settings, "bedrock_tool_choice", tool_choice)
    converse.return_value = fake_converse_body(
        [
            {
                "id": "s1",
                "translations": [
                    {"locale": "en", "text": "Save"},
                    {"locale": "ja", "text": "保存"},
                ],
            }
        ]
    )
    result = translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en", "ja"), context="button")],
    )
    assert result == {
        "s1": {
            "en": TranslatedCell(text="Save", confidence=None),
            "ja": TranslatedCell(text="保存", confidence=None),
        }
    }
    converse.assert_called_once()
    kwargs = converse.call_args.kwargs
    assert kwargs["modelId"] == model_id
    assert kwargs["toolConfig"]["toolChoice"] == (
        {"tool": {"name": TOOL_NAME}} if tool_choice == "tool" else {"auto": {}}
    )
    assert kwargs["inferenceConfig"] == {"maxTokens": settings.bedrock_max_tokens}
    assert "temperature" not in kwargs
    assert "temperature" not in kwargs["inferenceConfig"]
    assert kwargs["toolConfig"]["tools"][0]["toolSpec"]["strict"] is True
    assert "outputConfig" not in kwargs
    assert "additionalModelRequestFields" not in kwargs
    prompt = kwargs["messages"][0]["content"][0]["text"]
    assert "Lưu" in prompt
    assert "en" in prompt
    assert "ja" in prompt
    assert "button" in prompt
    assert "instructions" in prompt
    assert "mandatory" in prompt.lower()
    assert "confidence" in prompt.lower()
    assert "same terminology" in prompt
    assert "Do not embellish" in prompt
    tool_schema = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]
    cell_props = tool_schema["properties"]["items"]["items"]["properties"]["translations"]["items"][
        "properties"
    ]
    assert "confidence" in cell_props


def test_configured_max_tokens_reaches_bedrock_call(converse, monkeypatch):
    monkeypatch.setattr(settings, "bedrock_max_tokens", 8000)
    converse.return_value = fake_converse_body(
        [{"id": "s1", "translations": [{"locale": "en", "text": "Save"}]}]
    )
    translate_batch("vi", [TranslateItem(id="s1", source_text="Lưu", locales=("en",))])
    assert converse.call_args.kwargs["inferenceConfig"] == {"maxTokens": 8000}


def test_translate_batch_prompt_treats_description_as_override(converse):
    converse.return_value = fake_converse_body(
        [
            {
                "id": "s1",
                "translations": [{"locale": "en", "text": "ABC"}],
            }
        ]
    )
    notes = "Fix cứng là chữ ABC"
    translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Hủy", locales=("en",), context=notes)],
    )
    prompt = converse.call_args.kwargs["messages"][0]["content"][0]["text"]
    assert notes in prompt
    assert '"instructions":' in prompt
    assert f"id=s1: {notes}" in prompt
    assert "override" in prompt.lower()
    payload = items_from_prompt(prompt)
    assert payload[0]["instructions"] == notes


def test_translate_batch_reads_tool_input_after_reasoning(converse, monkeypatch):
    monkeypatch.setattr(settings, "bedrock_model_id", "us.openai.gpt-6-luna")
    response = fake_converse_body(
        [{"id": "s1", "translations": [{"locale": "en", "text": "Save", "confidence": 88}]}]
    )
    response["output"]["message"]["content"].insert(
        0, {"reasoningContent": {"reasoningText": {"text": "reasoning"}}}
    )
    converse.return_value = response
    assert translate_batch("vi", [TranslateItem("s1", "Lưu", ("en",))]) == {
        "s1": {"en": TranslatedCell("Save", 88)}
    }


@pytest.mark.parametrize(
    ("model_id", "strict"),
    [
        ("us.anthropic.claude-sonnet-4-6", False),
        ("openai.gpt-oss-120b-1:0", False),
        ("us.openai.gpt-6-luna", True),
        ("arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/custom", True),
    ],
)
def test_json_schema_output_and_default_reasoning(converse, monkeypatch, model_id, strict):
    monkeypatch.setattr(settings, "bedrock_model_id", model_id)
    monkeypatch.setattr(settings, "bedrock_output_mode", "json_schema")
    monkeypatch.setattr(settings, "bedrock_json_schema_strict", strict)
    response = fake_json_body(
        [{"id": "s1", "translations": [{"locale": "en", "text": "Save", "confidence": 88}]}]
    )
    text = response["output"]["message"]["content"][0]["text"]
    response["output"]["message"]["content"] = [
        {"reasoningContent": {"reasoningText": {"text": "reasoning"}}},
        {"text": text[:20]},
        {"text": text[20:]},
    ]
    converse.return_value = response
    assert translate_batch("vi", [TranslateItem("s1", "Lưu", ("en",))]) == {
        "s1": {"en": TranslatedCell("Save", 88)}
    }
    kwargs = converse.call_args.kwargs
    assert kwargs["modelId"] == model_id
    assert kwargs["inferenceConfig"] == {"maxTokens": settings.bedrock_max_tokens}
    assert "temperature" not in kwargs
    assert "temperature" not in kwargs["inferenceConfig"]
    assert "toolConfig" not in kwargs
    assert kwargs.get("additionalModelRequestFields", {}) == (
        {"text": {"format": {"strict": True}}} if strict else {}
    )
    output_format = kwargs["outputConfig"]["textFormat"]
    assert output_format["type"] == "json_schema"
    schema = json.loads(output_format["structure"]["jsonSchema"]["schema"])
    row_schema = schema["properties"]["items"]["items"]
    cell_schema = row_schema["properties"]["translations"]["items"]
    for object_schema in (schema, row_schema, cell_schema):
        assert object_schema["additionalProperties"] is False
        assert set(object_schema["required"]) == set(object_schema["properties"])
    assert "minimum" not in cell_schema["properties"]["confidence"]
    assert "maximum" not in cell_schema["properties"]["confidence"]
    prompt = kwargs["messages"][0]["content"][0]["text"]
    assert "Return only a JSON object" in prompt
    assert "Call submit_translations" not in prompt


@pytest.mark.parametrize("mode", ["tool", "json_schema"])
@pytest.mark.parametrize("stop_reason", ["max_tokens", "content_filtered", "guardrail_intervened"])
def test_incomplete_responses_are_rejected(converse, monkeypatch, mode, stop_reason):
    monkeypatch.setattr(settings, "bedrock_output_mode", mode)
    rows = [{"id": "s1", "translations": [{"locale": "en", "text": "Save"}]}]
    converse.return_value = (
        fake_converse_body(rows, stop_reason) if mode == "tool" else fake_json_body(rows, stop_reason)
    )
    with pytest.raises(RuntimeError, match=stop_reason):
        translate_batch("vi", [TranslateItem("s1", "Lưu", ("en",))])


@pytest.mark.parametrize("text", ["not json", "[]", "{}", '{"items": null}'])
def test_invalid_json_output_is_rejected(converse, monkeypatch, text):
    monkeypatch.setattr(settings, "bedrock_output_mode", "json_schema")
    converse.return_value = {
        "stopReason": "end_turn",
        "output": {"message": {"content": [{"text": text}]}},
    }
    with pytest.raises(RuntimeError, match="Bedrock translations"):
        translate_batch("vi", [TranslateItem("s1", "Lưu", ("en",))])


def test_output_settings_env_are_validated(monkeypatch):
    for name in ("BEDROCK_OUTPUT_MODE", "BEDROCK_JSON_SCHEMA_STRICT", "BEDROCK_TOOL_CHOICE"):
        monkeypatch.delenv(name, raising=False)
    defaults = Settings(_env_file=None)
    assert defaults.bedrock_output_mode == "json_schema"
    assert defaults.bedrock_json_schema_strict is True
    assert defaults.bedrock_tool_choice == "tool"
    monkeypatch.setenv("BEDROCK_OUTPUT_MODE", "tool")
    monkeypatch.setenv("BEDROCK_JSON_SCHEMA_STRICT", "false")
    monkeypatch.setenv("BEDROCK_TOOL_CHOICE", "auto")
    config = Settings(_env_file=None)
    assert config.bedrock_output_mode == "tool"
    assert config.bedrock_json_schema_strict is False
    assert config.bedrock_tool_choice == "auto"
    monkeypatch.setenv("BEDROCK_OUTPUT_MODE", "unsupported")
    with pytest.raises(ValidationError, match="bedrock_output_mode"):
        Settings(_env_file=None)


def test_default_request_is_strict_json_schema(converse, monkeypatch):
    for name in ("BEDROCK_OUTPUT_MODE", "BEDROCK_JSON_SCHEMA_STRICT", "BEDROCK_TOOL_CHOICE"):
        monkeypatch.delenv(name, raising=False)
    defaults = Settings(_env_file=None)
    monkeypatch.setattr(settings, "bedrock_output_mode", defaults.bedrock_output_mode)
    monkeypatch.setattr(settings, "bedrock_json_schema_strict", defaults.bedrock_json_schema_strict)
    monkeypatch.setattr(settings, "bedrock_tool_choice", defaults.bedrock_tool_choice)
    converse.return_value = fake_json_body(
        [{"id": "s1", "translations": [{"locale": "en", "text": "Save", "confidence": 88}]}]
    )
    assert translate_batch("vi", [TranslateItem("s1", "Lưu", ("en",))]) == {
        "s1": {"en": TranslatedCell("Save", 88)}
    }
    kwargs = converse.call_args.kwargs
    assert kwargs["outputConfig"]["textFormat"]["type"] == "json_schema"
    assert kwargs["additionalModelRequestFields"] == {"text": {"format": {"strict": True}}}
    assert "toolConfig" not in kwargs
    assert kwargs["inferenceConfig"] == {"maxTokens": settings.bedrock_max_tokens}
    assert "temperature" not in kwargs
    assert "temperature" not in kwargs["inferenceConfig"]


def test_invalid_tool_choice_env_is_rejected(monkeypatch):
    monkeypatch.setenv("BEDROCK_TOOL_CHOICE", "unsupported")
    with pytest.raises(ValidationError, match="bedrock_tool_choice"):
        Settings(_env_file=None)


def test_translate_batch_raises_when_tool_not_used(converse):
    converse.return_value = {
        "stopReason": "end_turn",
        "output": {"message": {"content": [{"text": "Save"}]}},
    }
    with pytest.raises(RuntimeError, match="submit_translations"):
        translate_batch("vi", [TranslateItem(id="s1", source_text="Lưu", locales=("en",))])


def test_translate_batch_chunks_over_batch_size(converse):
    converse.side_effect = lambda **kwargs: complete_tool_response(
        kwargs["messages"][0]["content"][0]["text"]
    )
    items = [
        TranslateItem(id=str(index), source_text=f"s{index}", locales=("en",))
        for index in range(BATCH_SIZE + 1)
    ]
    result = translate_batch("vi", items)
    assert converse.call_count == 2
    assert len(result) == BATCH_SIZE + 1
    assert result["0"]["en"] == TranslatedCell(text="en:s0", confidence=88)
    assert result[str(BATCH_SIZE)]["en"] == TranslatedCell(
        text=f"en:s{BATCH_SIZE}", confidence=88
    )


@pytest.mark.parametrize("mode", ["tool", "json_schema"])
def test_translate_batch_retries_missing_locale_once(converse, monkeypatch, mode):
    monkeypatch.setattr(settings, "bedrock_output_mode", mode)
    make_response = fake_converse_body if mode == "tool" else fake_json_body
    calls: list[list[dict]] = []

    def fake_converse(**kwargs):
        prompt_items = items_from_prompt(kwargs["messages"][0]["content"][0]["text"])
        calls.append(prompt_items)
        if len(calls) == 1:
            return make_response(
                [
                    {
                        "id": item["id"],
                        "translations": [{"locale": "en", "text": "Save"}],
                    }
                    for item in prompt_items
                ]
            )
        return make_response(
            [
                {
                    "id": item["id"],
                    "translations": [
                        {"locale": locale, "text": f"{locale}-retry"} for locale in item["locales"]
                    ],
                }
                for item in prompt_items
            ]
        )

    converse.side_effect = fake_converse
    result = translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en", "ja"))],
    )
    assert converse.call_count == 2
    assert calls[1][0]["locales"] == ["ja"]
    assert result == {
        "s1": {
            "en": TranslatedCell(text="Save", confidence=None),
            "ja": TranslatedCell(text="ja-retry", confidence=None),
        }
    }


def test_translate_batch_does_not_retry_twice(converse):
    converse.side_effect = lambda **kwargs: fake_converse_body(
        [
            {
                "id": item["id"],
                "translations": [{"locale": "en", "text": "Save"}],
            }
            for item in items_from_prompt(kwargs["messages"][0]["content"][0]["text"])
        ]
    )
    result = translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en", "ja"))],
    )
    assert converse.call_count == 2
    assert result == {"s1": {"en": TranslatedCell(text="Save", confidence=None)}}
    assert "ja" not in result["s1"]


def test_translate_batch_wraps_client_error(converse):
    converse.side_effect = ClientError(
        {"Error": {"Code": "ValidationException", "Message": "boom"}},
        "Converse",
    )
    with pytest.raises(RuntimeError, match="Bedrock request failed"):
        translate_batch("vi", [TranslateItem(id="s1", source_text="Lưu", locales=("en",))])


@pytest.mark.parametrize("credential_type", ["permanent", "temporary", None])
@pytest.mark.parametrize(
    ("model_id", "mode", "strict"),
    [
        ("us.amazon.nova-2-lite-v1:0", "tool", False),
        ("us.anthropic.claude-sonnet-4-6", "json_schema", False),
        ("us.openai.gpt-6-luna", "json_schema", True),
    ],
)
def test_translate_batch_requires_sigv4_even_with_bearer_token(
    monkeypatch, tmp_path, credential_type, model_id, mode, strict
):
    monkeypatch.setattr(settings, "bedrock_model_id", model_id)
    monkeypatch.setattr(settings, "bedrock_output_mode", mode)
    monkeypatch.setattr(settings, "bedrock_json_schema_strict", strict)
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "unsupported-token")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("BOTO_CONFIG", str(tmp_path / "boto"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    for name in (
        "AWS_PROFILE",
        "AWS_DEFAULT_PROFILE",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_SECURITY_TOKEN",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
        "AWS_ROLE_ARN",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
    ):
        monkeypatch.delenv(name, raising=False)
    if credential_type is not None:
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access-key")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")
    if credential_type == "temporary":
        monkeypatch.setenv("AWS_SESSION_TOKEN", "test-session-token")

    session = boto3.Session()
    sent_requests = []
    body = json.dumps(
        (fake_converse_body if mode == "tool" else fake_json_body)(
            [{"id": "s1", "translations": [{"locale": "en", "text": "Save"}]}]
        )
    ).encode()

    def respond(request, **kwargs):
        sent_requests.append(request)
        return AWSResponse(
            request.url,
            200,
            {"content-type": "application/json"},
            SimpleNamespace(stream=lambda: iter([body])),
        )

    def check_client_config(context, **kwargs):
        assert context["client_config"].read_timeout == 300

    session.events.register("before-call.bedrock-runtime.Converse", check_client_config)
    session.events.register("before-send.bedrock-runtime.Converse", respond)
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)
    items = [TranslateItem(id="s1", source_text="Lưu", locales=("en",))]
    if credential_type is None:
        with pytest.raises(ValueError, match="AWS Bedrock auth is not configured"):
            translate_batch("vi", items)
        assert sent_requests == []
    else:
        assert translate_batch("vi", items) == {
            "s1": {"en": TranslatedCell(text="Save", confidence=None)}
        }
        assert len(sent_requests) == 1
        request_body = json.loads(sent_requests[0].body)
        assert request_body["inferenceConfig"] == {"maxTokens": settings.bedrock_max_tokens}
        assert "temperature" not in request_body
        assert "temperature" not in request_body["inferenceConfig"]
        assert ("toolConfig" in request_body) == (mode == "tool")
        if mode == "tool":
            assert request_body["toolConfig"]["toolChoice"] == {"tool": {"name": TOOL_NAME}}
            assert request_body["toolConfig"]["tools"][0]["toolSpec"]["strict"] is True
        assert ("outputConfig" in request_body) == (mode == "json_schema")
        assert request_body.get("additionalModelRequestFields", {}) == (
            {"text": {"format": {"strict": True}}} if strict else {}
        )
        headers = sent_requests[0].headers
        assert headers["Authorization"].startswith(b"AWS4-HMAC-SHA256 ")
        if credential_type == "temporary":
            assert headers["X-Amz-Security-Token"] == b"test-session-token"
        else:
            assert "X-Amz-Security-Token" not in headers


def test_translate_batch_reports_missing_credentials_during_client_creation(monkeypatch):
    session = MagicMock()
    session.client.side_effect = NoCredentialsError()
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)
    with pytest.raises(ValueError, match="AWS Bedrock auth is not configured"):
        translate_batch("vi", [TranslateItem(id="s1", source_text="Lưu", locales=("en",))])


def test_clamp_confidence_bounds_and_rejects_junk():
    assert clamp_confidence(0) == 0
    assert clamp_confidence(100) == 100
    assert clamp_confidence(140) == 100
    assert clamp_confidence(-4) == 0
    assert clamp_confidence(87.6) == 88
    assert clamp_confidence("72") == 72
    assert clamp_confidence("") is None
    assert clamp_confidence(None) is None
    assert clamp_confidence(True) is None


def test_translate_batch_parses_and_clamps_confidence(converse):
    converse.return_value = fake_converse_body(
        [
            {
                "id": "s1",
                "translations": [
                    {"locale": "en", "text": "Save", "confidence": 140},
                    {"locale": "ja", "text": "保存", "confidence": "61"},
                ],
            }
        ]
    )
    result = translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en", "ja"))],
    )
    assert result == {
        "s1": {
            "en": TranslatedCell(text="Save", confidence=100),
            "ja": TranslatedCell(text="保存", confidence=61),
        }
    }


def test_translate_batch_chunk_failure_fails_whole_batch(converse):
    def fake_converse(**kwargs):
        prompt_items = items_from_prompt(kwargs["messages"][0]["content"][0]["text"])
        if any(item["id"] == str(BATCH_SIZE) for item in prompt_items):
            raise RuntimeError("Bedrock request failed: boom")
        return complete_tool_response(kwargs["messages"][0]["content"][0]["text"])

    converse.side_effect = fake_converse
    items = [
        TranslateItem(id=str(index), source_text=f"s{index}", locales=("en",))
        for index in range(BATCH_SIZE + 1)
    ]
    with pytest.raises(RuntimeError, match="Bedrock request failed"):
        translate_batch("vi", items)


def test_translate_batch_retries_throttling(converse, monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr("app.ai.time.sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr("app.ai.random.uniform", lambda _low, _high: 0)
    calls = {"count": 0}

    def fake_converse(**kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise ClientError(
                {"Error": {"Code": "ThrottlingException", "Message": "slow"}},
                "Converse",
            )
        return complete_tool_response(kwargs["messages"][0]["content"][0]["text"])

    converse.side_effect = fake_converse
    result = translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en",))],
    )
    assert converse.call_count == 2
    assert sleeps == [0.5]
    assert result["s1"]["en"].text == "en:Lưu"


def test_translate_batch_runs_chunks_concurrently(converse):
    started = threading.Barrier(2)
    overlapping = threading.Event()
    in_flight = 0
    lock = threading.Lock()

    def fake_converse(**kwargs):
        nonlocal in_flight
        with lock:
            in_flight += 1
            if in_flight >= 2:
                overlapping.set()
        started.wait(timeout=5)
        with lock:
            in_flight -= 1
        return complete_tool_response(kwargs["messages"][0]["content"][0]["text"])

    converse.side_effect = fake_converse
    items = [
        TranslateItem(id=str(index), source_text=f"s{index}", locales=("en",))
        for index in range(BATCH_SIZE + 1)
    ]
    result = translate_batch("vi", items)
    assert overlapping.is_set()
    assert len(result) == BATCH_SIZE + 1


def test_translate_batch_reports_progress(converse):
    converse.side_effect = lambda **kwargs: complete_tool_response(
        kwargs["messages"][0]["content"][0]["text"]
    )
    events: list[tuple[str, int, int]] = []
    items = [
        TranslateItem(id=str(index), source_text=f"s{index}", locales=("en",))
        for index in range(BATCH_SIZE + 1)
    ]
    translate_batch(
        "vi",
        items,
        on_progress=lambda phase, done, total: events.append((phase, done, total)),
    )
    assert events[0] == ("translating", 0, 2)
    assert ("translating", 2, 2) in events


def test_translate_batch_reports_filling_gaps(converse):
    def fake_converse(**kwargs):
        prompt_items = items_from_prompt(kwargs["messages"][0]["content"][0]["text"])
        if len(prompt_items) == 1 and prompt_items[0]["locales"] == ["en", "ja"]:
            return fake_converse_body(
                [
                    {
                        "id": prompt_items[0]["id"],
                        "translations": [{"locale": "en", "text": "Save"}],
                    }
                ]
            )
        return complete_tool_response(kwargs["messages"][0]["content"][0]["text"])

    converse.side_effect = fake_converse
    events: list[str] = []
    translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en", "ja"))],
        on_progress=lambda phase, done, total: events.append(phase),
    )
    assert "filling_gaps" in events


def test_translate_batch_stub_mode(monkeypatch):
    monkeypatch.setattr(settings, "ai_translate_stub", True)
    monkeypatch.setattr(settings, "ai_translate_stub_delay_ms", 0)
    events: list[str] = []
    result = translate_batch(
        "vi",
        [TranslateItem(id="s1", source_text="Lưu", locales=("en", "ja"))],
        on_progress=lambda phase, done, total: events.append(phase),
    )
    assert result == {
        "s1": {
            "en": TranslatedCell(text="[en] Lưu", confidence=85),
            "ja": TranslatedCell(text="[ja] Lưu", confidence=85),
        }
    }
    assert events == ["translating", "translating"]
