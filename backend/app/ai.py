from __future__ import annotations

import json
import logging
import threading
import time
import traceback
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAI,
    PermissionDeniedError,
    RateLimitError,
)
from pydantic import BaseModel, ConfigDict

from app.config import settings

logger = logging.getLogger(__name__)

ProgressPhase = Literal["translating", "retrying", "filling_gaps"]
ProgressCallback = Callable[[ProgressPhase, int, int], None]


class AITranslationError(RuntimeError):
    """A fixed, safe message suitable for HTTP responses, job errors, and logs."""


class AIConfigurationError(AITranslationError):
    pass


def safe_ai_error(exc: Exception) -> str:
    return (
        str(exc)
        if isinstance(exc, AITranslationError)
        else "AI translation failed. Please try again."
    )


def log_ai_failure(exc: Exception) -> None:
    """Log the failure type and stack. The message can contain request data."""
    if isinstance(exc, AITranslationError):
        return
    logger.error(
        "AI translation failed (%s)\n%s",
        type(exc).__name__,
        "".join(traceback.format_tb(exc.__traceback__)),
    )


class TranslationValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: str
    text: str
    confidence: int


class TranslationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    translations: list[TranslationValue]


class TranslationsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[TranslationItem]


_client: OpenAI | None = None
_client_condition = threading.Condition()
_active_operations = 0


@contextmanager
def _translation_client() -> Iterator[OpenAI]:
    global _client, _active_operations
    with _client_condition:
        if _client is None:
            options = (
                {"base_url": settings.openai_base_url.strip()}
                if settings.openai_base_url.strip()
                # Prevent SDK environment fallback from bypassing our settings source.
                else {"data_residency": "global"}
            )
            try:
                _client = OpenAI(api_key=settings.openai_api_key.strip(), max_retries=2, **options)
            except Exception:
                raise AIConfigurationError(
                    "AI translation client configuration is invalid."
                ) from None
        client = _client
        _active_operations += 1
    try:
        yield client
    finally:
        with _client_condition:
            _active_operations -= 1
            _client_condition.notify_all()


def close_ai_client() -> None:
    """Drain translation operations before closing their shared connection pool."""
    global _client
    with _client_condition:
        _client_condition.wait_for(lambda: _active_operations == 0)
        if _client is not None:
            _client.close()
            _client = None


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
    except TypeError, ValueError:
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
        f"- id={item.id}: {item.context.strip()}"
        for item in items
        if item.context and item.context.strip()
    ]
    if not lines:
        return ""
    header = "Mandatory translator notes (override a literal translation):\n"
    return header + "\n".join(lines) + "\n\n"


def _build_prompt(source_locale: str, items: list[TranslateItem]) -> str:
    payload = json.dumps([_item_payload(item) for item in items], ensure_ascii=False)
    output_instruction = (
        "- Return only a JSON object matching the supplied schema, with every item "
        "and every requested locale. Do not use Markdown.\n\n"
    )
    return (
        "You are a professional UI translator.\n"
        f"Translate each source string from {source_locale} into the locales "
        "listed on that item.\n\n"
        "Rules:\n"
        '- If an item has "instructions", those notes are mandatory and win over a '
        "literal translation of the source. Follow glossary terms, tone, length, "
        "and any required output text exactly, even if it is not a normal translation.\n"
        "- Instructions may be written in any language; interpret the intent.\n"
        "- Preserve placeholders exactly: {name}, {count}, %s, %d, HTML tags, ICU plural/select.\n"
        "- Keep UI tone: concise, natural, same intent, unless instructions say otherwise.\n"
        "- Prefer standard UI wording; use the same terminology for the same concept. "
        "Do not embellish or add information absent from the source.\n"
        "- Do not translate brand names, product names, or code identifiers, "
        "unless instructions require it.\n"
        '- Copy each item "id" exactly.\n'
        "- For every locale, set confidence 0-100 honestly. Do not default to 90+.\n"
        "  90-100: unambiguous, instructions followed, placeholders preserved.\n"
        "  70-89: good, but more than one valid wording or slight tone ambiguity.\n"
        "  50-69: missing context, idiom, or UI length is uncertain — human should review.\n"
        "  0-49: guess; insufficient context or conflicting instructions.\n"
        f"{output_instruction}"
        f"{_instruction_notes(items)}"
        f"Items:\n{payload}"
    )


def _generate(client: OpenAI, prompt: str) -> dict[str, dict[str, TranslatedCell]]:
    try:
        response = client.responses.parse(
            model=settings.openai_model.strip(),
            input=prompt,
            max_output_tokens=settings.openai_max_output_tokens,
            text_format=TranslationsResponse,
        )
        return _parse_response(response)
    except AITranslationError:
        raise
    except AuthenticationError, PermissionDeniedError:
        raise AITranslationError(
            "AI translation authentication or permission failed. Check the configured credentials."
        ) from None
    except RateLimitError:
        raise AITranslationError(
            "AI translation rate limit exceeded. Please try again later."
        ) from None
    except APITimeoutError:
        raise AITranslationError("AI translation request timed out. Please try again.") from None
    except APIConnectionError:
        raise AITranslationError("AI translation connection failed. Please try again.") from None
    except APIStatusError as exc:
        message = (
            "AI translation upstream service failed. Please try again."
            if exc.status_code >= 500
            else "AI translation request was rejected. Check the model and endpoint configuration."
        )
        raise AITranslationError(message) from None
    except Exception:
        # SDK parsing errors can contain the full model output.
        raise AITranslationError(
            "AI translation returned invalid or unsuccessful output."
        ) from None


