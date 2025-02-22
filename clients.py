import os
import asyncio
from typing import Dict, Optional
from openai import AzureOpenAI
from logging_config import logger
import config

class ClientPool:
    """
    Manages a pool of Azure OpenAI clients for different models.
    """
    _instance = None
    _clients: Dict[str, AzureOpenAI] = {}
    _lock = asyncio.Lock()

    @classmethod
    async def get_instance(cls):
        if not cls._instance:
            async with cls._lock:
                if not cls._instance:
                    cls._instance = cls()
                    await cls._instance.initialize_clients()
        return cls._instance

    async def initialize_clients(self):
        """Initialize clients for all configured models."""
        for model_name, model_config in config.MODEL_CONFIGS.items():
            try:
                # Get model-specific API version
                api_version = model_config.get('api_version', config.AZURE_OPENAI_API_VERSION)
                
                # Create client with model-specific configuration
                client = AzureOpenAI(
                    api_key=model_config.get('api_key', config.AZURE_OPENAI_API_KEY),
                    api_version=api_version,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                    azure_deployment=model_name,
                    max_retries=config.O_SERIES_MAX_RETRIES if model_name.startswith('o') else 3,
                    timeout=model_config.get('base_timeout', config.STANDARD_BASE_TIMEOUT)
                )
                
                self._clients[model_name] = client
                logger.info(f"Initialized client for model: {model_name}")
                
            except Exception as e:
                logger.error(f"Failed to initialize client for model {model_name}: {str(e)}")

    def get_client(self, model_name: Optional[str] = None) -> AzureOpenAI:
        """
        Get a client for the specified model.
        Falls back to default model if specified model is not found.
        """
        if not model_name:
            model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

        client = self._clients.get(model_name)
        if not client:
            logger.warning(f"Client not found for model {model_name}, using default model")
            client = self._clients.get(config.AZURE_OPENAI_DEPLOYMENT_NAME)
            if not client:
                raise ValueError("No default client available")

        return client

    async def refresh_client(self, model_name: str):
        """
        Refresh a specific client's configuration.
        Useful when model settings change.
        """
        async with self._lock:
            if model_name in config.MODEL_CONFIGS:
                model_config = config.MODEL_CONFIGS[model_name]
                api_version = model_config.get('api_version', config.AZURE_OPENAI_API_VERSION)
                
                self._clients[model_name] = AzureOpenAI(
                    api_key=model_config.get('api_key', config.AZURE_OPENAI_API_KEY),
                    api_version=api_version,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                    azure_deployment=model_name,
                    max_retries=config.O_SERIES_MAX_RETRIES if model_name.startswith('o') else 3,
                    timeout=model_config.get('base_timeout', config.STANDARD_BASE_TIMEOUT)
                )
                logger.info(f"Refreshed client for model: {model_name}")

# Global async initialization
_client_pool = None

async def init_client_pool():
    """Initialize the global client pool."""
    global _client_pool
    _client_pool = await ClientPool.get_instance()

async def get_client_pool() -> ClientPool:
    """Get the global client pool instance."""
    if not _client_pool:
        await init_client_pool()
    return _client_pool

# Helper function to get a specific client
async def get_model_client(model_name: Optional[str] = None) -> AzureOpenAI:
    """Get a client for a specific model."""
    pool = await get_client_pool()
    return pool.get_client(model_name)
