# clients.py
import asyncio
import os
import time
from typing import List, Optional

from openai import AsyncAzureOpenAI
from azure.core.exceptions import HttpResponseError

import config

_client_pool: List[AsyncAzureOpenAI] = []
_pool_size = 5

async def init_client_pool():
    """
    Initialize Azure OpenAI client pool with proper authentication.
    We'll create multiple clients (defined by _pool_size) so we can
    rotate among them for concurrent requests.
    """
    global _client_pool

    if _client_pool:
        return  # Already initialized

    auth_method = os.getenv("AZURE_AUTH_METHOD", "key")

    # If using Microsoft Entra ID, ensure environment variables are set
    if auth_method.lower() == "entra":
        if not os.getenv("AZURE_CLIENT_ID"):
            raise ValueError("Entra ID authentication requires AZURE_CLIENT_ID environment variable")

    # Gather from either environment or config
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or config.AZURE_OPENAI_ENDPOINT
    azure_api_key = os.getenv("AZURE_OPENAI_API_KEY") or config.AZURE_OPENAI_API_KEY
    azure_api_version = os.getenv("AZURE_OPENAI_API_VERSION") or config.AZURE_OPENAI_API_VERSION
    azure_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME") or config.AZURE_OPENAI_DEPLOYMENT_NAME

    if not azure_endpoint:
        raise ValueError("Azure OpenAI endpoint is not defined (AZURE_OPENAI_ENDPOINT).")
    if not azure_api_version:
        raise ValueError("Azure OpenAI API version is not defined (AZURE_OPENAI_API_VERSION).")
    if not azure_deployment:
        raise ValueError("Azure OpenAI deployment name is not defined (AZURE_OPENAI_DEPLOYMENT_NAME).")

    for _ in range(_pool_size):
        if auth_method.lower() == "entra":
            # Managed identity or service principal approach
            from azure.identity.aio import DefaultAzureCredential
            from azure.identity import get_bearer_token_provider

            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, "https://cognitiveservices.azure.com/.default"
            )

            # Construct AsyncAzureOpenAI with a token-based approach
            client = AsyncAzureOpenAI(
                azure_ad_token_provider=token_provider,
                azure_endpoint=azure_endpoint,
                api_version=azure_api_version,
                default_headers={
                    "OData-MaxVersion": "4.0",
                    "OData-Version": "4.0"
                }
            )
        else:
            # API Key approach
            client = AsyncAzureOpenAI(
                azure_endpoint=azure_endpoint,
                api_key=azure_api_key,
                api_version=azure_api_version,
                default_headers={
                    "OData-MaxVersion": "4.0",
                    "OData-Version": "4.0"
                }
            )

        _client_pool.append(client)

class SecureTokenProvider:
    """
    Demonstrates a reusable token provider that caches tokens
    and refreshes them only on an expiring schedule.
    """
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
    """
    Retrieve an authenticated AzureOpenAI client from the pool.
    Rotate through clients with minimal retry logic on token fetch failure.
    """
    if not _client_pool:
        await init_client_pool()

    max_retries = 3
    for attempt in range(max_retries):
        idx = (attempt % _pool_size)
        client = _client_pool[idx]
        try:
            # If using a custom SecureTokenProvider, ensure it's valid by fetching a token
            if hasattr(client, '_token_provider') and isinstance(client._token_provider, SecureTokenProvider):
                await client._token_provider.get_token()
            return client
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(0.5 * (attempt + 1))

    # If we somehow exit the loop, try raising an error
    raise HttpResponseError("Failed to provide a valid AzureOpenAI client from the pool.")