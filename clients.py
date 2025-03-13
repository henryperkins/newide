# clients.py

import logging
from typing import Dict, Optional, Any, Union
from asyncio import Lock  # Changed from threading import Lock

from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncAzureOpenAI  # Use async client
from azure.ai.inference.aio import ChatCompletionsClient  # Use async version if available
from azure.core.credentials import AzureKeyCredential

import config

logger = logging.getLogger(__name__)

# Type alias for client objects (all async now)
AzureAIClient = Union[AsyncAzureOpenAI, ChatCompletionsClient]
ModelConfigDict = Dict[str, Any]

class ModelRegistry:
    """Centralized registry for model configurations and client creation."""

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
            "headers": {
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": config.DEEPSEEK_R1_DEFAULT_API_VERSION
            },
        },
        "o_series": {
            "description": "Advanced reasoning model for complex tasks",
            "max_tokens": 200000,
            "max_completion_tokens": config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
            "supports_temperature": False,
            "supports_streaming": True,
            "supports_vision": True,
            "requires_reasoning_effort": True,
            "reasoning_effort": config.O_SERIES_DEFAULT_REASONING_EFFORT,
            "base_timeout": config.O_SERIES_BASE_TIMEOUT,
            "max_timeout": config.O_SERIES_MAX_TIMEOUT,
            "token_factor": config.O_SERIES_TOKEN_FACTOR,
            "api_version": config.AZURE_OPENAI_API_VERSION,
            "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
            "vision_config": {
                "max_images": config.O_SERIES_VISION_CONFIG["MAX_IMAGES_PER_REQUEST"],
                "detail_levels": config.O_SERIES_VISION_CONFIG["DETAIL_LEVELS"],
                "timeout": config.Settings().O_SERIES_VISION_TIMEOUT
            },
            "headers": {
                "x-ms-vision-enabled": "true",
                "x-ms-vision-api-version": "2024-02-15-preview"
            },
        },
    }

    @classmethod
    def create_default_models(cls) -> Dict[str, Dict[str, Any]]:
        """Create default model configurations."""
        default_models = {}

        # DeepSeek-R1 model
        deepseek_model = cls.MODEL_TEMPLATES["deepseek"].copy()
        deepseek_model["model_type"] = "deepseek"
        deepseek_model["enable_thinking"] = True
        default_models["DeepSeek-R1"] = deepseek_model

        # o1 model (O-series)
        o1_model = cls.MODEL_TEMPLATES["o_series"].copy()
        o1_model["name"] = config.AZURE_OPENAI_DEPLOYMENT_NAME
        default_models[config.AZURE_OPENAI_DEPLOYMENT_NAME] = o1_model

        return default_models

    @classmethod
    def get_model_template(cls, model_name: str) -> Dict[str, Any]:
        """Get an appropriate template for a model based on its name."""
        if config.is_deepseek_model(model_name):
            return cls.MODEL_TEMPLATES["deepseek"].copy()
        elif config.is_o_series_model(model_name):
            template = cls.MODEL_TEMPLATES["o_series"].copy()
            template["name"] = model_name
            return template
        else:
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
        cls,
        model_id: str,
        model_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate and fill in missing fields for a model configuration."""
        template = cls.get_model_template(model_id)

        for key, value in model_config.items():
            template[key] = value

        template["name"] = model_id

        # Type conversions
        for field in ["base_timeout", "max_timeout", "token_factor"]:
            if field in template:
                template[field] = float(template[field])

        if "max_tokens" in template:
            template["max_tokens"] = int(template["max_tokens"])

        # DeepSeek-specific validation
        if config.is_deepseek_model(model_id):
            template["azure_endpoint"] = config.AZURE_INFERENCE_ENDPOINT
            template["api_version"] = config.DEEPSEEK_R1_DEFAULT_API_VERSION
            template["headers"] = {
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": template["api_version"]
            }
            if not config.AZURE_INFERENCE_CREDENTIAL:
                raise ValueError("AZURE_INFERENCE_CREDENTIAL is required for DeepSeek models")

        # O-Series validation
        elif config.is_o_series_model(model_id):
            template["azure_endpoint"] = config.AZURE_OPENAI_ENDPOINT
            template["api_version"] = config.AZURE_OPENAI_API_VERSION
            template.setdefault("reasoning_effort", "medium")

        return template


class ClientPool:
    """Manages a pool of Azure AI clients with proper configuration handling."""

    _instance = None
    _clients: Dict[str, AzureAIClient] = {}
    _model_configs: Dict[str, Dict[str, Any]] = {}
    _lock = Lock()  # asyncio.Lock for async context

    def __init__(self, model_configs: Optional[Dict[str, Dict[str, Any]]] = None):
        self._model_configs = model_configs or {}

    @classmethod
    async def get_instance(cls, db_session: Optional[AsyncSession] = None):
        """Get or create the singleton instance."""
        async with cls._lock:
            if not cls._instance:
                cls._instance = cls()
                if db_session:
                    await cls._instance._initialize_from_db(db_session)
                else:
                    cls._instance._model_configs = ModelRegistry.create_default_models()
        return cls._instance

    async def _initialize_from_db(self, db_session: AsyncSession):
        """Initialize configurations from the database."""
        try:
            from services.config_service import ConfigService

            config_service = ConfigService(db_session)
            db_models = await config_service.get_config("model_configs")

            if not db_models:
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

            for model_id, model_config in self._model_configs.items():
                model_config = ModelRegistry.validate_model_config(model_id, model_config)
                self._model_configs[model_id] = model_config

                try:
                    self._clients[model_id] = self._create_client(model_id, model_config)
                    logger.info(f"Initialized client for model: {model_id}")
                except Exception as e:
                    logger.error(f"Failed to initialize client for {model_id}: {str(e)}")

            if not self._clients:
                default_model = config.AZURE_OPENAI_DEPLOYMENT_NAME
                model_config = ModelRegistry.get_model_template(default_model)
                self._model_configs[default_model] = model_config
                self._clients[default_model] = self._create_client(default_model, model_config)
                logger.info(f"Created fallback client for model: {default_model}")

        except Exception as e:
            logger.error(f"Error initializing ClientPool: {str(e)}")
            self._model_configs = ModelRegistry.create_default_models()

    def _create_client(self, model_id: str, model_config: Dict[str, Any]) -> AzureAIClient:
        """
        Create the appropriate async client based on model type.
        Either ChatCompletionsClient or AsyncAzureOpenAI.
        """
        if config.is_deepseek_model(model_id):
            if config.AZURE_INFERENCE_CREDENTIAL is None:
                raise ValueError("AZURE_INFERENCE_CREDENTIAL is missing from config")
            return ChatCompletionsClient(
                endpoint=model_config["azure_endpoint"],
                credential=AzureKeyCredential(config.AZURE_INFERENCE_CREDENTIAL),
                api_version=model_config["api_version"],
                headers=model_config.get("headers", {})
            )
        elif config.is_o_series_model(model_id):
            return AsyncAzureOpenAI(
                api_key=config.AZURE_OPENAI_API_KEY,
                azure_endpoint=model_config["azure_endpoint"],
                api_version=model_config["api_version"],
                default_headers={
                    "reasoning-effort": model_config.get("reasoning_effort", "medium"),
                    "x-ms-json-response": "true"
                },
                max_retries=config.O_SERIES_MAX_RETRIES,
                timeout=model_config.get("base_timeout", 120.0),
            )
        else:
            return AsyncAzureOpenAI(
                api_key=config.AZURE_OPENAI_API_KEY,
                azure_endpoint=model_config["azure_endpoint"],
                api_version=model_config["api_version"],
                timeout=model_config.get("base_timeout", 120.0),
            )

    def get_client(self, model_id: Optional[str] = None):
        """Get a client for the specified model."""
        model_id = model_id or config.AZURE_OPENAI_DEPLOYMENT_NAME

        if model_id in self._clients:
            return self._clients[model_id]

        if model_id in self._model_configs:
            try:
                client = self._create_client(model_id, self._model_configs[model_id])
                self._clients[model_id] = client
                return client
            except Exception as e:
                logger.error(f"Failed to create client for {model_id}: {str(e)}")

        default_model = config.AZURE_OPENAI_DEPLOYMENT_NAME
        if default_model in self._clients and default_model != model_id:
            logger.warning(f"Using {default_model} as fallback for {model_id}")
            return self._clients[default_model]

        raise ValueError(f"No client available for {model_id} and no fallbacks could be created")

    def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get the configuration for a model."""
        return self._model_configs.get(model_id)

    def get_all_models(self) -> Dict[str, Dict[str, Any]]:
        """Get all model configurations."""
        return dict(self._model_configs)

    async def add_or_update_model(
        self,
        model_id: str,
        model_config: Dict[str, Any],
        db_session: Optional[AsyncSession] = None
    ) -> bool:
        """Add or update a model configuration and (re)create its client."""
        model_config = ModelRegistry.validate_model_config(model_id, model_config)
        self._model_configs[model_id] = model_config

        try:
            self._clients[model_id] = self._create_client(model_id, model_config)
        except Exception as e:
            logger.error(f"Failed to create client for {model_id}: {str(e)}")
            if model_id in self._clients:
                del self._clients[model_id]

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
        self,
        model_id: str,
        db_session: Optional[AsyncSession] = None
    ) -> bool:
        """Delete a model configuration and its client."""
        if model_id == config.AZURE_OPENAI_DEPLOYMENT_NAME:
            return False

        if model_id in self._model_configs:
            del self._model_configs[model_id]
        if model_id in self._clients:
            del self._clients[model_id]

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


