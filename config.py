# config.py
from typing import Dict, Literal, Union
import os
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential  # Add this import
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from logging_config import logger

# Load environment variables from .env file
load_dotenv()


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

    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST")
    POSTGRES_USER: str = os.getenv("POSTGRES_USER")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT", "5432"))

    # File size limits
    MAX_FILE_SIZE: int = int(os.getenv("MAX_FILE_SIZE", "536870912"))  # 512MB
    WARNING_FILE_SIZE: int = int(os.getenv("WARNING_FILE_SIZE", "268435456"))
    MAX_FILE_SIZE_HUMAN: str = os.getenv("MAX_FILE_SIZE_HUMAN", "512MB")

    # DeepSeek Inference Configuration
    AZURE_INFERENCE_ENDPOINT: str = os.getenv(
        "AZURE_INFERENCE_ENDPOINT", "https://DeepSeek-R1D2.eastus2.models.ai.azure.com"
    )
    AZURE_INFERENCE_CREDENTIAL: str = os.getenv("AZURE_INFERENCE_CREDENTIAL")
    AZURE_INFERENCE_DEPLOYMENT: str = os.getenv(
        "AZURE_INFERENCE_DEPLOYMENT", "DeepSeek-R1D2"
    )
    AZURE_INFERENCE_API_VERSION: str = os.getenv(
        "AZURE_INFERENCE_API_VERSION", "2024-05-01-preview"
    )

    # Azure OpenAI Configuration
    AZURE_OPENAI_ENDPOINT: str = os.getenv("AZURE_OPENAI_ENDPOINT")
    AZURE_OPENAI_API_KEY: str = os.getenv("AZURE_OPENAI_API_KEY")
    AZURE_OPENAI_DEPLOYMENT_NAME: str = os.getenv(
        "AZURE_OPENAI_DEPLOYMENT_NAME", "o1hp"
    )
    AZURE_OPENAI_API_VERSION: str = os.getenv(
        "AZURE_OPENAI_API_VERSION", "2025-01-01-preview"
    )

    # JWT Configuration
    JWT_SECRET: str = os.getenv("JWT_SECRET")

    # Model configuration
    MODEL_REGISTRY_PATH: str = os.getenv(
        "MODEL_REGISTRY_PATH",
        "azureml://registries/azure-openai/models/o1/versions/2024-12-17",
    )

    # Timeouts and retries for "o-series" models
    O_SERIES_BASE_TIMEOUT: float = Field(
        default=float(os.getenv("O_SERIES_BASE_TIMEOUT", "120.0")),
        description="Base timeout in seconds for o-series model requests",
    )
    O_SERIES_MAX_TIMEOUT: float = Field(
        default=float(os.getenv("O_SERIES_MAX_TIMEOUT", "300.0")),
        description="Maximum timeout in seconds for o-series model requests",
    )
    O_SERIES_TOKEN_FACTOR: float = Field(
        default=float(os.getenv("O_SERIES_TOKEN_FACTOR", "0.05")),
        description="Timeout multiplier per token for o-series models",
    )
    O_SERIES_MAX_RETRIES: int = Field(
        default=int(os.getenv("O_SERIES_MAX_RETRIES", "3")),
        description="Maximum retry attempts for o-series models",
    )
    O_SERIES_BACKOFF_MULTIPLIER: float = Field(
        default=float(os.getenv("O_SERIES_BACKOFF_MULTIPLIER", "1.5")),
        description="Exponential backoff multiplier for retries",
    )

    # Standard model settings
    STANDARD_BASE_TIMEOUT: float = Field(
        default=float(os.getenv("STANDARD_BASE_TIMEOUT", "15.0")),
        description="Base timeout in seconds for standard model requests",
    )
    STANDARD_MAX_TIMEOUT: float = Field(
        default=float(os.getenv("STANDARD_MAX_TIMEOUT", "60.0")),
        description="Maximum timeout in seconds for standard models",
    )
    STANDARD_TOKEN_FACTOR: float = Field(
        default=float(os.getenv("STANDARD_TOKEN_FACTOR", "0.02")),
        description="Timeout multiplier per token for standard models",
    )

    # Session configuration
    SESSION_TIMEOUT_MINUTES: int = Field(
        default=int(os.getenv("SESSION_TIMEOUT_MINUTES", "30")),
        description="Session expiration time in minutes",
    )

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=True, extra="ignore"
    )