def _parse_response(response) -> dict[str, dict[str, TranslatedCell]]:
    if (
        response.status != "completed"
        or any(
            content.type == "refusal"
            for output in response.output
            if output.type == "message"
            for content in output.content
        )
        or response.output_parsed is None
    ):
        raise AITranslationError("AI translation returned invalid or unsuccessful output.")

    result: dict[str, dict[str, TranslatedCell]] = {}
    for row in response.output_parsed.items:
        item_id = row.id.strip()
        if item_id in result:
            raise AITranslationError("AI translation returned duplicate item IDs.")
        dest: dict[str, TranslatedCell] = {}
        seen_locales: set[str] = set()
        for cell in row.translations:
            locale = cell.locale.strip()
            if locale in seen_locales:
                raise AITranslationError("AI translation returned duplicate locales.")
            seen_locales.add(locale)
            if cell.text.strip():
                dest[locale] = TranslatedCell(cell.text, clamp_confidence(cell.confidence))
        result[item_id] = dest
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
    client: OpenAI,
    on_filling: Callable[[], None] | None = None,
) -> dict[str, dict[str, TranslatedCell]]:
    prompt = _build_prompt(source_locale, items)
    parsed = _filter_chunk_result(items, _generate(client, prompt))
    missing = _missing_items(items, parsed)
    if missing:
        if on_filling is not None:
            on_filling()
        retry_prompt = _build_prompt(source_locale, missing)
        retry_parsed = _generate(client, retry_prompt)
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


def _stub_translate_batch(
    items: list[TranslateItem],
    on_progress: ProgressCallback | None = None,
) -> dict[str, dict[str, TranslatedCell]]:
    size = settings.ai_translate_batch_size
    chunks_total = max(1, (len(items) + size - 1) // size)
    if on_progress is not None:
        on_progress("translating", 0, chunks_total)
    if settings.ai_translate_stub_delay_ms > 0:
        time.sleep(settings.ai_translate_stub_delay_ms / 1000)
    result: dict[str, dict[str, TranslatedCell]] = {}
    for item in items:
        dest: dict[str, TranslatedCell] = {}
        for locale in item.locales:
            dest[locale] = TranslatedCell(
                text=f"[{locale}] {item.source_text}",
                confidence=85,
            )
        result[item.id] = dest
    if on_progress is not None:
        on_progress("translating", chunks_total, chunks_total)
    return result


def translate_batch(
    source_locale: str,
    items: list[TranslateItem],
    on_progress: ProgressCallback | None = None,
) -> dict[str, dict[str, TranslatedCell]]:
    """Return {item_id: {locale: TranslatedCell}} for every filled cell."""
    if not items:
        return {}
    if settings.ai_translate_stub:
        return _stub_translate_batch(items, on_progress=on_progress)
    if not settings.openai_api_key.strip():
        raise AIConfigurationError("OPENAI_API_KEY is not configured")
    if not settings.openai_model.strip():
        raise AIConfigurationError("OPENAI_MODEL is not configured")
    with _translation_client() as client:
        return _translate_batches(source_locale, items, on_progress, client)


def _translate_batches(
    source_locale: str,
    items: list[TranslateItem],
    on_progress: ProgressCallback | None,
    client: OpenAI,
) -> dict[str, dict[str, TranslatedCell]]:
    size = settings.ai_translate_batch_size
    chunks = [items[index : index + size] for index in range(0, len(items), size)]
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
    stop = threading.Event()

    def run_chunk(chunk: list[TranslateItem]) -> dict[str, dict[str, TranslatedCell]]:
        nonlocal chunks_done
        if stop.is_set():
            return {}

        def on_filling() -> None:
            with done_lock:
                report("filling_gaps")

        try:
            result = _translate_chunk(source_locale, chunk, client, on_filling=on_filling)
        except Exception:
            # Set before returning so the next batch this worker picks up does not call the model.
            stop.set()
            raise
        with done_lock:
            chunks_done += 1
            report("translating")
        return result

    workers = min(settings.ai_translate_max_workers, len(chunks))
    if workers == 1:
        for chunk in chunks:
            _merge_results(merged, run_chunk(chunk))
        return merged

    executor = ThreadPoolExecutor(max_workers=workers)
    try:
        futures = [executor.submit(run_chunk, chunk) for chunk in chunks]
        try:
            for future in as_completed(futures):
                _merge_results(merged, future.result())
        except Exception:
            stop.set()
            for future in futures:
                future.cancel()
            raise
        return merged
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
