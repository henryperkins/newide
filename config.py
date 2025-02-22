from typing import ClassVar, Dict, Literal, Any, Optional
import os

from pydantic import BaseModel, Field, validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from logging_config import logger

# -----------------------------------------------
# Data Source Config
# -----------------------------------------------
class DataSourceConfig(BaseModel):
    """
    Represents a generic data source configuration.
    If you need more detailed validation for each type
    (e.g. Azure vs Pinecone), consider separate models
    instead of a plain dict for parameters.
    """
    type: Literal["azure_search", "pinecone", "elasticsearch"]
    parameters: dict


# -----------------------------------------------
# Main Settings Class
# -----------------------------------------------
class Settings(BaseSettings):
    """
    Loads environment variables for DB credentials,
    file size limits, Azure OpenAI settings, timeouts, etc.
    """
    # PostgreSQL
    POSTGRES_HOST: str = Field(..., description="PostgreSQL host address")
    POSTGRES_USER: str = Field(..., description="PostgreSQL username")
    POSTGRES_PASSWORD: str = Field(..., description="PostgreSQL password")
    POSTGRES_DB: str = Field(..., description="PostgreSQL database name")
    POSTGRES_PORT: int = Field(default=5432, description="PostgreSQL port number")

    # File size limits
    MAX_FILE_SIZE: int = 512 * 1024 * 1024   # 512MB
    WARNING_FILE_SIZE: int = 256 * 1024 * 1024
    MAX_FILE_SIZE_HUMAN: str = "512MB"

    # Azure OpenAI
    AZURE_OPENAI_ENDPOINT: str = Field(..., description="Azure OpenAI endpoint URL")
    AZURE_OPENAI_API_KEY: str = Field(..., description="Azure OpenAI API key")
    AZURE_OPENAI_DEPLOYMENT_NAME: str = Field(..., description="Azure OpenAI deployment name")

    # NOTE: If you want to allow all preview versions in 2024 or 2025,
    # consider updating or removing the pattern for months 1..12.
    AZURE_OPENAI_API_VERSION: str = Field(
        default="2025-01-01-preview",
        description="Azure OpenAI API version",
        pattern=r"202[45]-(0[1-9]|1[0-2])-01-preview",
        json_schema_extra={"example": "2025-01-01-preview"}
    )

    # Timeouts and retries for "o-series" models
    O_SERIES_BASE_TIMEOUT: float = Field(
        default=120.0,
        description="Base timeout in seconds for o-series model requests"
    )
    O_SERIES_MAX_TIMEOUT: float = Field(
        default=300.0,
        description="Maximum timeout in seconds for o-series model requests"
    )
    O_SERIES_TOKEN_FACTOR: float = Field(
        default=0.05,
        description="Timeout multiplier per token for o-series models"
    )
    O_SERIES_MAX_RETRIES: int = Field(
        default=3,
        description="Maximum retry attempts for o-series models"
    )
    O_SERIES_BACKOFF_MULTIPLIER: float = Field(
        default=1.5,
        description="Exponential backoff multiplier for retries"
    )

    # Standard model settings
    STANDARD_BASE_TIMEOUT: float = Field(
        default=15.0,
        description="Base timeout in seconds for standard model requests"
    )
    STANDARD_MAX_TIMEOUT: float = Field(
        default=60.0,
        description="Maximum timeout in seconds for standard models"
    )
    STANDARD_TOKEN_FACTOR: float = Field(
        default=0.02,
        description="Timeout multiplier per token for standard models"
    )

    # Session configuration
    SESSION_TIMEOUT_MINUTES: int = Field(
        default=30,
        description="Session expiration time in minutes"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"  # ignore unrecognized env variables
    )

    # Optional example of custom validator usage:
    @validator("AZURE_OPENAI_DEPLOYMENT_NAME")
    def strip_deployment_name(cls, v):
        """
        Example: disallow leading/trailing spaces or empty.
        """
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Deployment name cannot be empty or just spaces")
        return trimmed


# Initialize pydantic settings
settings = Settings()

# -----------------------------------------------
# Export constants from Settings
# -----------------------------------------------
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT_NAME = settings.AZURE_OPENAI_DEPLOYMENT_NAME
AZURE_OPENAI_API_VERSION = settings.AZURE_OPENAI_API_VERSION

O_SERIES_BASE_TIMEOUT = settings.O_SERIES_BASE_TIMEOUT
O_SERIES_MAX_TIMEOUT = settings.O_SERIES_MAX_TIMEOUT
O_SERIES_TOKEN_FACTOR = settings.O_SERIES_TOKEN_FACTOR
O_SERIES_MAX_RETRIES = settings.O_SERIES_MAX_RETRIES
O_SERIES_BACKOFF_MULTIPLIER = settings.O_SERIES_BACKOFF_MULTIPLIER

STANDARD_BASE_TIMEOUT = settings.STANDARD_BASE_TIMEOUT
STANDARD_MAX_TIMEOUT = settings.STANDARD_MAX_TIMEOUT
STANDARD_TOKEN_FACTOR = settings.STANDARD_TOKEN_FACTOR

SESSION_TIMEOUT_MINUTES = settings.SESSION_TIMEOUT_MINUTES


