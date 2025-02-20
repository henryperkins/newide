# clients.py
from openai import AzureOpenAI
import config

def get_azure_client() -> AzureOpenAI:
    """
    Factory function to create a new Azure OpenAI client instance per request.
    """
    return AzureOpenAI(
        api_key=str(config.AZURE_OPENAI_API_KEY),
        api_version="2025-01-01-preview",
        azure_endpoint=str(config.AZURE_OPENAI_ENDPOINT),
        default_headers={"api-version": "2025-01-01-preview"},
    )