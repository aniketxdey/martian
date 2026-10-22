"""Runtime configuration, read from environment variables (prefix MARTIAN_ unless noted)."""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MARTIAN_", env_file=".env", extra="ignore")

    env: str = "development"
    # Postgres. The app role should NOT own the tables so row-level security applies.
    database_url: str = "postgresql+psycopg://martian_app:martian@localhost:5432/martian"
    # Owner role used by migrations only.
    migration_database_url: str | None = None
    # Alternative to the URLs: parts injected separately (e.g. ECS secrets from RDS-managed
    # credentials). When db_host is set, the URLs are built from these with proper escaping.
    db_host: str | None = None
    db_port: int = 5432
    db_name: str = "martian"
    db_app_user: str = "martian_app"
    db_app_password: str | None = None
    db_owner_user: str | None = None
    db_owner_password: str | None = None

    # Public URLs and CORS.
    web_origin: str = "http://localhost:5173"
    api_public_url: str = "http://localhost:8000"

    # Session tokens (HS256). Must be set in production.
    session_secret: str = "dev-insecure-session-secret-change-me"
    session_ttl_hours: int = 12
    cookie_secure: bool = False

    # AES-256-GCM key for secrets at rest (base64, 32 bytes). Ignored when kms_key_id is set.
    encryption_key: str | None = None
    kms_key_id: str | None = None

    # Shared secret between api/worker and the gateway (service-to-service).
    internal_token: str = "dev-internal-token-change-me"
    gateway_url: str = "http://localhost:8787"
    forecast_url: str = "http://localhost:8790/mcp"

    # What the console tells customers to install (pin to a released version in production).
    connector_image: str = "ghcr.io/aniketxdey/martian-connector:latest"
    connector_chart: str = "oci://ghcr.io/aniketxdey/charts/martian-connector"
    # Public WebSocket URL connectors dial (e.g. wss://connect.martian-ai.com/connect).
    # Defaults to the internal gateway URL, which only works for local development.
    connector_gateway_url: str | None = None

    @property
    def public_connector_url(self) -> str:
        if self.connector_gateway_url:
            return self.connector_gateway_url
        base = self.gateway_url.replace("http://", "ws://").replace("https://", "wss://").rstrip("/")
        return f"{base}/connect"

    # LLM.
    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    anthropic_model: str = "claude-sonnet-5-5"

    # SSO (WorkOS). Optional; password login works without it.
    workos_api_key: str | None = None
    workos_client_id: str | None = None

    # Scans.
    scan_interval_hours: int = 6
    worker_poll_seconds: float = 1.0

    # Demo tenant bootstrap.
    seed_demo: bool = False

    @field_validator(
        "anthropic_api_key", "workos_api_key", "workos_client_id", "encryption_key", "kms_key_id"
    )
    @classmethod
    def _unset_is_none(cls, v: str | None) -> str | None:
        # Secret placeholders ("unset", or empty from compose) mean "not configured".
        return None if v is None or v.strip() in {"", "unset"} else v

    @model_validator(mode="after")
    def _urls_from_parts(self) -> Settings:
        if self.db_host:

            def url(user: str, pw: str | None) -> str:
                auth = quote(user, safe="") + (f":{quote(pw, safe='')}" if pw else "")
                return f"postgresql+psycopg://{auth}@{self.db_host}:{self.db_port}/{self.db_name}"

            self.database_url = url(self.db_app_user, self.db_app_password)
            if self.db_owner_user:
                self.migration_database_url = url(self.db_owner_user, self.db_owner_password)
        return self

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def validate_for_production(self) -> None:
        if not self.is_production:
            return
        problems = []
        if "insecure" in self.session_secret or len(self.session_secret) < 32:
            problems.append("MARTIAN_SESSION_SECRET must be a random string of 32+ characters")
        if "change-me" in self.internal_token:
            problems.append("MARTIAN_INTERNAL_TOKEN must be set")
        if not (self.encryption_key or self.kms_key_id):
            problems.append("set MARTIAN_KMS_KEY_ID (preferred) or MARTIAN_ENCRYPTION_KEY")
        if not self.cookie_secure:
            problems.append("MARTIAN_COOKIE_SECURE must be true")
        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
