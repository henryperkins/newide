import os
import asyncio
from typing import Dict, Optional

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
        if not cls._instance:
            async with cls._lock:
                if not cls._instance:
                    cls._instance = cls()
                    await cls._instance.initialize_clients()
        return cls._instance

    async def initialize_clients(self):
        """Initialize a client for each model in config.MODEL_CONFIGS."""
        logger.info(f"[ClientPool debug] init_clients called.")
        logger.info(f"[ClientPool debug] AZURE_OPENAI_DEPLOYMENT_NAME: {config.AZURE_OPENAI_DEPLOYMENT_NAME}")
        logger.info(f"[ClientPool debug] MODEL_CONFIGS keys: {list(config.MODEL_CONFIGS.keys())}")

        forced_key = config.settings.AZURE_OPENAI_DEPLOYMENT_NAME
        if forced_key not in config.MODEL_CONFIGS:
            logger.warning(f"[ClientPool debug] Forcing creation of '{forced_key}' in MODEL_CONFIGS since it's missing.")
            config.MODEL_CONFIGS[forced_key] = {
                "max_tokens": 40000,
                "supports_streaming": False,
                "supports_temperature": False,
                "base_timeout": config.O_SERIES_BASE_TIMEOUT,
                "max_timeout": config.O_SERIES_MAX_TIMEOUT,
                "token_factor": config.O_SERIES_TOKEN_FACTOR,
                "api_version": config.AZURE_OPENAI_API_VERSION,
                "api_key": config.AZURE_OPENAI_API_KEY,
                "azure_endpoint": config.AZURE_OPENAI_ENDPOINT  # Added endpoint to config
            }
            logger.info(f"[ClientPool debug] Forced model config for {forced_key} with endpoint {config.AZURE_OPENAI_ENDPOINT}")

        for model_name, model_config in config.MODEL_CONFIGS.items():
            logger.info(f"[ClientPool debug] Attempting to initialize client for '{model_name}' with config: {model_config}")
            try:
                api_version = model_config.get("api_version", config.AZURE_OPENAI_API_VERSION)
                is_o_series = model_name.startswith('o') or model_config.get('supports_temperature') is False
                max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
                base_timeout = model_config.get('base_timeout', config.STANDARD_BASE_TIMEOUT)

                # Added debug logging of client parameters
                logger.debug(f"[ClientPool] Creating client for {model_name} with "
                            f"endpoint: {config.AZURE_OPENAI_ENDPOINT}, "
                            f"deployment: {model_name}, "
                            f"api_version: {api_version}")

                client = AzureOpenAI(
                    api_key=model_config.get('api_key', config.AZURE_OPENAI_API_KEY),
                    api_version=api_version,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                    azure_deployment=model_name,
                    max_retries=max_retries,
                    timeout=base_timeout
                )
                # Test client connectivity
                # Skipping client.models.list() test because Azure OpenAI doesn’t support listing
                logger.info(f"[ClientPool] Skipped model listing test for '{model_name}'")

                self._clients[model_name] = client
                logger.info(f"[ClientPool] Initialized AzureOpenAI client for model '{model_name}'")
            except Exception as e:
                logger.error(f"[ClientPool] Failed to initialize client for model '{model_name}': {str(e)}")
                raise  # Re-raise exception to prevent silent failures

    def get_client(self, model_name: Optional[str] = None) -> AzureOpenAI:
        if not model_name:
            model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

        client = self._clients.get(model_name)
        if not client:
            logger.warning(f"[ClientPool] Client not found for model '{model_name}'. Using default.")
            client = self._clients.get(config.AZURE_OPENAI_DEPLOYMENT_NAME)
            if not client:
                available = list(self._clients.keys())
                raise ValueError(
                    f"No default AzureOpenAI client available for '{model_name}' or fallback '{config.AZURE_OPENAI_DEPLOYMENT_NAME}'\n"
                    f"Initialized clients: {available}\n"
                    f"Verify:\n"
                    f"1. MODEL_CONFIGS contains '{config.AZURE_OPENAI_DEPLOYMENT_NAME}'\n"
                    f"2. Client initialization succeeded in logs\n"
                    f"3. AZURE_OPENAI_ENDPOINT is correctly configured"
                )

        return client


async def refresh_client(self, model_name: str):
    """
    Refresh a specific client's configuration from the latest config.MODEL_CONFIGS.
    Useful if environment variables or config for a model changed at runtime.
    """
    async with self._lock:
        if model_name in config.MODEL_CONFIGS:
            model_config = config.MODEL_CONFIGS[model_name]
            api_version = model_config.get(
                "api_version", config.AZURE_OPENAI_API_VERSION
            )
            is_o_series = model_name.startswith("o") or (
                model_config.get("supports_temperature") is False
            )
            max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
            base_timeout = model_config.get(
                "base_timeout", config.STANDARD_BASE_TIMEOUT
            )

            self._clients[model_name] = AzureOpenAI(
                api_key=model_config.get("api_key", config.AZURE_OPENAI_API_KEY),
                api_version=api_version,
                azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                azure_deployment=model_name,
                max_retries=max_retries,
                timeout=base_timeout,
            )
            logger.info(f"[ClientPool] Refreshed client for model: '{model_name}'")
        else:
            logger.warning(
                f"[ClientPool] No config entry for '{model_name}', cannot refresh client."
            )


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
