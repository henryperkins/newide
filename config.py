from pydantic_settings import BaseSettings
from pydantic import SecretStr
import os

class Settings(BaseSettings):
    # Azure OpenAI settings
    AZURE_OPENAI_ENDPOINT: str
    AZURE_OPENAI_API_KEY: str
    AZURE_OPENAI_DEPLOYMENT_NAME: str
    AZURE_OPENAI_API_VERSION: str = "2024-02-01"  # Use current stable version

    # PostgreSQL settings
    POSTGRES_HOST: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: SecretStr
    POSTGRES_DB: str
    POSTGRES_PORT: int = 5432

    # Timeout settings (with defaults)
    o_series_base_timeout: float = 120.0  # 2 minute base timeout
    o_series_max_timeout: float = 360.0   # 6 minute max timeout
    o_series_token_factor: float = 0.15   # 0.15 seconds per token
    o_series_max_retries: int = 2         # Max number of retries
    o_series_backoff_multiplier: float = 1.5  # Backoff multiplier

    # Standard model timeouts
    standard_base_timeout: float = 15.0
    standard_max_timeout: float = 30.0
    standard_token_factor: float = 0.03

    # Session configuration
    session_timeout_minutes: int = 30

    class Config:
        env_file = ".env"
        extra = "allow"  # Allow extra parameters in .env without validation errors
        env_file_encoding = "utf-8"

settings = Settings()

# Export settings for use in application
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT_NAME = settings.AZURE_OPENAI_DEPLOYMENT_NAME
AZURE_OPENAI_API_VERSION = settings.AZURE_OPENAI_API_VERSION

# Timeouts and retries
O_SERIES_BASE_TIMEOUT = settings.o_series_base_timeout
O_SERIES_MAX_TIMEOUT = settings.o_series_max_timeout
O_SERIES_TOKEN_FACTOR = settings.o_series_token_factor
O_SERIES_MAX_RETRIES = settings.o_series_max_retries
O_SERIES_BACKOFF_MULTIPLIER = settings.o_series_backoff_multiplier

# Standard model settings
STANDARD_BASE_TIMEOUT = settings.standard_base_timeout
STANDARD_MAX_TIMEOUT = settings.standard_max_timeout
STANDARD_TOKEN_FACTOR = settings.standard_token_factor

# Reasoning effort multipliers
REASONING_EFFORT_MULTIPLIERS = {
    "low": 1.0,
    "medium": 2.5,
    "high": 5.0,
}

# PostgreSQL Configuration with full SSL verification
POSTGRES_URL = f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD.get_secret_value()}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"

# Session configuration
SESSION_TIMEOUT_MINUTES = settings.session_timeout_minutes
