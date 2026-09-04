from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass

import boto3
from aws_bedrock_token_generator import provide_token
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

from app.config import settings

_AUTH_ERROR = (
    "AWS Bedrock auth is not configured. Set AWS_ACCESS_KEY_ID and "
    "AWS_SECRET_ACCESS_KEY, or AWS_BEARER_TOKEN_BEDROCK in your environment."
)
_token_lock = threading.Lock()

BATCH_SIZE = 20
MAX_TOKENS = 4096
TEMPERATURE = 0.2
TOOL_NAME = "submit_translations"

SUBMIT_TRANSLATIONS_TOOL = {
    "toolSpec": {
        "name": TOOL_NAME,
        "description": (
            "Submit translations for every source string. "
            "Copy each item id exactly. Include every requested locale "
            "and an honest confidence score from 0 to 100."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "translations": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "locale": {"type": "string"},
                                            "text": {"type": "string"},
                                            "confidence": {
                                                "type": "integer",
                                                "minimum": 0,
                                                "maximum": 100,
                                                "description": (
                                                    "Self-evaluated confidence that this "
                                                    "translation is correct for UI use."
                                                ),
                                            },
                                        },
                                        "required": ["locale", "text", "confidence"],
                                    },
                                },
                            },
                            "required": ["id", "translations"],
                        },
                    }
                },
                "required": ["items"],
            }
        },
    }
}


@dataclass(frozen=True)
class TranslateItem:
    id: str
    source_text: str
    locales: tuple[str, ...]
    context: str | None = None


@dataclass(frozen=True)
class TranslatedCell:
    text: str
    confidence: int | None = None


