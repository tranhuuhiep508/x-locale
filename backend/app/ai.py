from __future__ import annotations

import json
import os
import random
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Literal

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
MAX_CHUNK_WORKERS = 5
MAX_TOKENS = 4096
TEMPERATURE = 0.2
TOOL_NAME = "submit_translations"
MAX_CONVERSE_ATTEMPTS = 3
THROTTLE_BACKOFF_SECONDS = (0.5, 1.0, 2.0)
THROTTLE_CODES = frozenset(
    {"ThrottlingException", "TooManyRequestsException", "ServiceUnavailableException"}
)

ProgressPhase = Literal["translating", "retrying", "filling_gaps"]
ProgressCallback = Callable[[ProgressPhase, int, int], None]

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


def _client_error_code(exc: ClientError) -> str:
    response = exc.response if isinstance(exc.response, dict) else {}
    error = response.get("Error")
    if not isinstance(error, dict):
        return ""
    return str(error.get("Code") or "")


def _is_throttle_error(exc: BaseException) -> bool:
    return isinstance(exc, ClientError) and _client_error_code(exc) in THROTTLE_CODES


def _converse_once(prompt: str) -> dict:
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
    except ClientError as exc:
        if _is_throttle_error(exc):
            raise
        raise RuntimeError(f"Bedrock request failed: {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Bedrock request failed: {exc}") from exc


def _converse_tool(prompt: str, on_retry: Callable[[], None] | None = None) -> dict:
    last_error: BaseException | None = None
    for attempt in range(MAX_CONVERSE_ATTEMPTS):
        try:
            return _converse_once(prompt)
        except ClientError as exc:
            last_error = exc
            if not _is_throttle_error(exc) or attempt >= MAX_CONVERSE_ATTEMPTS - 1:
                raise RuntimeError(f"Bedrock request failed: {exc}") from exc
            if on_retry is not None:
                on_retry()
            delay = THROTTLE_BACKOFF_SECONDS[attempt] + random.uniform(0, 0.25)
            time.sleep(delay)
    raise RuntimeError(f"Bedrock request failed: {last_error}") from last_error


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
    source_locale: str,
    items: list[TranslateItem],
    on_retry: Callable[[], None] | None = None,
    on_filling: Callable[[], None] | None = None,
) -> dict[str, dict[str, TranslatedCell]]:
    prompt = _build_prompt(source_locale, items)
    parsed = _filter_chunk_result(items, _parse_tool_input(_converse_tool(prompt, on_retry)))
    missing = _missing_items(items, parsed)
    if missing:
        if on_filling is not None:
            on_filling()
        retry_prompt = _build_prompt(source_locale, missing)
        retry_parsed = _parse_tool_input(_converse_tool(retry_prompt, on_retry))
        _merge_results(parsed, _filter_chunk_result(missing, retry_parsed))
    return parsed


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
    source_locale: str,
    items: list[TranslateItem],
    on_progress: ProgressCallback | None = None,
) -> dict[str, dict[str, TranslatedCell]]:
    """Return {item_id: {locale: TranslatedCell}} for every filled cell."""
    if not items:
        return {}
    if not settings.bedrock_model_id:
        raise ValueError("BEDROCK_MODEL_ID is not configured")

    _refresh_bedrock_token()

    chunks = [items[index : index + BATCH_SIZE] for index in range(0, len(items), BATCH_SIZE)]
    chunks_total = len(chunks)
    chunks_done = 0
    done_lock = threading.Lock()
    merged: dict[str, dict[str, TranslatedCell]] = {}

    def report(phase: ProgressPhase, done: int | None = None) -> None:
        if on_progress is None:
            return
        current = chunks_done if done is None else done
        on_progress(phase, current, chunks_total)

    report("translating", 0)

    def run_chunk(chunk: list[TranslateItem]) -> dict[str, dict[str, TranslatedCell]]:
        nonlocal chunks_done

        def on_retry() -> None:
            with done_lock:
                report("retrying")

        def on_filling() -> None:
            with done_lock:
                report("filling_gaps")

        result = _translate_chunk(source_locale, chunk, on_retry=on_retry, on_filling=on_filling)
        with done_lock:
            chunks_done += 1
            report("translating")
        return result

    workers = min(MAX_CHUNK_WORKERS, len(chunks))
    if workers == 1:
        _merge_results(merged, run_chunk(chunks[0]))
        return merged

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_chunk, chunk) for chunk in chunks]
        for future in as_completed(futures):
            _merge_results(merged, future.result())
    return merged
