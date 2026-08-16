import os

import boto3
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

from app.config import settings


def _ensure_bedrock_auth() -> None:
    if os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
        return

    if boto3.Session().get_credentials() is not None:
        return

    raise ValueError(
        "AWS Bedrock auth is not configured. Set AWS_BEARER_TOKEN_BEDROCK "
        "or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your environment."
    )


def _extract_text(response: dict) -> str:
    content = response.get("output", {}).get("message", {}).get("content", [])
    if not content:
        return ""
    return (content[0].get("text") or "").strip()


def _converse(prompt: str) -> str:
    client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
    response = client.converse(
        modelId=settings.bedrock_model_id,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"temperature": 0.2, "maxTokens": 1024},
    )
    return _extract_text(response)


def translate_text(source_text: str, source_locale: str, target_locale: str, context: str | None = None) -> str:
    if not settings.bedrock_model_id:
        raise ValueError("BEDROCK_MODEL_ID is not configured")

    _ensure_bedrock_auth()

    context_line = f"\nContext: {context}" if context else ""
    prompt = (
        f"Translate the following UI string from {source_locale} to {target_locale}. "
        f"Preserve placeholders like {{name}} or {{count}} exactly.{context_line}\n\n"
        f"Source: {source_text}\n\n"
        f"Return only the translated text, no quotes or explanation."
    )

    try:
        return _converse(prompt)
    except NoCredentialsError as exc:
        raise ValueError(
            "AWS Bedrock auth is not configured. Set AWS_BEARER_TOKEN_BEDROCK in your environment."
        ) from exc
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Bedrock request failed: {exc}") from exc