# Singleton helper
_client_pool: Optional[ClientPool] = None

async def get_client_pool(db_session: Optional[AsyncSession] = None) -> ClientPool:
    """Get the ClientPool singleton."""
    global _client_pool
    if not _client_pool:
        _client_pool = await ClientPool.get_instance(db_session)
    return _client_pool

async def get_model_client_dependency(
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    """FastAPI dependency for model clients."""
    try:
        pool = await get_client_pool()
        client = pool.get_client(model_name)
        model_config = pool.get_model_config(model_name or config.AZURE_OPENAI_DEPLOYMENT_NAME)

        if not model_config:
            return {"client": None, "error": "No model configuration found."}

        return {
            "client": client,
            "model_name": model_config["name"],
            "model_config": {
                "model_type": "deepseek" if config.is_deepseek_model(model_name) else "o-series",
                "supports_streaming": model_config.get("supports_streaming", False),
                "api_version": model_config["api_version"]
            }
        }
    except Exception as e:
        logger.error(f"Error in get_model_client_dependency: {str(e)}")
        return {"client": None, "error": str(e)}

async def init_client_pool(db_session: Optional[AsyncSession] = None):
    """Initialize the client pool at application startup."""
    await get_client_pool(db_session)


try:
    from logging_config import logger
except ImportError:
    # Keep using the standard logger if import fails
    pass
