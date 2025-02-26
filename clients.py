# clients.py
import os
import asyncio
from typing import Dict, Optional, Any
from urllib.parse import urlparse
import socket
from database import AsyncSessionLocal

from openai import AzureOpenAI
from logging_config import logger
import config

# Removed direct database import, now handled by ConfigService
# from database import get_db_session  # Now used *only* for config
from services.config_service import ConfigService  # Use for database access.


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
        # Fix race condition by acquiring lock first
        async with cls._lock:
            if not cls._instance:
                cls._instance = cls()
                await cls._instance.initialize_clients(config_service)
        return cls._instance

    async def initialize_clients(self, config_service: ConfigService) -> None:
        """
        Initialize clients based on database configurations
        """
        logger.info("[ClientPool] initialize_clients called.")
        
        # Flag to track if we need a default client
        has_default_client = False
        initialization_errors = []

        try:
            db_model_configs = await config_service.get_model_configs()
            
            # If no configurations found, create defaults
            if not db_model_configs:
                logger.warning("No model configs found. Creating defaults.")
                
                # Create default o1 model
                default_o1 = config.AZURE_OPENAI_DEPLOYMENT_NAME
                logger.info(f"Creating default config for {default_o1}")
                
                o1_config = {
                    "name": default_o1,
                    "max_tokens": 40000,
                    "supports_streaming": False,
                    "supports_temperature": False,
                    "base_timeout": config.O_SERIES_BASE_TIMEOUT,
                    "max_timeout": config.O_SERIES_MAX_TIMEOUT,
                    "token_factor": config.O_SERIES_TOKEN_FACTOR,
                    "api_version": config.AZURE_OPENAI_API_VERSION,
                    "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                    "description": "Default Azure OpenAI o1 model"
                }
                
                # Create DeepSeek-R1 model config
                deepseek_config = {
                    "name": "DeepSeek-R1",
                    "max_tokens": 32000,
                    "supports_streaming": True,
                    "supports_temperature": True,
                    "supports_json_response": False,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                    "api_version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
                    "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                    "description": "Model that supports chain-of-thought reasoning with <think> tags"
                }
                
                # Ensure the DeepSeek endpoint is set
                if not deepseek_config["azure_endpoint"]:
                    logger.error("AZURE_INFERENCE_ENDPOINT is not set but required for DeepSeek-R1")
                    raise ValueError("Missing AZURE_INFERENCE_ENDPOINT for DeepSeek-R1 model")
                
                # Add both models to the configuration
                db_model_configs = {
                    default_o1: o1_config,
                    "DeepSeek-R1": deepseek_config
                }
                
                # Save to database
                await config_service.set_config(
                    "model_configs",
                    db_model_configs,
                    "Default model configurations",
                    is_secret=True
                )
                logger.info("Created default model configurations")
            else:
                # Ensure the default models exist
                default_o1 = config.AZURE_OPENAI_DEPLOYMENT_NAME
                
                # Add o1 if missing
                if default_o1 not in db_model_configs:
                    logger.warning(f"Default o1 model {default_o1} missing, adding it")
                    db_model_configs[default_o1] = {
                        "name": default_o1,
                        "max_tokens": 40000,
                        "supports_streaming": False,
                        "supports_temperature": False,
                        "base_timeout": config.O_SERIES_BASE_TIMEOUT,
                        "max_timeout": config.O_SERIES_MAX_TIMEOUT,
                        "token_factor": config.O_SERIES_TOKEN_FACTOR,
                        "api_version": config.AZURE_OPENAI_API_VERSION,
                        "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                        "description": "Default Azure OpenAI o1 model"
                    }
                    
                    # Update database
                    await config_service.set_config(
                        "model_configs",
                        db_model_configs,
                        "Updated with default o1 model",
                        is_secret=True
                    )
                
                # Add DeepSeek-R1 if missing
                if "DeepSeek-R1" not in db_model_configs:
                    logger.warning("DeepSeek-R1 model missing, adding it")
                    db_model_configs["DeepSeek-R1"] = {
                        "name": "DeepSeek-R1",
                        "max_tokens": 32000,
                        "supports_streaming": True,
                        "supports_temperature": True,  # Changed to TRUE - DeepSeek uses temperature parameter
                        "base_timeout": 120.0,
                        "max_timeout": 300.0,
                        "token_factor": 0.05,
                        "api_version": config.AZURE_INFERENCE_API_VERSION,
                        "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                        "description": "Reasoning-focused model with high performance in math, coding, and science"
                    }
                    
                    # Update database
                    await config_service.set_config(
                        "model_configs",
                        db_model_configs,
                        "Updated with DeepSeek-R1 model",
                        is_secret=True
                    )

            logger.info(f"Found model_configs keys: {list(db_model_configs.keys())}")
            logger.debug("Full model_configs content: %s", db_model_configs)

            # Initialize clients from configs
            for model_name, model_config in db_model_configs.items():
                try:
                    # Ensure azure_endpoint is set
                    if not model_config.get("azure_endpoint"):
                        if model_name.lower() == "deepseek-r1":
                            model_config["azure_endpoint"] = config.AZURE_INFERENCE_ENDPOINT
                            if not config.AZURE_INFERENCE_ENDPOINT:
                                logger.error(f"AZURE_INFERENCE_ENDPOINT is not set but required for {model_name}")
                                raise ValueError(f"Missing AZURE_INFERENCE_ENDPOINT for {model_name} model")
                            logger.info(f"Using default AZURE_INFERENCE_ENDPOINT for {model_name}")
                        else:
                            model_config["azure_endpoint"] = config.AZURE_OPENAI_ENDPOINT
                            logger.info(f"Using default AZURE_OPENAI_ENDPOINT for {model_name}")
                    
                    # Create client with configuration from database
                    self._clients[model_name] = self._create_client(model_name, model_config)
                    
                    # Mark if we have initialized the default client
                    if model_name == config.AZURE_OPENAI_DEPLOYMENT_NAME:
                        has_default_client = True
                        
                    logger.info(f"Initialized client for model: {model_name}")
                    logger.debug("Client configuration used: %s", model_config)
                except Exception as e:
                    logger.error("Detailed error initializing client:", exc_info=True)
                    error_msg = f"Failed to initialize client for '{model_name}': {str(e)}"
                    initialization_errors.append(error_msg)
                    logger.error(f"[ClientPool] {error_msg}")
            
            # Check if we have at least one client
            if not self._clients:
                error_msg = "Failed to initialize any model clients. Check configuration and Azure OpenAI access."
                logger.error(f"[ClientPool] {error_msg}")
                raise ValueError(error_msg)
                
            # If default client wasn't initialized but we have others, set first available as default
            if not has_default_client and self._clients:
                default_fallback = next(iter(self._clients))
                logger.warning(
                    f"Default client '{config.AZURE_OPENAI_DEPLOYMENT_NAME}' not initialized. "
                    f"Using '{default_fallback}' as default."
                )
                # Log available models for debugging
                logger.info(f"Available models: {list(self._clients.keys())}")
                
            # Log any errors that occurred during initialization    
            if initialization_errors:
                logger.warning(
                    f"Completed initialization with {len(initialization_errors)} errors: "
                    f"{'; '.join(initialization_errors)}"
                )
                
        except Exception as e:
            logger.error(f"An error occurred during initialization: {str(e)}")
            # Only re-raise if we couldn't initialize any clients
            if not self._clients:
                raise
                
    def _create_client(self, model_name: str, model_config: Dict[str, Any]) -> AzureOpenAI:
        """Create an Azure OpenAI client with the given configuration"""
        is_o_series = model_name.startswith("o") or not model_config.get("supports_temperature", True)
        is_deepseek = model_name.lower().startswith("deepseek")
        max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
        
        # Select the proper API key and endpoint based on model type
        if is_deepseek:
            api_key = os.getenv("AZURE_INFERENCE_CREDENTIAL", "")
            endpoint = model_config.get("azure_endpoint", config.AZURE_INFERENCE_ENDPOINT)
            if not endpoint:
                logger.error(f"No Azure Inference endpoint configured for {model_name} model")
                raise ValueError(f"Missing Azure Inference endpoint for {model_name} model")
            api_version = model_config.get("api_version", config.DEEPSEEK_R1_DEFAULT_API_VERSION)
            
            # Validate required config for DeepSeek
            if not api_key:
                logger.error(f"Missing AZURE_INFERENCE_CREDENTIAL for {model_name} model")
                raise ValueError(f"Missing API credential for {model_name} model")
        else:
            api_key = os.getenv("AZURE_OPENAI_API_KEY", "")
            endpoint = model_config.get("azure_endpoint", config.AZURE_OPENAI_ENDPOINT)
            api_version = model_config.get("api_version", config.AZURE_OPENAI_API_VERSION)

        # Validate endpoint is not None
        if not endpoint:
            logger.error(f"No Azure endpoint configured for model '{model_name}'")
            raise ValueError(f"Missing Azure endpoint for model '{model_name}'")

        def ensure_protocol(url: str) -> str:
            """Guarantee endpoint URLs have a protocol prefix"""
            if not url.startswith(("http://", "https://")):
                logger.warning(f"Auto-adding HTTPS protocol to endpoint: {url}")
                return f"https://{url}"
            return url

        endpoint = ensure_protocol(endpoint)
        
        # Debug DNS resolution
        parsed = urlparse(endpoint)
        logger.info(f"Resolving DNS for: {parsed.hostname}")
        try:
            ip = socket.gethostbyname(parsed.hostname)
            logger.info(f"Resolved {parsed.hostname} → {ip}")
        except socket.gaierror as e:
            logger.error(f"DNS resolution failed for {parsed.hostname}: {str(e)}")
            raise
        
        return AzureOpenAI(
            api_key=api_key,
            api_version=api_version,
            azure_endpoint=endpoint,
            azure_deployment=model_name,
            max_retries=max_retries,
            timeout=model_config.get("base_timeout", 60.0)
        )

    def get_client(self, model_name: Optional[str] = None) -> AzureOpenAI:
        """
        Retrieve an already-initialized AzureOpenAI client object from the pool.
        If no model_name is provided, fallback to config.AZURE_OPENAI_DEPLOYMENT_NAME.
        If requested model is not available, try default model, then any available model.
        """
        if not model_name:
            model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

        # Try to get the requested model
        client = self._clients.get(model_name)
        if not client:
            logger.warning(
                f"[ClientPool] Client not found for model '{model_name}'. Attempting fallback to default."
            )
            
            # Try the default model if it's different from the requested model
            if model_name != config.AZURE_OPENAI_DEPLOYMENT_NAME:
                client = self._clients.get(config.AZURE_OPENAI_DEPLOYMENT_NAME)
                if client:
                    logger.info(f"[ClientPool] Successfully using default model '{config.AZURE_OPENAI_DEPLOYMENT_NAME}' as fallback.")
                    return client
            
            # If default model is not available or is the same as requested model, use any available client
            if self._clients:
                available_models = list(self._clients.keys())
                fallback_model = available_models[0]
                logger.warning(
                    f"[ClientPool] Default client '{config.AZURE_OPENAI_DEPLOYMENT_NAME}' not available. "
                    f"Using '{fallback_model}' as fallback."
                )
                client = self._clients[fallback_model]
                return client
            
            # If still no client, raise error
            available = list(self._clients.keys())
            raise ValueError(
                f"No AzureOpenAI client available for '{model_name}' "
                f"or fallback '{config.AZURE_OPENAI_DEPLOYMENT_NAME}'.\n"
                f"Initialized clients: {available}\n"
                f"Verify that 'model_configs' in the DB includes an entry for '{model_name}' or the default."
            )
        return client

    async def refresh_client(self, model_name: str, config_service: ConfigService) -> None:
        """Refresh a specific client with latest configuration"""
        async with self._lock:
            try:
                model_config = await config_service.get_model_config(model_name)
                if not model_config:
                    logger.warning(f"No configuration found for {model_name}")
                    return
                    
                # Update or create client
                self._clients[model_name] = self._create_client(model_name, model_config)
                logger.info(f"Refreshed client for model: {model_name}")
            except Exception as e:
                logger.error(f"Failed to refresh client for {model_name}: {str(e)}")


# ------------------------------------------------------
# Global helpers to initialize and retrieve the pool
# ------------------------------------------------------

_client_pool = None


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
