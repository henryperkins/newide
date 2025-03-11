# clients.py

import logging
from typing import Dict, Optional, Any, Union

from sqlalchemy.ext.asyncio import AsyncSession
from openai import AzureOpenAI, AsyncAzureOpenAI
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

import config

# Use standard logging initially to avoid circular imports
logger = logging.getLogger(__name__)

# Import logger from logging_config later in the file after everything is defined
# This avoids the circular import issue

# Type alias for client objects
AzureAIClient = Union[AzureOpenAI, AsyncAzureOpenAI, ChatCompletionsClient]
ModelConfigDict = Dict[str, Any]

class ModelRegistry:
    """Centralized registry for model configurations and client creation"""

    # Standard model templates with required parameters
    MODEL_TEMPLATES = {
        "deepseek": {
            "name": "DeepSeek-R1",
            "description": "Model that supports chain-of-thought reasoning with <think> tags",
            "thinking_tags": ["think", "/think"],
            "max_tokens": config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
            "supports_streaming": True,
            "supports_temperature": True,
            "api_version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
            "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05,
        },
        "o_series": {
            "description": "Advanced reasoning model for complex tasks",
            "max_tokens": 200000,
            "max_completion_tokens": config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
            "supports_temperature": False,
            "supports_streaming": True,  # Changed from False
            "supports_vision": True,
            "requires_reasoning_effort": True,
            "reasoning_effort": config.O_SERIES_DEFAULT_REASONING_EFFORT,
            "base_timeout": config.O_SERIES_BASE_TIMEOUT,
            "max_timeout": config.O_SERIES_MAX_TIMEOUT,
            "token_factor": config.O_SERIES_TOKEN_FACTOR,
            "api_version": config.AZURE_OPENAI_API_VERSION,
            "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
        },
    }

    @classmethod
    def create_default_models(cls) -> Dict[str, Dict[str, Any]]:
        """Create default model configurations"""
        default_models = {}

        # Create DeepSeek-R1 model
        # Create DeepSeek-R1 model
        deepseek_model = cls.MODEL_TEMPLATES["deepseek"].copy()
        deepseek_model["model_type"] = "deepseek"
        deepseek_model["enable_thinking"] = True
        # Case sensitive model name should be all lowercase per DeepSeek docs
        default_models["DeepSeek-R1"] = deepseek_model

        # Create o1 model
        o1_model = cls.MODEL_TEMPLATES["o_series"].copy()
        o1_model["name"] = config.AZURE_OPENAI_DEPLOYMENT_NAME
        default_models[config.AZURE_OPENAI_DEPLOYMENT_NAME] = o1_model

        return default_models

    @classmethod
    def get_model_template(cls, model_name: str) -> Dict[str, Any]:
        """Get appropriate template for a model based on its name"""
        if config.is_deepseek_model(model_name):
            return cls.MODEL_TEMPLATES["deepseek"].copy()
        elif config.is_o_series_model(model_name):
            template = cls.MODEL_TEMPLATES["o_series"].copy()
            template["name"] = model_name
            return template
        else:
            # Generic model template
            return {
                "name": model_name,
                "description": f"Configuration for {model_name}",
                "max_tokens": 4096,
                "supports_streaming": False,
                "supports_temperature": True,
                "api_version": config.AZURE_OPENAI_API_VERSION,
                "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                "base_timeout": 60.0,
                "max_timeout": 120.0,
                "token_factor": 0.02,
            }

    @classmethod
    def validate_model_config(
        cls, model_id: str, model_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate and fill in missing fields for a model configuration"""
        # Start with appropriate template
        template = cls.get_model_template(model_id)

        # Override with provided config
        for key, value in model_config.items():
            template[key] = value

        # Ensure name is correct
        template["name"] = model_id

        # Convert numeric fields to appropriate types
        for field in ["base_timeout", "max_timeout", "token_factor"]:
            if field in template:
                template[field] = float(template[field])

        if "max_tokens" in template:
            template["max_tokens"] = int(template["max_tokens"])

        # Set appropriate endpoints based on model type
        if config.is_deepseek_model(model_id) and "azure_endpoint" not in model_config:
            template["azure_endpoint"] = config.AZURE_INFERENCE_ENDPOINT
            template["api_version"] = config.DEEPSEEK_R1_DEFAULT_API_VERSION
            template["supports_streaming"] = True
            template["supports_temperature"] = True
        elif config.is_o_series_model(model_id):
            template["azure_endpoint"] = config.AZURE_OPENAI_ENDPOINT
            template["api_version"] = config.AZURE_OPENAI_API_VERSION
            template["supports_streaming"] = True
            template["supports_temperature"] = False
            template["requires_reasoning_effort"] = True

        return template


class ClientPool:
    """
    Manages a pool of Azure OpenAI and Azure AI Inference clients for different models.
    Uses ModelRegistry for configuration management.
    """

    _instance = None
    _clients = {}
    _model_configs = {}

    def __init__(self, model_configs=None):
        self._model_configs = model_configs or {}

    @classmethod
    async def get_instance(cls, db_session: Optional[AsyncSession] = None):
        """Get or create the singleton instance"""
        if not cls._instance:
            cls._instance = cls()
            if db_session:
                await cls._instance._initialize_from_db(db_session)
            else:
                cls._instance._model_configs = ModelRegistry.create_default_models()
        return cls._instance

    async def _initialize_from_db(self, db_session: AsyncSession):
        """Initialize configurations from database"""
        try:
            from services.config_service import ConfigService

            config_service = ConfigService(db_session)

            # Get model configs from database
            db_models = await config_service.get_config("model_configs")

            if not db_models or len(db_models) == 0:
                # Create default models if none exist
                default_models = ModelRegistry.create_default_models()
                await config_service.set_config(
                    "model_configs",
                    default_models,
                    "Default model configurations",
                    is_secret=True,
                )
                self._model_configs = default_models
            else:
                self._model_configs = db_models

            # Create clients for each model
            for model_id, model_config in self._model_configs.items():
                # Validate and normalize configuration
                model_config = ModelRegistry.validate_model_config(
                    model_id, model_config
                )
                self._model_configs[model_id] = model_config

                # Create client
                try:
                    self._clients[model_id] = self._create_client(
                        model_id, model_config
                    )
                    logger.info(f"Initialized client for model: {model_id}")
                except Exception as e:
                    logger.error(
                        f"Failed to initialize client for model '{model_id}': {str(e)}"
                    )

            # Create default client if none exists
            if not self._clients:
                # Add a fallback model
                default_model = config.AZURE_OPENAI_DEPLOYMENT_NAME
                model_config = ModelRegistry.get_model_template(default_model)
                self._model_configs[default_model] = model_config
                self._clients[default_model] = self._create_client(
                    default_model, model_config
                )
                logger.info(f"Created fallback client for model: {default_model}")

        except Exception as e:
            logger.error(f"Error initializing ClientPool from database: {str(e)}")
            # Fall back to default models
            self._model_configs = ModelRegistry.create_default_models()

    def _create_client(self, model_id: str, model_config: Dict[str, Any]) -> AzureAIClient:
        """Create the appropriate client based on model type"""
        if not model_id:
            raise ValueError("model_id cannot be None")
        # Ensure AZURE_INFERENCE_CREDENTIAL is non-null for DeepSeek  
        
        if config.is_deepseek_model(model_id):
            endpoint = config.AZURE_INFERENCE_ENDPOINT
            if not endpoint:
                raise ValueError("AZURE_INFERENCE_ENDPOINT is required for DeepSeek models")
                
            # Remove any trailing /chat/completions from endpoint
            endpoint = endpoint.rstrip('/').replace('/chat/completions', '')
            
            key = config.AZURE_INFERENCE_CREDENTIAL
            if not key:
                raise ValueError("AZURE_INFERENCE_CREDENTIAL is required for DeepSeek models")
            
            return ChatCompletionsClient(
                endpoint=endpoint,
                credential=AzureKeyCredential(key),
                api_version="2024-05-01-preview"
            )
        elif config.is_o_series_model(model_id):
            api_key = config.AZURE_OPENAI_API_KEY
            if not api_key:
                raise ValueError("AZURE_OPENAI_API_KEY is required for O-series models")
            
            azure_endpoint = model_config.get("azure_endpoint")
            if not azure_endpoint:
                raise ValueError("azure_endpoint is required in model_config for O-series models")
                
            return AzureOpenAI(
                api_key=api_key,
                azure_endpoint=azure_endpoint,
                api_version=model_config["api_version"],
                default_headers={
                    "reasoning-effort": model_config.get("reasoning_effort", "medium"),
                    "x-ms-json-response": "true",
                    "x-ms-reasoning-effort": model_config.get("reasoning_effort", "medium"),
                },
                max_retries=config.O_SERIES_MAX_RETRIES,
                timeout=model_config.get("base_timeout", 120.0),
            )
        else:
            # Create Azure OpenAI client for other models
            api_key = config.AZURE_OPENAI_API_KEY
            if not api_key:
                raise ValueError("AZURE_OPENAI_API_KEY is required")
                
            endpoint = model_config.get("azure_endpoint", config.AZURE_OPENAI_ENDPOINT)
            if not endpoint:
                raise ValueError("azure_endpoint is required (either in model_config or AZURE_OPENAI_ENDPOINT)")
            # Return a properly instantiated AzureOpenAI client
            return AzureOpenAI(
                api_key=api_key,
                api_version=model_config.get("api_version", config.AZURE_OPENAI_API_VERSION),
                azure_endpoint=endpoint,
                timeout=model_config.get("base_timeout", 120.0),
            )

    def get_client(self, model_id: Optional[str] = None):
        """Get a client for the specified model"""
        # Use default model if none specified
        if not model_id:
            model_id = config.AZURE_OPENAI_DEPLOYMENT_NAME

        # Try to get requested model
        client = self._clients.get(model_id)
        if client:
            return client

        # If model doesn't exist but we have its config, create it
        if model_id in self._model_configs:
            try:
                client = self._create_client(model_id, self._model_configs[model_id])
                self._clients[model_id] = client
                return client
            except Exception as e:
                logger.error(f"Failed to create client for {model_id}: {str(e)}")

        # Fall back to default model
        default_model = config.AZURE_OPENAI_DEPLOYMENT_NAME
        if default_model in self._clients and default_model != model_id:
            logger.warning(f"Using {default_model} as fallback for {model_id}")
            return self._clients[default_model]

        # If no default, use any available model
        if self._clients:
            fallback = next(iter(self._clients.keys()))
            logger.warning(f"Using {fallback} as emergency fallback for {model_id}")
            return self._clients[fallback]

        # No clients available - create a default one
        model_config = ModelRegistry.get_model_template(default_model)
        try:
            client = self._create_client(default_model, model_config)
            self._clients[default_model] = client
            self._model_configs[default_model] = model_config
            return client
        except Exception as e:
            logger.error(f"Failed to create emergency fallback client: {str(e)}")
            raise ValueError(
                f"No client available for {model_id} and no fallbacks could be created"
            )

    def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get the configuration for a model"""
        return self._model_configs.get(model_id)

    def get_all_models(self) -> Dict[str, Dict[str, Any]]:
        """Get all model configurations"""
        return self._model_configs.copy()

    async def add_or_update_model(
        self,
        model_id: str,
        model_config: Dict[str, Any],
        db_session: Optional[AsyncSession] = None,
    ):
        """Add or update a model configuration and create its client"""
        # Validate and normalize configuration
        model_config = ModelRegistry.validate_model_config(model_id, model_config)

        # Update our in-memory config
        self._model_configs[model_id] = model_config

        # Create or update client
        try:
            self._clients[model_id] = self._create_client(model_id, model_config)
        except Exception as e:
            logger.error(f"Failed to create client for {model_id}: {str(e)}")
            # Remove from configs if client creation failed
            if model_id in self._clients:
                del self._clients[model_id]

        # Update database if session provided
        if db_session:
            try:
                from services.config_service import ConfigService

                config_service = ConfigService(db_session)
                await config_service.set_config(
                    "model_configs",
                    self._model_configs,
                    "Updated model configurations",
                    is_secret=True,
                )
            except Exception as e:
                logger.error(f"Failed to save model config to database: {str(e)}")

        return model_id in self._clients

    async def delete_model(
        self, model_id: str, db_session: Optional[AsyncSession] = None
    ) -> bool:
        """Delete a model configuration and its client"""
        # Don't delete default model
        if model_id == config.AZURE_OPENAI_DEPLOYMENT_NAME:
            return False

        # Remove from configs and clients
        if model_id in self._model_configs:
            del self._model_configs[model_id]

        if model_id in self._clients:
            del self._clients[model_id]

        # Update database if session provided
        if db_session:
            try:
                from services.config_service import ConfigService

                config_service = ConfigService(db_session)
                await config_service.set_config(
                    "model_configs",
                    self._model_configs,
                    "Updated model configurations",
                    is_secret=True,
                )
                return True
            except Exception as e:
                logger.error(f"Failed to save model config to database: {str(e)}")
                return False

        return True


# Singleton access functions
_client_pool: Optional[ClientPool] = None

async def get_client_pool(db_session: Optional[AsyncSession] = None) -> ClientPool:
    """Get the ClientPool singleton"""
    global _client_pool
    if not _client_pool:
        _client_pool = await ClientPool.get_instance(db_session)
    return _client_pool


async def get_model_client(
    model_name: Optional[str] = None, db_session: Optional[AsyncSession] = None
):
    """Get a client for a specific model"""
    pool = await get_client_pool(db_session)
    return pool.get_client(model_name)


async def init_client_pool(db_session: Optional[AsyncSession] = None):
    """Initialize the client pool at application startup"""
    await get_client_pool(db_session)


async def get_model_client_dependency(
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    FastAPI dependency that returns a model client wrapped in a dict.
    This helps avoid serialization issues with complex client objects.
    
    Args:
        model_name: Optional model name to get client for. If None, uses default.
        
    Returns:
        Dict with "client" key containing the client object and "model_config" with configuration
    """
    # Existing implementation remains the same
    try:
        # Get model type for later use
        model_type = "standard"
        if config.is_deepseek_model(model_name):
            model_type = "deepseek"
        elif config.is_o_series_model(model_name):
            model_type = "o-series"

        # Build model config
        model_config = {
            "model_type": model_type,
            "supports_streaming": True,
            "supports_temperature": not config.is_o_series_model(model_name),
        }

        # Special handling for DeepSeek models
        if config.is_deepseek_model(model_name):
            # Validate required DeepSeek configuration
            if not config.AZURE_INFERENCE_ENDPOINT:
                raise ValueError("AZURE_INFERENCE_ENDPOINT is not configured")
            if not config.AZURE_INFERENCE_CREDENTIAL:
                raise ValueError("AZURE_INFERENCE_CREDENTIAL is missing")

            # Check if endpoint has expected format
            endpoint_base = config.AZURE_INFERENCE_ENDPOINT.rstrip("/")

            # The key issue:
            # The endpoint should NOT include /v1/chat/completions - this is getting added by routers/chat.py
            # Removing this extra path to fix the 500 error
            if "/v1/chat/completions" in endpoint_base:
                endpoint_base = endpoint_base.replace("/chat/completions", "")
                logger.warning(
                    f"Removing /v1/chat/completions from endpoint: {endpoint_base}"
                )

            # Create the ChatCompletionsClient with correct parameters
            client = ChatCompletionsClient(
                endpoint=endpoint_base,
                credential=AzureKeyCredential(config.AZURE_INFERENCE_CREDENTIAL),
                api_version="2024-05-01-preview",
                headers={
                    "x-ms-thinking-format": "html",
                    "x-ms-streaming-version": "2024-05-01-preview",
                },
            )

            return {
                "client": client,
                "model_name": "DeepSeek-R1",  # Using correct casing
                "model_config": model_config,
            }

        # Handle O-series and other models
        client = AzureOpenAI(
            api_key=config.AZURE_OPENAI_API_KEY,
            api_version="2025-02-01-preview",
            azure_endpoint=config.AZURE_OPENAI_ENDPOINT or "",
        )
        return {
            "client": client,
            "model_name": model_name or config.AZURE_OPENAI_DEPLOYMENT_NAME,
            "model_config": model_config,
        }
    except Exception as e:
        logger.error(f"Error in get_model_client_dependency: {str(e)}")
        return {"client": None, "error": str(e)}
    
try:
    from logging_config import logger
except ImportError:
    # Keep using the standard logger if import fails
    pass

