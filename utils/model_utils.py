"""
Centralized utility functions for model-related operations.
This module prevents code duplication by providing shared functions for:
- Model type detection
- URL building
- Parameter validation
"""

import os
from typing import Dict, Any, Union, Optional
from azure.core.credentials import AzureKeyCredential
from logging_config import logger

# API versions based on documentation
API_VERSIONS = {
    "o1": "2025-01-01-preview",
    "o3-mini": "2025-01-01-preview", 
    "o1-preview": "2025-01-01-preview",
    "o1-mini": "2025-01-01-preview",
    "DeepSeek-R1": "2024-05-01-preview",
    "default": "2025-01-01-preview"
}

def is_deepseek_model(model_name: str) -> bool:
    """
    Check if a model is a DeepSeek model based on its name.
    
    Args:
        model_name: The name of the model to check
        
    Returns:
        bool: True if the model is a DeepSeek model, False otherwise
    """
    if not model_name:
        return False
    model_lower = model_name.lower()
    return "deepseek" in model_lower or model_lower == "deepseek-r1"

def is_o_series_model(model_name: str) -> bool:
    """
    Check if a model is an o-series model (o1, o3-mini, etc.).
    
    Args:
        model_name: The name of the model to check
        
    Returns:
        bool: True if the model is an o-series model, False otherwise
    """
    if not model_name:
        return False
    model_lower = model_name.lower()
    return model_lower.startswith("o1") or model_lower.startswith("o3")

def get_model_endpoint(model_name: str) -> str:
    """
    Get the appropriate endpoint for a model.
    
    Args:
        model_name: The name of the model
        
    Returns:
        str: The endpoint URL
    """
    if is_deepseek_model(model_name):
        return os.getenv("AZURE_INFERENCE_ENDPOINT", "")
    else:
        return os.getenv("AZURE_OPENAI_ENDPOINT", "")

def get_model_api_version(model_name: str) -> str:
    """
    Get the appropriate API version for a model.
    
    Args:
        model_name: The name of the model
        
    Returns:
        str: The API version
    """
    if not model_name:
        return API_VERSIONS["default"]
        
    # Check direct match first
    if model_name in API_VERSIONS:
        return API_VERSIONS[model_name]
        
    # Check by model type
    if is_deepseek_model(model_name):
        return API_VERSIONS["DeepSeek-R1"]
    elif is_o_series_model(model_name):
        return API_VERSIONS["o1"]
    else:
        return API_VERSIONS["default"]

def get_azure_credential(model_name: str) -> Union[str, AzureKeyCredential]:
    """
    Get the appropriate credential for a model.
    For DeepSeek models, returns AzureKeyCredential.
    For OpenAI models, returns the API key string.
    
    Args:
        model_name: The name of the model
        
    Returns:
        Union[str, AzureKeyCredential]: The credential
    """
    if is_deepseek_model(model_name):
        credential = os.getenv("AZURE_INFERENCE_CREDENTIAL")
        if not credential:
            logger.warning(f"AZURE_INFERENCE_CREDENTIAL not set for {model_name}")
            return AzureKeyCredential("")
        return AzureKeyCredential(credential)
    else:
        return os.getenv("AZURE_OPENAI_API_KEY", "")

def build_azure_openai_url(deployment_name: str = None, api_version: str = None) -> str:
    """
    Build the Azure OpenAI API URL with support for different model types.
    
    Args:
        deployment_name: The deployment name (model name)
        api_version: The API version to use
        
    Returns:
        str: The full API URL
    """
    # Determine which endpoint to use based on the model
    if is_deepseek_model(deployment_name):
        endpoint = os.getenv("AZURE_INFERENCE_ENDPOINT")
        if not endpoint:
            raise ValueError("AZURE_INFERENCE_ENDPOINT environment variable is not set")
    else:
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is not set")

    # Use default API version if none provided, selecting the appropriate version for the model
    if not api_version:
        api_version = get_model_api_version(deployment_name)

    # Use default deployment if none provided
    if not deployment_name:
        deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "o1hp")

    # Ensure endpoint has protocol
    if not endpoint.startswith(("http://", "https://")):
        endpoint = f"https://{endpoint}"

    base_url = endpoint.rstrip("/")
    api_url = f"{base_url}/openai/deployments/{deployment_name}/chat/completions"

    # Add API version as query parameter
    final_url = f"{api_url}?api-version={api_version}"

    return final_url

def get_model_parameters(model_name: str, messages: list, **kwargs) -> Dict[str, Any]:
    """
    Get the appropriate parameters for a model based on its type.
    
    Args:
        model_name: The name of the model
        messages: The messages to send
        **kwargs: Additional parameters
        
    Returns:
        Dict[str, Any]: The parameters for the model
    """
    params = {
        "messages": messages,
    }
    
    # Add model-specific parameters
    if is_deepseek_model(model_name):
        # DeepSeek models use temperature and max_tokens
        params["temperature"] = kwargs.get("temperature", 0.7)
        params["max_tokens"] = kwargs.get("max_tokens", 32000)
        # DeepSeek doesn't use reasoning_effort
        if "reasoning_effort" in kwargs:
            del kwargs["reasoning_effort"]
    elif is_o_series_model(model_name):
        # o-series models use reasoning_effort and max_completion_tokens
        params["reasoning_effort"] = kwargs.get("reasoning_effort", "medium")
        params["max_completion_tokens"] = kwargs.get("max_completion_tokens", 5000)
        # o-series doesn't use temperature
        if "temperature" in kwargs:
            del kwargs["temperature"]
    else:
        # Standard models
        params["temperature"] = kwargs.get("temperature", 0.7)
        params["max_tokens"] = kwargs.get("max_tokens", 4000)
    
    # Add any remaining parameters
    for key, value in kwargs.items():
        if key not in params:
            params[key] = value
    
    return params