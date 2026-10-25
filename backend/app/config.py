import json
import re
from contextlib import closing
from pathlib import Path
from typing import Literal

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import PositiveInt
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

OpenAIReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]

# Default in repo; production must override via X_LOCALE_SECRET.
INSECURE_DEFAULT_X_LOCALE_SECRET = "change-me-in-production"  # pragma: allowlist secret
SECRETS_ARN_PATH = Path("/run/x-locale/secrets-arn")

_UNREAD = object()
_bootstrap_arn_cache: str | None | object = _UNREAD


def _reset_bootstrap_arn_cache() -> None:
    global _bootstrap_arn_cache
    _bootstrap_arn_cache = _UNREAD


def _bootstrap_arn() -> str | None:
    global _bootstrap_arn_cache
    if _bootstrap_arn_cache is _UNREAD:
        _bootstrap_arn_cache = _read_secrets_arn()
    return _bootstrap_arn_cache if isinstance(_bootstrap_arn_cache, str) else None


def _read_secrets_arn() -> str | None:
    try:
        arn = SECRETS_ARN_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        if not SECRETS_ARN_PATH.is_symlink():
            return None
        raise RuntimeError("Cannot read Secrets Manager bootstrap file") from None
    except OSError, UnicodeError:
        raise RuntimeError("Cannot read Secrets Manager bootstrap file") from None
    if not re.fullmatch(
        r"arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[\w/+=.@-]+-[A-Za-z0-9]{6}",
        arn,
        flags=re.ASCII,
    ):
        raise RuntimeError("Secrets Manager bootstrap file must contain a full secret ARN")
    return arn


