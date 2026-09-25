from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Default in repo; production must override via X_LOCALE_SECRET.
INSECURE_DEFAULT_X_LOCALE_SECRET = "change-me-in-production"  # pragma: allowlist secret


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "sqlite:///./x-locale.db"
    aws_region: str = "us-east-1"
    bedrock_model_id: str = "us.amazon.nova-2-lite-v1:0"
    # Deterministic AI translations for E2E / local dev (no Bedrock calls).
    ai_translate_stub: bool = False
    ai_translate_stub_delay_ms: int = 0
    job_inline_nudge: bool = True
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


settings = Settings()
