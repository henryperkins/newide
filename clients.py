# clients.py
from openai import AsyncAzureOpenAI
from azure.identity.aio import ClientSecretCredential
import config
import random
import os
from typing import List

_client_pool: List[AsyncAzureOpenAI] = []
_pool_size = 5

async def init_client_pool():
    """Initialize the Azure OpenAI client pool"""
    if not _client_pool:
        credential = ClientSecretCredential(
            tenant_id=os.getenv("AZURE_TENANT_ID"),
            client_id=os.getenv("AZURE_CLIENT_ID"),
            client_secret=os.getenv("AZURE_CLIENT_SECRET")
        )
        for _ in range(_pool_size):
            client = AsyncAzureOpenAI(
                credential=credential,
                api_version=config.AZURE_OPENAI_API_VERSION,
                azure_endpoint=config.AZURE_OPENAI_ENDPOINT
            )
            _client_pool.append(client)

async def get_azure_client() -> AsyncAzureOpenAI:
    """Get a client from the pool, initializing if needed"""
    if not _client_pool:
        await init_client_pool()
    return random.choice(_client_pool)
