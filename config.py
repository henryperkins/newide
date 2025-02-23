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
    Loads environment variables for DB credentials
    """
    POSTGRES_HOST: str = "chatterpostgres.postgres.database.azure.com"
    POSTGRES_USER: str = "hperkins@chatterpostgres"
    POSTGRES_PASSWORD: str = "Twiohmld1234!"
    POSTGRES_DB: str = "chatterdb"
    POSTGRES_PORT: int = 5432

    # File size limits
    MAX_FILE_SIZE: int = 512 * 1024 * 1024   # 512MB
    WARNING_FILE_SIZE: int = 256 * 1024 * 1024
    MAX_FILE_SIZE_HUMAN: str = "512MB"

    # DeepSeek Inference Configuration
    AZURE_INFERENCE_ENDPOINT: str = "https://your-host-name.your-azure-region.inference.ai.azure.com"
    AZURE_INFERENCE_CREDENTIAL: str = "your-32-character-key-here"
    AZURE_INFERENCE_DEPLOYMENT: str = "DeepSeek-R1"
    AZURE_INFERENCE_API_VERSION: str = "2025-01-01-preview"

    # Model configuration
    MODEL_REGISTRY_PATH: str = "azureml://registries/azureml-deepseek/models/DeepSeek-R1"

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
        case_sensitive=True,
        extra="ignore"
    )

    # Removed obsolete validator since we switched to AZURE_INFERENCE_DEPLOYMENT

# Initialize pydantic settings
settings = Settings()

# -----------------------------------------------
# Export constants from Settings
# -----------------------------------------------
AZURE_INFERENCE_ENDPOINT = settings.AZURE_INFERENCE_ENDPOINT
AZURE_INFERENCE_CREDENTIAL = settings.AZURE_INFERENCE_CREDENTIAL
AZURE_INFERENCE_DEPLOYMENT = settings.AZURE_INFERENCE_DEPLOYMENT
AZURE_INFERENCE_API_VERSION = settings.AZURE_INFERENCE_API_VERSION

# Model-specific configurations
MODEL_CONFIGS = {
    "DeepSeek-R1": {
        "max_tokens": 40000,
        "supports_temperature": False,
        "supports_streaming": True,
        "is_reasoning_model": True,
        "base_timeout": 120.0,
        "max_timeout": 300.0,
        "token_factor": 0.05,
        "api_version": "2025-01-01-preview",
        "embeddings_endpoint": f"{settings.AZURE_INFERENCE_ENDPOINT}/embeddings",
        "api_key": settings.AZURE_INFERENCE_CREDENTIAL
    },
    AZURE_INFERENCE_DEPLOYMENT: {
        "max_tokens": 40000,
        "supports_streaming": False,
        "supports_temperature": False,
        "base_timeout": settings.O_SERIES_BASE_TIMEOUT,
        "max_timeout": settings.O_SERIES_MAX_TIMEOUT,
        "token_factor": settings.O_SERIES_TOKEN_FACTOR
    }
}

O_SERIES_BASE_TIMEOUT = settings.O_SERIES_BASE_TIMEOUT
O_SERIES_MAX_TIMEOUT = settings.O_SERIES_MAX_TIMEOUT
O_SERIES_TOKEN_FACTOR = settings.O_SERIES_TOKEN_FACTOR
O_SERIES_MAX_RETRIES = settings.O_SERIES_MAX_RETRIES
O_SERIES_BACKOFF_MULTIPLIER = settings.O_SERIES_BACKOFF_MULTIPLIER

STANDARD_BASE_TIMEOUT = settings.STANDARD_BASE_TIMEOUT
STANDARD_MAX_TIMEOUT = settings.STANDARD_MAX_TIMEOUT
STANDARD_TOKEN_FACTOR = settings.STANDARD_TOKEN_FACTOR

SESSION_TIMEOUT_MINUTES = settings.SESSION_TIMEOUT_MINUTES

# Reasoning effort multipliers (not in Settings to reduce complexity)
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

def build_azure_openai_url(deployment_name: str = None, api_version: str = None) -> str:
    """Build the Azure OpenAI API URL"""
    endpoint = os.getenv('AZURE_OPENAI_ENDPOINT', 
                        'https://aoai-east-2272068338224.cognitiveservices.azure.com')
    
    if not endpoint:
        raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is not set")
        
    # Use default API version if none provided
    if not api_version:
        api_version = os.getenv('AZURE_OPENAI_API_VERSION', '2025-01-01-preview')
        
    # Use default deployment if none provided 
    if not deployment_name:
        deployment_name = os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME', 'o1')

    base_url = endpoint.rstrip('/')
    api_url = f"{base_url}/openai/deployments/{deployment_name}/chat/completions"
    
    # Add API version as query parameter
    final_url = f"{api_url}?api-version={api_version}"
    
    return final_url
    
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
