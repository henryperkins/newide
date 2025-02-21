# clients.py
import asyncio
import time
from openai import AsyncAzureOpenAI
import config
from typing import List, Optional
import os

_client_pool: List[AsyncAzureOpenAI] = []
_pool_size = 5

async def init_client_pool():
    """Initialize Azure OpenAI client pool with proper authentication"""
    global _client_pool
    
    if not _client_pool:
        auth_method = os.getenv("AZURE_AUTH_METHOD", "key")
        
        for _ in range(_pool_size):
            if auth_method == "entra":
                from azure.identity.aio import DefaultAzureCredential
                from azure.identity import get_bearer_token_provider
                
                credential = DefaultAzureCredential()
                token_provider = get_bearer_token_provider(
                    credential, "https://cognitiveservices.azure.com/.default"
                )
                
                client = AsyncAzureOpenAI(
                    azure_ad_token_provider=token_provider,
                    api_version=config.AZURE_OPENAI_API_VERSION,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT
                )
            else:  # Use API key
                # Determine API version based on model
                api_version = config.MODEL_API_VERSIONS["default"]
                if model_name := os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME"):
                    model_family = next(
                        (key for key in ["o3-mini", "o1", "o1-preview"] 
                         if model_name.lower().startswith(key)),
                        None
                    )
                    api_version = config.MODEL_API_VERSIONS.get(model_family, api_version)

                client = AsyncAzureOpenAI(
                    api_key=config.AZURE_OPENAI_API_KEY,
                    api_version=api_version,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
                    default_headers={
                        "OData-MaxVersion": "4.0",
                        "OData-Version": "4.0"
                    }
                )
            
            _client_pool.append(client)

class SecureTokenProvider:
    def __init__(self, credential):
        self._credential = credential
        self._token_cache = None
        self._refresh_lock = asyncio.Lock()
    
    async def get_token(self):
        async with self._refresh_lock:
            if not self._token_cache or self._token_cache.expires_on < time.time():
                self._token_cache = await self._credential.get_token(
                    "https://cognitiveservices.azure.com/.default"
                )
        return self._token_cache.token

async def get_azure_client() -> AsyncAzureOpenAI:
    """Get an authenticated client from the pool"""
    if not _client_pool:
        await init_client_pool()
    
    client = _client_pool[len(_client_pool) % _pool_size]
    
    # Refresh token if needed
    if hasattr(client, '_token_provider') and isinstance(client._token_provider, SecureTokenProvider):
        await client._token_provider.get_token()
        
    return client
