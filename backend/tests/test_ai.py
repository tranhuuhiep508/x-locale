"""Unit tests for Bedrock tool-based batch translation."""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from app.ai import (
    BATCH_SIZE,
    MAX_TOKENS,
    TOOL_NAME,
    TranslatedCell,
    TranslateItem,
    _refresh_bedrock_token,
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
    monkeypatch.setattr("app.ai._refresh_bedrock_token", lambda: None)
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


def test_translate_batch_refreshes_token_before_each_converse(monkeypatch):
    refresh = MagicMock()
    monkeypatch.setattr("app.ai._refresh_bedrock_token", refresh)
    mock_converse = MagicMock()
    client = MagicMock()
    client.converse = mock_converse
    session = MagicMock()
    session.client.return_value = client
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)
    mock_converse.side_effect = lambda **kwargs: complete_tool_response(
        kwargs["messages"][0]["content"][0]["text"]
    )
    items = [
        TranslateItem(id=str(index), source_text=f"s{index}", locales=("en",))
        for index in range(BATCH_SIZE + 1)
    ]
    translate_batch("vi", items)
    assert mock_converse.call_count == 2
    assert refresh.call_count == 3


def test_refresh_writes_provide_token_result(monkeypatch):
    seen: dict[str, str | None] = {}

    def fake_provide(region=None):
        seen["region"] = region
        return "minted-token"

    monkeypatch.setattr("app.ai.provide_token", fake_provide)
    session = MagicMock()
    session.get_credentials.return_value = object()
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)
    monkeypatch.delenv("AWS_BEARER_TOKEN_BEDROCK", raising=False)

    _refresh_bedrock_token()
    assert seen["region"] == settings.aws_region
    assert os.environ["AWS_BEARER_TOKEN_BEDROCK"] == "minted-token"


def test_refresh_overwrites_static_token_when_iam_present(monkeypatch):
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "expired-key")
    monkeypatch.setattr("app.ai.provide_token", lambda region=None: "fresh-token")
    session = MagicMock()
    session.get_credentials.return_value = object()
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)

    _refresh_bedrock_token()
    assert os.environ["AWS_BEARER_TOKEN_BEDROCK"] == "fresh-token"


def test_refresh_keeps_static_token_without_iam(monkeypatch):
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "static-key")
    provide = MagicMock()
    monkeypatch.setattr("app.ai.provide_token", provide)
    session = MagicMock()
    session.get_credentials.return_value = None
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)

    _refresh_bedrock_token()
    provide.assert_not_called()
    assert os.environ["AWS_BEARER_TOKEN_BEDROCK"] == "static-key"


def test_refresh_raises_when_no_auth(monkeypatch):
    monkeypatch.delenv("AWS_BEARER_TOKEN_BEDROCK", raising=False)
    session = MagicMock()
    session.get_credentials.return_value = None
    monkeypatch.setattr("app.ai.boto3.Session", lambda: session)

    with pytest.raises(ValueError, match="AWS Bedrock auth is not configured"):
        _refresh_bedrock_token()


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