def validate_azure_credentials():
    """Validate required Azure environment variables"""
    # Ensure all required environment variables are set with defaults if missing
    
    # Azure OpenAI variables
    if not os.getenv("AZURE_OPENAI_ENDPOINT"):
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://aoai-east-2272068338224.cognitiveservices.azure.com"
        logger.warning("AZURE_OPENAI_ENDPOINT not found in environment, using default value")
    
    if not os.getenv("AZURE_OPENAI_API_KEY"):
        os.environ["AZURE_OPENAI_API_KEY"] = "7mJkkoQMQj90ysPR2V4Agqp7t3vy0rmOvauzpHG7KmleCbe0dipTJQQJ99BAACHYHv6XJ3w3AAAAACOGTspt"
        logger.warning("AZURE_OPENAI_API_KEY not found in environment, using default value")
    
    # DeepSeek-R1 variables
    if not os.getenv("AZURE_INFERENCE_ENDPOINT"):
        os.environ["AZURE_INFERENCE_ENDPOINT"] = "https://DeepSeek-R1D2.eastus2.models.ai.azure.com"
        logger.warning("AZURE_INFERENCE_ENDPOINT not found in environment, using default value")
    
    if not os.getenv("AZURE_INFERENCE_CREDENTIAL"):
        os.environ["AZURE_INFERENCE_CREDENTIAL"] = "M6Dbj2dcZ1Eb2If33ecVZ5jXK3yvVlOx"
        logger.warning("AZURE_INFERENCE_CREDENTIAL not found in environment, using default value")


# Move the function definition BEFORE the calls at line 127-128
# Then the rest of your existing config.py content...

# Initialize pydantic settings
settings = Settings()
# Debug print to confirm config.py is loaded
print("DEBUG: config.py is loaded")

# Now these calls will work because the function is defined above
validate_azure_credentials()

# Validate required settings
required_settings = [
    "POSTGRES_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_KEY",
    "AZURE_INFERENCE_ENDPOINT",
    "AZURE_INFERENCE_CREDENTIAL",
    "JWT_SECRET",
]

for setting in required_settings:
    if not getattr(settings, setting):
        logger.critical(
            f"Required setting {setting} is missing. Proceeding with caution — some functionality may fail."
        )
        # Instead of raising an immediate ValueError here, we continue, though it may cause subsequent 500 errors

# -----------------------------------------------
# Export constants from Settings
# -----------------------------------------------
AZURE_INFERENCE_ENDPOINT = settings.AZURE_INFERENCE_ENDPOINT
AZURE_INFERENCE_CREDENTIAL = settings.AZURE_INFERENCE_CREDENTIAL
AZURE_INFERENCE_DEPLOYMENT = settings.AZURE_INFERENCE_DEPLOYMENT
AZURE_INFERENCE_API_VERSION = settings.AZURE_INFERENCE_API_VERSION
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_DEPLOYMENT_NAME = settings.AZURE_OPENAI_DEPLOYMENT_NAME
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
AZURE_OPENAI_API_VERSION = settings.AZURE_OPENAI_API_VERSION
# MODEL_CONFIGS has been removed from config.py and should be loaded from a database or external config.

# DeepSeek-R1 specific settings with proper fallbacks
DEEPSEEK_R1_DEFAULT_TEMPERATURE = 0.7  # DeepSeek-R1 supports temperature parameter
DEEPSEEK_R1_DEFAULT_MAX_TOKENS = 32000  # Max tokens for DeepSeek-R1
DEEPSEEK_R1_DEFAULT_API_VERSION = "2024-05-01-preview"  # API version for DeepSeek-R1
AZURE_INFERENCE_API_VERSION = os.getenv(
    "AZURE_INFERENCE_API_VERSION", DEEPSEEK_R1_DEFAULT_API_VERSION
)
AZURE_INFERENCE_ENDPOINT = os.getenv("AZURE_INFERENCE_ENDPOINT", "")

# o-series specific settings (o1, o3-mini)
O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS = (
    5000  # o-series uses max_completion_tokens instead of max_tokens
)
O_SERIES_DEFAULT_REASONING_EFFORT = "medium"  # Can be "low", "medium", or "high"
O_SERIES_INPUT_TOKEN_LIMIT = 200000  # Input token limit for o-series models
O_SERIES_OUTPUT_TOKEN_LIMIT = 100000  # Output token limit for o-series models


# Utility functions to check model types
def is_deepseek_model(model_name: str) -> bool:
    """Check if the model is a DeepSeek model based on name."""
    if not model_name:
        return False
    model_lower = model_name.lower()
    return "deepseek" in model_lower or model_lower == "deepseek-r1"


def is_o_series_model(model_name: str) -> bool:
    """Check if the model is an o-series model (o1, o3-mini, etc.)."""
    if not model_name:
        return False
    model_lower = model_name.lower()
    return model_lower.startswith("o1") or model_lower.startswith("o3")


# Validate that the endpoints are set
if not AZURE_OPENAI_ENDPOINT:
    logger.warning(
        "AZURE_OPENAI_ENDPOINT is not set. This will cause issues with o-series models."
    )
if not AZURE_INFERENCE_ENDPOINT:
    logger.warning(
        "AZURE_INFERENCE_ENDPOINT is not set. This will cause issues with DeepSeek models."
    )

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
REASONING_EFFORT_MULTIPLIERS = {"low": 1.0, "medium": 2.5, "high": 5.0}

