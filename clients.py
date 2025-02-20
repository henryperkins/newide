# clients.py
from openai import AzureOpenAI
import config

def get_azure_client() -> AzureOpenAI:
    """
    Factory function to create a new Azure OpenAI client instance per request.
    """
    return AzureOpenAI(
        api_key=config.AZURE_OPENAI_API_KEY,
        api_version=config.AZURE_OPENAI_API_VERSION,  # Use version from config
        azure_endpoint=config.AZURE_OPENAI_ENDPOINT
    )