def clamp_confidence(value: object) -> int | None:
    """Parse a model-provided score into 0–100, or None if missing/invalid."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, number))


def as_translated_cell(value: object) -> TranslatedCell | None:
    """Normalize a batch result cell. Strings from tests have no score."""
    if isinstance(value, TranslatedCell):
        if not value.text.strip():
            return None
        return TranslatedCell(text=value.text, confidence=clamp_confidence(value.confidence))
    if isinstance(value, str) and value.strip():
        return TranslatedCell(text=value, confidence=None)
    return None


def _refresh_bedrock_token() -> None:
    """Mint or reuse a cached short-term Bedrock API key before a request.

    IAM credentials take precedence: provide_token() returns a cached token if
    still valid, otherwise it generates a new one. A static
    AWS_BEARER_TOKEN_BEDROCK is used only when no IAM credentials are present.
    """
    with _token_lock:
        if boto3.Session().get_credentials() is not None:
            os.environ["AWS_BEARER_TOKEN_BEDROCK"] = provide_token(region=settings.aws_region)
            return
        if os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
            return
        raise ValueError(_AUTH_ERROR)


def _item_payload(item: TranslateItem) -> dict:
    payload: dict[str, object] = {
        "id": item.id,
        "source": item.source_text,
        "locales": list(item.locales),
    }
    if item.context and item.context.strip():
        payload["instructions"] = item.context.strip()
    return payload


def _instruction_notes(items: list[TranslateItem]) -> str:
    lines = [
        f'- id={item.id}: {item.context.strip()}'
        for item in items
        if item.context and item.context.strip()
    ]
    if not lines:
        return ""
    header = "Mandatory translator notes (override a literal translation):\n"
    return header + "\n".join(lines) + "\n\n"


def _build_prompt(source_locale: str, items: list[TranslateItem]) -> str:
    payload = json.dumps([_item_payload(item) for item in items], ensure_ascii=False)
    return (
        "You are a professional UI translator.\n"
        f"Translate each source string from {source_locale} into the locales "
        "listed on that item.\n\n"
        "Rules:\n"
        "- If an item has \"instructions\", those notes are mandatory and win over a "
        "literal translation of the source. Follow glossary terms, tone, length, "
        "and any required output text exactly, even if it is not a normal translation.\n"
        "- Instructions may be written in any language; interpret the intent.\n"
        "- Preserve placeholders exactly: {name}, {count}, %s, %d, HTML tags, ICU plural/select.\n"
        "- Keep UI tone: concise, natural, same intent, unless instructions say otherwise.\n"
        "- Do not translate brand names, product names, or code identifiers, "
        "unless instructions require it.\n"
        '- Copy each item "id" exactly.\n'
        "- For every locale, set confidence 0-100 honestly. Do not default to 90+.\n"
        "  90-100: unambiguous, instructions followed, placeholders preserved.\n"
        "  70-89: good, but more than one valid wording or slight tone ambiguity.\n"
        "  50-69: missing context, idiom, or UI length is uncertain — human should review.\n"
        "  0-49: guess; insufficient context or conflicting instructions.\n"
        f"- Call {TOOL_NAME} with every item and every requested locale. "
        "Do not reply with free text.\n\n"
        f"{_instruction_notes(items)}"
        f"Items:\n{payload}"
    )


def _converse_tool(prompt: str) -> dict:
    _refresh_bedrock_token()
    client = boto3.Session().client("bedrock-runtime", region_name=settings.aws_region)
    try:
        return client.converse(
            modelId=settings.bedrock_model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"temperature": TEMPERATURE, "maxTokens": MAX_TOKENS},
            toolConfig={
                "tools": [SUBMIT_TRANSLATIONS_TOOL],
                "toolChoice": {"tool": {"name": TOOL_NAME}},
            },
        )
    except NoCredentialsError as exc:
        raise ValueError(_AUTH_ERROR) from exc
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Bedrock request failed: {exc}") from exc


def _parse_tool_input(response: dict) -> dict[str, dict[str, TranslatedCell]]:
    content = response.get("output", {}).get("message", {}).get("content") or []
    tool_use = None
    for block in content:
        if not isinstance(block, dict):
            continue
        candidate = block.get("toolUse")
        if isinstance(candidate, dict) and candidate.get("name") == TOOL_NAME:
            tool_use = candidate
            break

    if tool_use is None:
        raise RuntimeError("Bedrock did not call submit_translations")

    raw_input = tool_use.get("input")
    if isinstance(raw_input, str):
        try:
            raw_input = json.loads(raw_input)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Bedrock tool input is not valid JSON") from exc
    if not isinstance(raw_input, dict):
        raise RuntimeError("Bedrock tool input is missing items")

    rows = raw_input.get("items")
    if not isinstance(rows, list):
        raise RuntimeError("Bedrock tool input is missing items")

    result: dict[str, dict[str, TranslatedCell]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "").strip()
        if not item_id:
            continue
        translations = row.get("translations")
        if not isinstance(translations, list):
            continue
        dest = result.setdefault(item_id, {})
        for cell in translations:
            if not isinstance(cell, dict):
                continue
            locale = str(cell.get("locale") or "").strip()
            text = cell.get("text")
            if not locale or not isinstance(text, str) or not text.strip():
                continue
            dest[locale] = TranslatedCell(
                text=text,
                confidence=clamp_confidence(cell.get("confidence")),
            )
    return result


def _filter_chunk_result(
    items: list[TranslateItem], parsed: dict[str, dict[str, TranslatedCell]]
) -> dict[str, dict[str, TranslatedCell]]:
    allowed = {item.id: set(item.locales) for item in items}
    filtered: dict[str, dict[str, TranslatedCell]] = {}
    for item_id, locales in parsed.items():
        wanted = allowed.get(item_id)
        if wanted is None:
            continue
        kept = {locale: cell for locale, cell in locales.items() if locale in wanted}
        if kept:
            filtered[item_id] = kept
    return filtered


def _translate_chunk(
    source_locale: str, items: list[TranslateItem]
) -> dict[str, dict[str, TranslatedCell]]:
    response = _converse_tool(_build_prompt(source_locale, items))
    return _filter_chunk_result(items, _parse_tool_input(response))


def _merge_results(
    into: dict[str, dict[str, TranslatedCell]], extra: dict[str, dict[str, TranslatedCell]]
) -> None:
    for item_id, locales in extra.items():
        dest = into.setdefault(item_id, {})
        for locale, cell in locales.items():
            if cell.text.strip():
                dest[locale] = cell


def _missing_items(
    items: list[TranslateItem], results: dict[str, dict[str, TranslatedCell]]
) -> list[TranslateItem]:
    missing: list[TranslateItem] = []
    for item in items:
        filled = results.get(item.id) or {}
        needed = tuple(
            locale
            for locale in item.locales
            if not (filled.get(locale) and filled[locale].text.strip())
        )
        if needed:
            missing.append(
                TranslateItem(
                    id=item.id,
                    source_text=item.source_text,
                    locales=needed,
                    context=item.context,
                )
            )
    return missing


def translate_batch(
    source_locale: str, items: list[TranslateItem]
) -> dict[str, dict[str, TranslatedCell]]:
    """Return {item_id: {locale: TranslatedCell}} for every filled cell."""
    if not items:
        return {}
    if not settings.bedrock_model_id:
        raise ValueError("BEDROCK_MODEL_ID is not configured")

    _refresh_bedrock_token()

    merged: dict[str, dict[str, TranslatedCell]] = {}
    for index in range(0, len(items), BATCH_SIZE):
        chunk = items[index : index + BATCH_SIZE]
        _merge_results(merged, _translate_chunk(source_locale, chunk))

    missing = _missing_items(items, merged)
    if missing:
        _merge_results(merged, _translate_chunk(source_locale, missing))
    return merged
