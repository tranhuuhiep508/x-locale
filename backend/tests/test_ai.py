"""Unit tests for Bedrock tool-based batch translation."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from app.ai import BATCH_SIZE, MAX_TOKENS, TOOL_NAME, TranslateItem, translate_batch


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
                    {"locale": locale, "text": f"{locale}:{item['source']}"}
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
    monkeypatch.setattr("app.ai.boto3.client", lambda *args, **kwargs: client)
    monkeypatch.setattr("app.ai._ensure_bedrock_auth", lambda: None)
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
    assert result == {"s1": {"en": "Save", "ja": "保存"}}
    converse.assert_called_once()
    kwargs = converse.call_args.kwargs
    assert kwargs["toolConfig"]["toolChoice"]["tool"]["name"] == TOOL_NAME
    assert kwargs["inferenceConfig"]["maxTokens"] == MAX_TOKENS
    prompt = kwargs["messages"][0]["content"][0]["text"]
    assert "Lưu" in prompt
    assert "en" in prompt
    assert "ja" in prompt
    assert "button" in prompt


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
    assert result["0"]["en"] == "en:s0"
    assert result[str(BATCH_SIZE)]["en"] == f"en:s{BATCH_SIZE}"


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
    assert result == {"s1": {"en": "Save", "ja": "ja-retry"}}


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
    assert result == {"s1": {"en": "Save"}}
    assert "ja" not in result["s1"]


def test_translate_batch_wraps_client_error(converse):
    converse.side_effect = ClientError(
        {"Error": {"Code": "ValidationException", "Message": "boom"}},
        "Converse",
    )
    with pytest.raises(RuntimeError, match="Bedrock request failed"):
        translate_batch("vi", [TranslateItem(id="s1", source_text="Lưu", locales=("en",))])
