from pathlib import Path
from typing import Literal

from botocore.exceptions import BotoCoreError, ClientError
from pydantic import PositiveInt, TypeAdapter
from pydantic_settings import AWSSecretsManagerSettingsSource, BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

OpenAIReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]

# Default in repo; production must override via X_LOCALE_SECRET.
INSECURE_DEFAULT_X_LOCALE_SECRET = "change-me-in-production"  # pragma: allowlist secret


class _AWSSettingsSource(AWSSecretsManagerSettingsSource):
    def _load_env_vars(self):
        values = super()._load_env_vars()
        if not isinstance(values, dict):
            raise TypeError("Expected a JSON object")
        if "auth_dev_bypass" in values:
            raise RuntimeError(
                "Secrets Manager configuration must not set AUTH_DEV_BYPASS; "
                "configure it with environment variables only"
            )
        # The secret cannot select another secret or disable AWS-mode validation.
        values.pop("x_locale_secret_id", None)
        values.pop("secret_enable", None)
        return values


def _load_aws_settings(settings_cls: type[BaseSettings], secret_id: str) -> dict:
    try:
        return _AWSSettingsSource(settings_cls, secret_id, case_sensitive=False)()
    except BotoCoreError, ClientError, KeyError, ValueError, TypeError, AttributeError:
        raise RuntimeError(
            "Cannot load Secrets Manager configuration; check AWS credentials, region, "
            "permissions, connectivity, and JSON SecretString format"
        ) from None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), extra="ignore", hide_input_in_errors=True
    )

    def __init__(self, **values):
        super().__init__(**values)
        if self.secret_enable:
            try:
                require_postgres_database_url(self.database_url)
                if not make_url(self.database_url).database:
                    raise ValueError
            except ArgumentError, ValueError, SystemExit:
                raise RuntimeError(
                    "AWS configuration requires a valid Postgres DATABASE_URL"
                ) from None
            if (
                not self.x_locale_secret.strip()
                or self.x_locale_secret.strip() == INSECURE_DEFAULT_X_LOCALE_SECRET
            ):
                raise RuntimeError("AWS configuration requires a secure X_LOCALE_SECRET")

    @classmethod
    def settings_customise_sources(
        cls, settings_cls, init_settings, env_settings, dotenv_settings, file_secret_settings
    ):
        sources = (init_settings, env_settings, dotenv_settings)
        selector = "x_locale_secret_id"
        bootstrap = {}
        for source in reversed(sources):
            bootstrap.update(source())
        enabled = TypeAdapter(bool, config={"hide_input_in_errors": True}).validate_python(
            bootstrap.get("secret_enable", False)
        )
        secret_id = bootstrap.get(selector, "")
        if enabled and not secret_id:
            raise RuntimeError("SECRET_ENABLE=true requires X_LOCALE_SECRET_ID")

        def file_settings():
            values = file_secret_settings()
            values.pop(selector, None)
            values.pop("secret_enable", None)
            return values

        if enabled:
            return (*sources, lambda: _load_aws_settings(settings_cls, secret_id), file_settings)
        return (*sources, file_settings)

    secret_enable: bool = False
    x_locale_secret_id: str = ""
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
    oidc_issuer: str = "https://login.microsoftonline.com/common/v2.0"
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
