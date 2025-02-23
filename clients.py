import os
import asyncio
from typing import Dict, Optional

# If you use the official OpenAI Python package with Azure support,
#   pip install openai
#   from openai import AzureOpenAI
# Otherwise, adapt to your custom AzureOpenAI client/wrapper.
from openai import AzureOpenAI

from logging_config import logger
import config


class ClientPool:
    """
    Manages a pool of Azure OpenAI clients for different models using an async singleton pattern.
    Each model from config.MODEL_CONFIGS gets one AzureOpenAI client, keyed by model name.
    """
    _instance = None
    _clients: Dict[str, AzureOpenAI] = {}
    _lock = asyncio.Lock()

    @classmethod
    async def get_instance(cls):
        """
        Returns the singleton instance of the ClientPool.
        If it does not exist, it initializes it under an async lock.
        """
        if not cls._instance:
            async with cls._lock:
                if not cls._instance:
                    cls._instance = cls()
                    await cls._instance.initialize_clients()
        return cls._instance

    async def initialize_clients(self):
        """Initialize a client for each model in config.MODEL_CONFIGS."""
        for model_name, model_config in config.MODEL_CONFIGS.items():
            try:
                api_version = model_config.get("api_version", config.AZURE_OPENAI_API_VERSION)
                
                # Decide if this is an "o-series" model or not
                # In your config, you might store a key like model_config["is_o_series"] = True
                # or just do a name check:
                is_o_series = model_name.startswith('o') or model_config.get('supports_temperature') is False
                max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3

                # base_timeout and other properties can come from the model config
                base_timeout = model_config.get('base_timeout', config.STANDARD_BASE_TIMEOUT)

                # Create AzureOpenAI client
                client = AzureOpenAI(
                    api_key=model_config.get('api_key', config.AZURE_OPENAI_API_KEY),
                    api_version=api_version,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                    azure_deployment=model_name,
                    max_retries=max_retries,
                    timeout=base_timeout
                )

                self._clients[model_name] = client
                logger.info(f"[ClientPool] Initialized AzureOpenAI client for model '{model_name}'")
            except Exception as e:
                logger.error(f"[ClientPool] Failed to initialize client for model '{model_name}': {str(e)}")

    def get_client(self, model_name: Optional[str] = None) -> AzureOpenAI:
        """
        Retrieve a client for the specified model.
        If model_name is None or not in _clients, fallback to config.AZURE_OPENAI_DEPLOYMENT_NAME.
        Raises ValueError if no default client is available.
        """
        if not model_name:
            model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME
        
        client = self._clients.get(model_name)
        if not client:
            logger.warning(f"[ClientPool] Client not found for model '{model_name}'. Using default.")
            client = self._clients.get(config.AZURE_OPENAI_DEPLOYMENT_NAME)
            if not client:
                raise ValueError("No default AzureOpenAI client is available.")
        
        return client

    async def refresh_client(self, model_name: str):
        """
        Refresh a specific client's configuration from the latest config.MODEL_CONFIGS.
        Useful if environment variables or config for a model changed at runtime.
        """
        async with self._lock:
            if model_name in config.MODEL_CONFIGS:
                model_config = config.MODEL_CONFIGS[model_name]
                api_version = model_config.get("api_version", config.AZURE_OPENAI_API_VERSION)
                is_o_series = model_name.startswith('o') or (model_config.get('supports_temperature') is False)
                max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
                base_timeout = model_config.get('base_timeout', config.STANDARD_BASE_TIMEOUT)

                self._clients[model_name] = AzureOpenAI(
                    api_key=model_config.get('api_key', config.AZURE_OPENAI_API_KEY),
                    api_version=api_version,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                    azure_deployment=model_name,
                    max_retries=max_retries,
                    timeout=base_timeout
                )
                logger.info(f"[ClientPool] Refreshed client for model: '{model_name}'")
            else:
                logger.warning(f"[ClientPool] No config entry for '{model_name}', cannot refresh client.")


# ------------------------------------------------------
# Global helpers to initialize and retrieve the pool
# ------------------------------------------------------

_client_pool = None

async def init_client_pool():
    """Initialize the global client pool at application startup."""
    global _client_pool
    _client_pool = await ClientPool.get_instance()

async def get_client_pool() -> ClientPool:
    """
    Retrieve the global client pool instance, initializing it if necessary.
    Typically used via dependency injection or in your startup event.
    """
    global _client_pool
    if not _client_pool:
        await init_client_pool()
    return _client_pool

async def get_model_client(model_name: Optional[str] = None) -> AzureOpenAI:
    """
    Convenience function to directly get a client for a given model name.
    """
    pool = await get_client_pool()
    return pool.get_client(model_name)
