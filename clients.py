# clients.py
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
                client = AsyncAzureOpenAI(
                    api_key=config.AZURE_OPENAI_API_KEY,
                    api_version=config.AZURE_OPENAI_API_VERSION,
                    azure_endpoint=config.AZURE_OPENAI_ENDPOINT
                )
            
            _client_pool.append(client)

async def get_azure_client() -> AsyncAzureOpenAI:
    """Get an authenticated client from the pool"""
    if not _client_pool:
        await init_client_pool()
    return _client_pool[len(_client_pool) % _pool_size]  # Simple round-robin
