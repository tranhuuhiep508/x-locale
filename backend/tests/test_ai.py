"""Unit tests for Bedrock tool-based batch translation."""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import boto3
import pytest
from botocore.awsrequest import AWSResponse
from botocore.exceptions import ClientError, NoCredentialsError

from app.ai import (
    BATCH_SIZE,
    MAX_TOKENS,
    TOOL_NAME,
    TranslatedCell,
    TranslateItem,
    clamp_confidence,
    translate_batch,
)
from app.config import settings


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


def test_translate_batch_single_item_uses_tool_choice(converse):
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
    assert kwargs["toolConfig"]["toolChoice"]["tool"]["name"] == TOOL_NAME
    assert kwargs["inferenceConfig"]["maxTokens"] == MAX_TOKENS
    prompt = kwargs["messages"][0]["content"][0]["text"]
    assert "Lưu" in prompt
    assert "en" in prompt
    assert "ja" in prompt
    assert "button" in prompt
    assert "instructions" in prompt
    assert "mandatory" in prompt.lower()
    assert "confidence" in prompt.lower()
    tool_schema = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]
    cell_props = tool_schema["properties"]["items"]["items"]["properties"]["translations"]["items"][
        "properties"
    ]
    assert "confidence" in cell_props


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


def test_translate_batch_retries_missing_locale_once(converse):
    calls: list[list[dict]] = []

    def fake_converse(**kwargs):
        prompt_items = items_from_prompt(kwargs["messages"][0]["content"][0]["text"])
        calls.append(prompt_items)
        if len(calls) == 1:
            return fake_converse_body(
                [
                    {
                        "id": item["id"],
                        "translations": [{"locale": "en", "text": "Save"}],
                    }
                    for item in prompt_items
                ]
            )
        return fake_converse_body(
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
def test_translate_batch_requires_sigv4_even_with_bearer_token(
    monkeypatch, tmp_path, credential_type
):
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
        fake_converse_body(
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