# Reasoning effort multipliers (not in Settings to keep it simpler)
REASONING_EFFORT_MULTIPLIERS = {
    "low": 1.0,
    "medium": 2.5,
    "high": 5.0
}


# -----------------------------------------------
# Model-level fallback API versions
# -----------------------------------------------
MODEL_API_VERSIONS: Dict[str, str] = {
    "o1":         "2025-01-01-preview",
    "o3-mini":    "2025-01-01-preview",
    "o1-preview": "2025-01-01-preview",
    "o1-mini":    "2025-01-01-preview",
    "default":    "2025-01-01-preview"
}


# -----------------------------------------------
# Async Config Access Helpers
# -----------------------------------------------
async def get_db_config(key: str, default: Any = None) -> Any:
    """
    Retrieves config from database by key. 
    Returns `default` if config is not found or is None.
    """
    from services.config_service import ConfigService
    from database import get_db_session

    async with get_db_session() as session:
        config_service = ConfigService(session)
        value = await config_service.get_config(key)
        return value if value is not None else default


def build_azure_openai_url(deployment_name: str = None, api_version: str = None) -> str:
    """Build Azure OpenAI endpoint URL using configuration values"""
    deployment = deployment_name or AZURE_OPENAI_DEPLOYMENT_NAME
    version = api_version or AZURE_OPENAI_API_VERSION
    return f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{deployment}/chat/completions?api-version={version}"

async def azure_openai_settings() -> dict:
    """
    Example function that tries to load 'azure_openai' from DB,
    otherwise uses environment fallback.
    """
    return await get_db_config("azure_openai", {
        "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
        "api_version": "2025-01-01-preview"
    })


async def model_settings() -> dict:
    """
    Example function that fetches per-model configs from DB,
    or returns a default dictionary if not found.
    """
    return await get_db_config("models", {
        "o1": {
            "max_tokens": 40000,
            "temperature": 1.0
        },
        "deepseek-r1": {
            "max_tokens": 4096,
            "temperature": 0.7
        }
    })


# -----------------------------------------------
# PostgreSQL Connection String
# -----------------------------------------------
POSTGRES_URL = (
    f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
)


# -----------------------------------------------
# Azure Search Configuration
# -----------------------------------------------
AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY")
AZURE_SEARCH_USE_VECTOR = os.getenv("AZURE_SEARCH_USE_VECTOR", "True").lower() in ("true", "1", "yes")
AZURE_SEARCH_SEMANTIC_CONFIG = os.getenv("AZURE_SEARCH_SEMANTIC_CONFIG", "default")

AZURE_SEARCH_FIELDS = {
    "content_fields": ["content", "chunk_content"],
    "title_field": "filename",
    "url_field": "id",
    "filepath_field": "filepath",
    "vector_fields": ["content_vector"],
}

AZURE_EMBEDDING_DEPLOYMENT = os.getenv("AZURE_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002")
AZURE_EMBEDDING_DIMENSION = int(os.getenv("AZURE_EMBEDDING_DIMENSION", "1536"))


def get_azure_search_index_schema(index_name: str) -> dict:
    """
    Build a schema dict for Azure Cognitive Search index creation.
    This includes vector search configs, semantic configs, etc.
    """
    return {
        "name": index_name,
        "fields": [
            {
                "name": "id",
                "type": "Edm.String",
                "key": True,
                "filterable": True
            },
            {
                "name": "filename",
                "type": "Edm.String",
                "searchable": True,
                "filterable": True,
                "sortable": True
            },
            {
                "name": "content",
                "type": "Edm.String",
                "searchable": True,
                "analyzer": "standard.lucene"
            },
            {
                "name": "chunk_content",
                "type": "Edm.String",
                "searchable": True,
                "analyzer": "standard.lucene"
            },
            {
                "name": "filepath",
                "type": "Edm.String",
                "searchable": True,
                "filterable": True
            },
            {
                "name": "file_type",
                "type": "Edm.String",
                "filterable": True
            },
            {
                "name": "session_id",
                "type": "Edm.String",
                "filterable": True
            },
            {
                "name": "chunk_id",
                "type": "Edm.Int32",
                "filterable": True,
                "sortable": True
            },
            {
                "name": "chunk_total",
                "type": "Edm.Int32"
            },
            {
                "name": "content_vector",
                "type": "Collection(Edm.Single)",
                "searchable": True,
                "dimensions": AZURE_EMBEDDING_DIMENSION,
                "vectorSearchConfiguration": "vectorConfig"
            },
            {
                "name": "last_updated",
                "type": "Edm.DateTimeOffset",
                "filterable": True,
                "sortable": True
            }
        ],
        "vectorSearch": {
            "algorithmConfigurations": [
                {
                    "name": "vectorConfig",
                    "kind": "hnsw"
                }
            ]
        },
        "semantic": {
            "configurations": [
                {
                    "name": "default",
                    "prioritizedFields": {
                        "contentFields": [
                            {"fieldName": "content"},
                            {"fieldName": "chunk_content"}
                        ],
                        "titleField": {"fieldName": "filename"},
                        "urlField": {"fieldName": "filepath"}
                    }
                }
            ]
        }
    }
