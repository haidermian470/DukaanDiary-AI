"""Central configuration.

All settings come from environment variables (or a local `.env` file).
Nothing secret is ever hard-coded here. See `.env.example` for the full list.
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Application ---
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    # Comma-separated list, e.g. "http://localhost:5173,https://dukaandiary.vercel.app"
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    business_timezone: str = "Asia/Karachi"
    default_currency: str = "PKR"

    # --- Database (Supabase Postgres connection string, server-side only) ---
    database_url: str | None = None

    # --- Supabase Auth (used to verify access tokens) ---
    supabase_url: str | None = None
    # Only needed for projects that still sign tokens with the legacy shared secret (HS256).
    supabase_jwt_secret: str | None = None
    supabase_jwt_audience: str = "authenticated"

    # --- Gemini ---
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: int = Field(default=30, ge=5, le=120)

    # --- Limits ---
    max_upload_size_mb: int = Field(default=5, ge=1, le=20)
    ai_rate_limit_per_minute: int = Field(default=20, ge=1, le=1000)

    # --- Local development only ---
    # Lets you call the API from Swagger without logging in. Refused in production.
    dev_auth_bypass: bool = False
    dev_user_id: str = "00000000-0000-4000-8000-000000000001"
    dev_user_email: str = "dev@dukaandiary.local"

    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, value: str | None) -> str | None:
        """Supabase shows `postgresql://...`; SQLAlchemy must be told to use psycopg v3."""
        if not value:
            return None
        if value.startswith("postgres://"):
            value = "postgresql://" + value[len("postgres://"):]
        if value.startswith("postgresql://"):
            value = "postgresql+psycopg://" + value[len("postgresql://"):]
        return value

    @field_validator("supabase_url")
    @classmethod
    def _strip_slash(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else None

    @model_validator(mode="after")
    def _safety_checks(self) -> "Settings":
        if self.app_env == "production" and self.dev_auth_bypass:
            raise ValueError("DEV_AUTH_BYPASS must never be enabled when APP_ENV=production.")
        if self.app_env == "production" and "*" in self.allowed_origins:
            raise ValueError("FRONTEND_ORIGINS cannot contain '*' in production.")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def auth_configured(self) -> bool:
        return bool(self.supabase_url or self.supabase_jwt_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
