# clients.py
import os
import asyncio
from typing import Dict, Optional

from openai import AzureOpenAI
from logging_config import logger
import config

# Removed direct database import, now handled by ConfigService
# from database import get_db_session  # Now used *only* for config
from services.config_service import ConfigService  # Use for database access.
from fastapi import Depends  # Import Depends


class ClientPool:
    """
    Manages a pool of Azure OpenAI clients for different models using an async singleton pattern.
    Model configurations are now stored in the database (app_configurations) under the key "model_configs".
    """

    _instance = None
    _clients: Dict[str, AzureOpenAI] = {}
    _lock = asyncio.Lock()

    def __init__(self):
        pass

    @classmethod
    async def get_instance(cls, config_service: ConfigService):
        if not cls._instance:
            async with cls._lock:
                if not cls._instance:
                    cls._instance = cls()
                    await cls._instance.initialize_clients(config_service)
        return cls._instance

    async def initialize_clients(
            self,
            config_service: ConfigService
        ) -> None:
        """
        Fetch model_configs from the database and initialize a client for each model.
        If the default deployment (o1hp) is missing, we create it in memory and persist it to the database.
        """
        logger.info("[ClientPool debug] initialize_clients called.")
        logger.info(
            f"[ClientPool debug] AZURE_OPENAI_DEPLOYMENT_NAME: {config.AZURE_OPENAI_DEPLOYMENT_NAME}"
        )

        # Get the database session for config only.
        # db = await get_db_session() # NO LONGER NEEDED HERE. ConfigService DEPENDS on this.
        try:
            db_model_configs = await config_service.get_config("model_configs")
            if not db_model_configs:
                logger.warning(
                    "[ClientPool debug] No model_configs found in DB. Using empty dict."
                )
                db_model_configs = {}

            forced_key = config.settings.AZURE_OPENAI_DEPLOYMENT_NAME
            if forced_key not in db_model_configs:
                logger.warning(
                    f"[ClientPool debug] Forcing creation of '{forced_key}' in model_configs since it's missing."
                )
                db_model_configs[forced_key] = {
                    "max_tokens": 40000,
                    "supports_streaming": False,
                    "supports_temperature": False,
                    "base_timeout": config.O_SERIES_BASE_TIMEOUT,
                    "max_timeout": config.O_SERIES_MAX_TIMEOUT,
                    "token_factor": config.O_SERIES_TOKEN_FACTOR,
                    "api_version": config.AZURE_OPENAI_API_VERSION,
                    "api_key": os.getenv("AZURE_OPENAI_API_KEY", ""),
                    "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                }
                # Persist updated configs back to DB so that forced model is recognized on subsequent requests
                await config_service.set_config(
                    "model_configs",
                    db_model_configs,
                    "Auto-created forced model config",
                    is_secret=False,
                )
                logger.info(
                    f"[ClientPool debug] Forced model config for {forced_key} with endpoint {config.AZURE_OPENAI_ENDPOINT}"
                )

            logger.info(
                f"[ClientPool debug] Found model_configs keys: {list(db_model_configs.keys())}"
            )

            for model_name, model_config in db_model_configs.items():
                logger.info(
                    f"[ClientPool debug] Attempting to initialize client for '{model_name}' with config: {model_config}"
                )
                try:
                    api_version = model_config.get(
                        "api_version", config.AZURE_OPENAI_API_VERSION
                    )
                    is_o_series = (
                        model_name.startswith("o")
                        or model_config.get("supports_temperature") is False
                    )
                    max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
                    base_timeout = model_config.get(
                        "base_timeout", config.STANDARD_BASE_TIMEOUT
                    )

                    logger.debug(
                        f"[ClientPool] Creating client for {model_name} with "
                        f"endpoint: {model_config.get('azure_endpoint', config.AZURE_OPENAI_ENDPOINT)}, "
                        f"deployment: {model_name}, "
                        f"api_version: {api_version}"
                    )

                    client = AzureOpenAI(
                        api_key=model_config.get(
                            "api_key", os.getenv("AZURE_OPENAI_API_KEY", "")
                        ),
                        api_version=api_version,
                        azure_endpoint=model_config.get(
                            "azure_endpoint", config.AZURE_OPENAI_ENDPOINT
                        ),
                        azure_deployment=model_name,
                        max_retries=max_retries,
                        timeout=base_timeout,
                    )

                    logger.info(
                        f"[ClientPool] Skipped model listing test for '{model_name}'"
                    )
                    self._clients[model_name] = client
                    logger.info(
                        f"[ClientPool] Initialized AzureOpenAI client for model '{model_name}'"
                    )
                except Exception as e:
                    logger.error(
                        f"[ClientPool] Failed to initialize client for '{model_name}': {str(e)}"
                    )
                    raise
        except Exception as e:
            logger.error(
                f"[ClientPool] An error occurred during initialization: {str(e)}"
            )
            # Handle the exception appropriately, possibly re-raising or logging
            raise  # Re-raise is usually the best approach here to signal failure.
        finally:
            # No longer closing session.  The sessions are only consumed during
            # the route handlers.
            # await db.close() # Always close the db session!
            pass

    def get_client(self, model_name: Optional[str] = None) -> AzureOpenAI:
        """
        Retrieve an already-initialized AzureOpenAI client object from the pool.
        If no model_name is provided, fallback to config.AZURE_OPENAI_DEPLOYMENT_NAME.
        """
        if not model_name:
            model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

        client = self._clients.get(model_name)
        if not client:
            logger.warning(
                f"[ClientPool] Client not found for model '{model_name}'. Attempting fallback to default."
            )
            client = self._clients.get(config.AZURE_OPENAI_DEPLOYMENT_NAME)
            if not client:
                available = list(self._clients.keys())
                raise ValueError(
                    f"No default AzureOpenAI client available for '{model_name}' "
                    f"or fallback '{config.AZURE_OPENAI_DEPLOYMENT_NAME}'.\n"
                    f"Initialized clients: {available}\n"
                    f"Verify that 'model_configs' in the DB includes an entry for '{model_name}' or the default."
                )
        return client

    async def refresh_client(
            self,
            model_name: str,
            config_service: ConfigService
        ) -> None:
        """
        Refresh a specific client's configuration from the latest 'model_configs' in the database.
        Useful if environment variables or config for a model changed at runtime.
        """
        async with self._lock:
            # The database session is *now* handled by the config service dependency.
            # db = await get_db_session() # NO NEED TO GET DB SESSION HERE
            # config_service = ConfigService(db=db) # Not needed
            try:
                db_model_configs = (
                    await config_service.get_config("model_configs") or {}
                )

                if model_name in db_model_configs:
                    model_config = db_model_configs[model_name]
                    api_version = model_config.get(
                        "api_version", config.AZURE_OPENAI_API_VERSION
                    )
                    is_o_series = model_name.startswith("o") or (
                        not model_config.get("supports_temperature", True)
                    )
                    max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
                    base_timeout = model_config.get(
                        "base_timeout", config.STANDARD_BASE_TIMEOUT
                    )

                    self._clients[model_name] = AzureOpenAI(
                        api_key=model_config.get(
                            "api_key", os.getenv("AZURE_OPENAI_API_KEY", "")
                        ),
                        api_version=api_version,
                        azure_endpoint=model_config.get(
                            "azure_endpoint", config.AZURE_OPENAI_ENDPOINT
                        ),
                        azure_deployment=model_name,
                        max_retries=max_retries,
                        timeout=base_timeout,
                    )
                    logger.info(
                        f"[ClientPool] Refreshed client for model: '{model_name}'"
                    )
                else:
                    logger.warning(
                        f"[ClientPool] No database config entry for '{model_name}', cannot refresh client."
                    )
            except Exception as e:
                logger.error(f"[ClientPool] An error occurred during refresh: {str(e)}")
                # Handle the exception appropriately, possibly re-raising or logging
                raise
            finally:
                # Removed the db session close, since this code doesn't depend on it.
                # await db.close()  # No longer closing session.
                pass


# ------------------------------------------------------
# Global helpers to initialize and retrieve the pool
# ------------------------------------------------------

_client_pool = None


from database import AsyncSessionLocal

async def init_client_pool():
    """Initialize the global client pool at application startup."""
    global _client_pool
    async with AsyncSessionLocal() as session:
        cs = ConfigService(session)
        _client_pool = await ClientPool.get_instance(cs)

async def get_client_pool() -> ClientPool:
    """
    Retrieve the global client pool instance, initializing it if necessary.
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
