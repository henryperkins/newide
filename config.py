from pydantic_settings import BaseSettings
from pydantic import SecretStr, validator
from typing import Dict
import os

class Settings(BaseSettings):
    # Azure OpenAI settings
    azure_openai_endpoint: str
    azure_openai_api_key: SecretStr
    azure_openai_deployment_name: str
    azure_openai_api_version: str = "2025-01-01-preview"

    # Database settings  
    postgres_host: str
    postgres_user: str
    postgres_password: SecretStr
    postgres_db: str
    postgres_port: int = 5432

    # Timeout settings
    o_series_base_timeout: float = 120.0
    o_series_max_timeout: float = 360.0
    o_series_token_factor: float = 0.15
    o_series_max_retries: int = 2
    o_series_backoff_multiplier: float = 1.5

    reasoning_effort_multipliers: Dict[str, float] = {
        "low": 1.0,
        "medium": 2.5,
        "high": 5.0
    }

    @validator("postgres_port")
    def validate_port(cls, v):
        if not 1024 <= v <= 65535:
            raise ValueError("Port must be between 1024 and 65535")
        return v

    class Config:
        env_file = '.env'
        env_file_encoding = 'utf-8'

settings = Settings()

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_DEPLOYMENT_NAME = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
AZURE_OPENAI_API_VERSION = os.getenv(
    "AZURE_OPENAI_API_VERSION",
    "2025-01-01-preview"
)

O_SERIES_BASE_TIMEOUT = float(
    os.getenv("O_SERIES_BASE_TIMEOUT", "120.0")
)  # 2 minute base timeout
O_SERIES_MAX_TIMEOUT = float(
    os.getenv("O_SERIES_MAX_TIMEOUT", "360.0")
)  # 6 minute max timeout
O_SERIES_TOKEN_FACTOR = float(
    os.getenv("O_SERIES_TOKEN_FACTOR", "0.15")
)  # 0.15 seconds per token
O_SERIES_MAX_RETRIES = int(
    os.getenv("O_SERIES_MAX_RETRIES", "2")
)  # Max number of retries
O_SERIES_BACKOFF_MULTIPLIER = float(
    os.getenv("O_SERIES_BACKOFF_MULTIPLIER", "1.5")
)  # Backoff multiplier

# Reasoning effort multipliers
REASONING_EFFORT_MULTIPLIERS = {
    "low": float(os.getenv("REASONING_EFFORT_LOW_MULTIPLIER", "1.0")),
    "medium": float(os.getenv("REASONING_EFFORT_MEDIUM_MULTIPLIER", "2.5")),
    "high": float(os.getenv("REASONING_EFFORT_HIGH_MULTIPLIER", "5.0")),
}

# Standard model timeout settings (keep existing defaults)
STANDARD_BASE_TIMEOUT = float(os.getenv("STANDARD_BASE_TIMEOUT", "15.0"))
STANDARD_MAX_TIMEOUT = float(os.getenv("STANDARD_MAX_TIMEOUT", "30.0"))
STANDARD_TOKEN_FACTOR = float(os.getenv("STANDARD_TOKEN_FACTOR", "0.03"))

# PostgreSQL Configuration
POSTGRES_HOST = os.getenv("PGHOST")
POSTGRES_USER = os.getenv("PGUSER")
POSTGRES_PASSWORD = os.getenv("PGPASSWORD")
POSTGRES_DB = os.getenv("PGDATABASE")
POSTGRES_PORT = os.getenv("PGPORT", "5432")

POSTGRES_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}?ssl=require"

if not all([POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB]):
    raise ValueError("Missing required PostgreSQL environment variables")

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")  # 32-url-safe-base64 bytes
SESSION_TIMEOUT_MINUTES = int(
    os.getenv("SESSION_TIMEOUT_MINUTES", "30")
)

# Validate required environment variables
missing_vars = []
if not AZURE_OPENAI_ENDPOINT:
    missing_vars.append("AZURE_OPENAI_ENDPOINT")
if not AZURE_OPENAI_API_KEY:
    missing_vars.append("AZURE_OPENAI_API_KEY")
if not AZURE_OPENAI_DEPLOYMENT_NAME:
    missing_vars.append("AZURE_OPENAI_DEPLOYMENT_NAME")

if missing_vars:
    raise ValueError(
        "Missing required Azure OpenAI environment variables: " + 
        ", ".join(missing_vars) +
        "\nPlease check your .env file and Azure portal for these values."
    )
