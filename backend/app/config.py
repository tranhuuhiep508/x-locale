from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "sqlite:///./tms.db"
    aws_region: str = "us-east-1"
    aws_bearer_token_bedrock: str = ""
    bedrock_model_id: str = "us.amazon.nova-2-lite-v1:0"
    tms_secret: str = "dev-secret-change-me"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
