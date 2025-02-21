from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import ClassVar, Dict, Literal
import os

from pydantic import validator

class DataSourceConfig(BaseModel):
    type: Literal["azure_search", "pinecone", "elasticsearch"]
    parameters: dict

class Settings(BaseSettings):
    # File size limits
    MAX_FILE_SIZE: int = 512 * 1024 * 1024  # 512MB
    WARNING_FILE_SIZE: int = 256 * 1024 * 1024  # 256MB
    MAX_FILE_SIZE_HUMAN: str = "512MB"  # For error messages
    
    # Azure OpenAI settings
    AZURE_OPENAI_ENDPOINT: str = Field(..., description="Azure OpenAI endpoint URL")
    AZURE_OPENAI_API_KEY: str = Field(..., description="Azure OpenAI API key")
    AZURE_OPENAI_DEPLOYMENT_NAME: str = Field(..., description="Azure OpenAI deployment name")
    AZURE_OPENAI_API_VERSION: str = Field(
        default="2024-12-01-preview",
        description="Azure OpenAI API version"
    )
    
# Version matrix for model families (module-level constant)
MODEL_API_VERSIONS = {
    "o1": "2024-05-01-preview",
    "o3-mini": "2024-05-01-preview",
    "o1-preview": "2024-05-01-preview",
    "o1-mini": "2024-05-01-preview",
    "default": "2024-05-01-preview"
}

async def get_db_config(key: str, default: Any = None) -> Any:
    from services.config_service import ConfigService
    from database import get_db_session
    async with get_db_session() as session:
        config_service = ConfigService(session)
        value = await config_service.get_config(key)
        return value if value is not None else default

async def azure_openai_settings():
    return await get_db_config("azure_openai", {
        "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
        "api_version": "2024-05-01-preview"
    })

async def model_settings():
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

class Settings(BaseSettings):
    # Core infrastructure settings remain in env vars
    POSTGRES_HOST: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    POSTGRES_PORT: int = 5432

    @validator("AZURE_OPENAI_API_VERSION")
    def validate_api_version(cls, v, values):
        deployment = values.get("AZURE_OPENAI_DEPLOYMENT_NAME", "").lower()
        
        # Map deployment names to model families
        model_family = next(
            (key for key in ["o3-mini", "o1", "o1-preview"] if deployment.startswith(key)),
            "default"
        )
        
        # Get minimum required version for this model family
        min_version = MODEL_API_VERSIONS.get(model_family, MODEL_API_VERSIONS["default"])
        
        # Compare version dates (ignoring '-preview' suffix)
        def parse_version(ver):
            return tuple(map(int, ver.split('-')[0].split('.')))
            
        current_ver = parse_version(v)
        required_ver = parse_version(min_version)
        
        if current_ver < required_ver:
            print(f"Version mismatch! {deployment} requires at least {min_version}, using {v}")
        elif current_ver > required_ver:
            print(f"Note: Using newer API version {v} (minimum required {min_version})")
        
        return v

    # PostgreSQL settings
    POSTGRES_HOST: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str  # No SecretStr wrapper for dev speed
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

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="allow",
        env_file_encoding="utf-8"
    )

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

# Azure AI Search configuration
AZURE_SEARCH_ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY")
AZURE_SEARCH_USE_VECTOR = os.getenv("AZURE_SEARCH_USE_VECTOR", "True").lower() in ("true", "1", "yes")
AZURE_SEARCH_SEMANTIC_CONFIG = os.getenv("AZURE_SEARCH_SEMANTIC_CONFIG", "default")

# Azure AI Search index field mappings
AZURE_SEARCH_FIELDS = {
    "content_fields": ["content", "chunk_content"],
    "title_field": "filename",
    "url_field": "id",
    "filepath_field": "filepath",
    "vector_fields": ["content_vector"],
}

# Azure AI vector settings
AZURE_EMBEDDING_DEPLOYMENT = os.getenv("AZURE_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002")
AZURE_EMBEDDING_DIMENSION = int(os.getenv("AZURE_EMBEDDING_DIMENSION", "1536"))

def get_azure_search_index_schema(index_name):
    """
    Get Azure AI Search index schema for file search
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
                            {
                                "fieldName": "content"
                            },
                            {
                                "fieldName": "chunk_content"
                            }
                        ],
                        "titleField": {
                            "fieldName": "filename"
                        },
                        "urlField": {
                            "fieldName": "filepath"
                        }
                    }
                }
            ]
        }
    }

# PostgreSQL Configuration with full SSL verification
POSTGRES_URL = f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"

# Session configuration
SESSION_TIMEOUT_MINUTES = settings.session_timeout_minutes