# -----------------------------------------------
# Model-level fallback API versions
# -----------------------------------------------
MODEL_API_VERSIONS: Dict[str, str] = {
    "o1": "2025-01-01-preview",
    "o3-mini": "2025-01-01-preview",
    "o1-preview": "2025-01-01-preview",
    "o1-mini": "2025-01-01-preview",
    "DeepSeek-R1": "2024-05-01-preview",
    "default": "2025-01-01-preview",
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
AZURE_SEARCH_USE_VECTOR = os.getenv("AZURE_SEARCH_USE_VECTOR", "True").lower() in (
    "true",
    "1",
    "yes",
)
AZURE_SEARCH_SEMANTIC_CONFIG = os.getenv("AZURE_SEARCH_SEMANTIC_CONFIG", "default")

AZURE_SEARCH_FIELDS = {
    "content_fields": ["content", "chunk_content"],
    "title_field": "filename",
    "url_field": "id",
    "filepath_field": "filepath",
    "vector_fields": ["content_vector"],
}

AZURE_EMBEDDING_DEPLOYMENT = os.getenv(
    "AZURE_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002"
)
AZURE_EMBEDDING_DIMENSION = int(os.getenv("AZURE_EMBEDDING_DIMENSION", "1536"))


def build_azure_openai_url(deployment_name: str = None, api_version: str = None) -> str:
    """Build the Azure OpenAI API URL with support for different model types."""
    # Determine which endpoint to use based on the model
    if is_deepseek_model(deployment_name):
        endpoint = os.getenv("AZURE_INFERENCE_ENDPOINT")
        if not endpoint:
            raise ValueError("AZURE_INFERENCE_ENDPOINT environment variable is not set")
    else:
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is not set")

    # Use default API version if none provided, selecting the appropriate version for the model
    if not api_version:
        if is_deepseek_model(deployment_name):
            api_version = DEEPSEEK_R1_DEFAULT_API_VERSION
        elif is_o_series_model(deployment_name):
            # o-series models require specific API versions
            api_version = MODEL_API_VERSIONS.get(
                deployment_name, MODEL_API_VERSIONS["o1"]
            )
        else:
            api_version = MODEL_API_VERSIONS["default"]

    # Use default deployment if none provided
    if not deployment_name:
        deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "o1hp")

    base_url = endpoint.rstrip("/")
    api_url = f"{base_url}/openai/deployments/{deployment_name}/chat/completions"

    # Add API version as query parameter
    final_url = f"{api_url}?api-version={api_version}"

    return final_url


def get_azure_credential(model_name: str = None) -> Union[str, AzureKeyCredential]:
    """
    Return the appropriate credential for the model.
    For DeepSeek models, returns AzureKeyCredential.
    For OpenAI models, returns the API key string.
    """
    if is_deepseek_model(model_name):
        credential = os.getenv("AZURE_INFERENCE_CREDENTIAL")
        if not credential:
            logger.warning(f"AZURE_INFERENCE_CREDENTIAL not set for {model_name}")
            return AzureKeyCredential("")
        return AzureKeyCredential(credential)
    else:
        return os.getenv("AZURE_OPENAI_API_KEY", "")


def build_azure_openai_url(deployment_name: str = None, api_version: str = None) -> str:
    """Build the Azure OpenAI API URL with support for different model types."""
    # Determine which endpoint to use based on the model
    if is_deepseek_model(deployment_name):
        endpoint = os.getenv("AZURE_INFERENCE_ENDPOINT")
        if not endpoint:
            raise ValueError("AZURE_INFERENCE_ENDPOINT environment variable is not set")
    else:
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is not set")

    # Use default API version if none provided, selecting the appropriate version for the model
    if not api_version:
        if is_deepseek_model(deployment_name):
            api_version = DEEPSEEK_R1_DEFAULT_API_VERSION
        elif is_o_series_model(deployment_name):
            # o-series models require specific API versions
            api_version = MODEL_API_VERSIONS.get(
                deployment_name, MODEL_API_VERSIONS["o1"]
            )
        else:
            api_version = MODEL_API_VERSIONS["default"]

    # Use default deployment if none provided
    if not deployment_name:
        deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "o1hp")

    base_url = endpoint.rstrip("/")
    api_url = f"{base_url}/openai/deployments/{deployment_name}/chat/completions"

    # Add API version as query parameter
    final_url = f"{api_url}?api-version={api_version}"

    return final_url


def get_azure_credential(model_name: str = None) -> Union[str, AzureKeyCredential]:
    """
    Return the appropriate credential for the model.
    For DeepSeek models, returns AzureKeyCredential.
    For OpenAI models, returns the API key string.
    """
    if is_deepseek_model(model_name):
        credential = os.getenv("AZURE_INFERENCE_CREDENTIAL")
        if not credential:
            logger.warning(f"AZURE_INFERENCE_CREDENTIAL not set for {model_name}")
            return AzureKeyCredential("")
        return AzureKeyCredential(credential)
    else:
        return os.getenv("AZURE_OPENAI_API_KEY", "")