def _load_aws_settings(settings_cls: type[BaseSettings], arn: str) -> dict:
    try:
        with closing(
            boto3.client(
                "secretsmanager",
                region_name=arn.split(":")[3],
                config=Config(
                    retries={"mode": "standard", "total_max_attempts": 3},
                    connect_timeout=5,
                    read_timeout=10,
                ),
            )
        ) as client:
            response = client.get_secret_value(SecretId=arn)
    except (BotoCoreError, ClientError) as error:
        raise RuntimeError(
            f"Cannot load Secrets Manager configuration ({type(error).__name__}); "
            "check AWS credentials, permissions, "
            "connectivity, and secret availability"
        ) from None
    if "SecretString" not in response:
        raise RuntimeError("Secrets Manager configuration requires a JSON SecretString")
    try:
        payload = json.loads(response["SecretString"])
    except ValueError, TypeError:
        raise RuntimeError("Secrets Manager configuration must be valid JSON") from None
    if not isinstance(payload, dict):
        raise RuntimeError("Secrets Manager configuration must be a JSON object")
    if "AUTH_DEV_BYPASS" in payload:
        raise RuntimeError(
            "Secrets Manager configuration must not set AUTH_DEV_BYPASS; "
            "configure it with environment variables only"
        )
    values = {
        name: payload[name.upper()] for name in settings_cls.model_fields if name.upper() in payload
    }
    # Validate before any caller can create a database engine, even with dev bypass enabled.
    database_url = values.get("database_url")
    if not isinstance(database_url, str):
        raise RuntimeError(
            "Secrets Manager configuration requires a valid Postgres DATABASE_URL"
        )
    try:
        require_postgres_database_url(database_url)
        if not make_url(database_url).database:
            raise ValueError
    except ArgumentError, ValueError, SystemExit:
        raise RuntimeError(
            "Secrets Manager configuration requires a valid Postgres DATABASE_URL"
        ) from None
    secret = values.get("x_locale_secret")
    if (
        not isinstance(secret, str)
        or not secret.strip()
        or secret.strip() == INSECURE_DEFAULT_X_LOCALE_SECRET
    ):
        raise RuntimeError("Secrets Manager configuration requires a secure X_LOCALE_SECRET")
    return values


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), extra="ignore", hide_input_in_errors=True
    )

    def __init__(self, **values):
        # Pydantic reads dotenv before settings_customise_sources selects AWS mode.
        _reset_bootstrap_arn_cache()
        if _bootstrap_arn() is not None:
            values["_env_file"] = None
        super().__init__(**values)

    @classmethod
    def settings_customise_sources(
        cls, settings_cls, init_settings, env_settings, dotenv_settings, file_secret_settings
    ):
        arn = _bootstrap_arn()
        if arn is not None:
            # Earlier sources win on conflicts; secret first, then env, then init kwargs.
            return (
                lambda: _load_aws_settings(settings_cls, arn),
                env_settings,
                init_settings,
            )
        return init_settings, env_settings, dotenv_settings, file_secret_settings

    database_url: str = ""
    # Bootstrap database for CREATE/DROP. Harnesses connect here, not to postgres.
    test_database_url: str = ""
    # production makes seed-demo refuse unless --allow-production is passed.
    env: str = ""
    aws_region: str = "us-east-1"
    openai_api_key: str = ""
    openai_model: str = "gpt-6-luna"
    openai_base_url: str = ""
    openai_max_output_tokens: PositiveInt = 16000
    openai_reasoning_effort: OpenAIReasoningEffort = "none"
    ai_translate_batch_size: PositiveInt = 20
    ai_translate_max_workers: PositiveInt = 5
    # Deterministic AI translations for E2E / local dev (no model calls).
    ai_translate_stub: bool = False
    ai_translate_stub_delay_ms: int = 0
    x_locale_secret: str = INSECURE_DEFAULT_X_LOCALE_SECRET
    x_locale_demo_api_key: str = "demo-local-key"
    default_base_language: str = "vi"

    # OIDC
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_scopes: str = "openid email profile"
    oidc_redirect_url: str = "http://localhost:5173/api/auth/callback"
    auth_dev_bypass: bool = False
    session_cookie_secure: bool = False

    # Imports with more values, and undos with more activities, run as a background
    # job when the client sends `Prefer: respond-async`.
    import_async_threshold: int = 5000

    # Optional retention for append-only activity log (0 = keep forever)
    activity_retention_days: int = 90

    # Optional. Set only when the frontend runs on a different origin (not needed with Vite /api proxy).
    cors_origins: str = ""
    # Built frontend directory (e.g. static/). When present, FastAPI serves the SPA from the same origin.
    static_dir: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def static_directory(self) -> Path | None:
        if not self.static_dir.strip():
            return None
        path = Path(self.static_dir)
        return path if path.is_dir() else None

    @property
    def oidc_configured(self) -> bool:
        return bool(self.oidc_issuer and self.oidc_client_id and self.oidc_client_secret)

    @property
    def dev_bypass_active(self) -> bool:
        """Mint Dev User only when bypass is on and OIDC is not configured."""
        return self.auth_dev_bypass and not self.oidc_configured

    @property
    def cookies_secure(self) -> bool:
        if self.session_cookie_secure:
            return True
        return self.oidc_redirect_url.strip().lower().startswith("https://")

    def validate_for_runtime(self) -> None:
        """Refuse production-like boot with known-insecure defaults."""
        if self.dev_bypass_active:
            return
        secret = (self.x_locale_secret or "").strip()
        if not secret or secret == INSECURE_DEFAULT_X_LOCALE_SECRET:
            raise RuntimeError(
                "X_LOCALE_SECRET must be set to a long random value when "
                "AUTH_DEV_BYPASS is false or OIDC is configured"
            )


def require_postgres_database_url(url: str | None) -> str:
    """Exit unless url is a Postgres URL.

    The API app, seed-demo, and Alembic call this before they touch the database.
    The loc client does not use DATABASE_URL and does not call this.
    """
    value = (url or "").strip()
    lowered = value.lower()
    if lowered.startswith(("postgresql://", "postgresql+", "postgres://", "postgres+")):
        return value
    raise SystemExit(
        "A Postgres DATABASE_URL is required (postgresql:// or postgresql+psycopg://)."
    )


settings = Settings()
