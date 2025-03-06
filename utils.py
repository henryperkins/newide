# utils.py
import tiktoken
import os
import json
from typing import Optional, List, Dict, Union
import config
from logging_config import logger
from azure.core.exceptions import HttpResponseError


# Add a helper function to handle different client types
def handle_client_error(error: Exception) -> dict:
    """Parse and handle errors from different client types consistently"""
    if isinstance(error, HttpResponseError):
        # Azure AI Inference errors
        status_code = error.status_code
        error_message = str(error)

        # Special handling for rate limit errors
        if status_code == 429:
            return {
                "status_code": 429,
                "message": "Azure AI service is currently rate limited. Please try again in a few moments.",
                "type": "rate_limit_error",
                "retry_after": 5,  # Suggest retry after 5 seconds
            }

        # Try to parse error content if available
        if hasattr(error, "response") and hasattr(error.response, "_content"):
            try:
                content = error.response._content
                if isinstance(content, bytes):
                    content_str = content.decode("utf-8", errors="replace")
                else:
                    content_str = str(content)

                # Only try to parse as JSON if it looks like JSON
                if content_str.strip().startswith("{"):
                    error_content = json.loads(content_str)
                    if "error" in error_content:
                        error_message = error_content["error"].get(
                            "message", error_message
                        )
                else:
                    # For non-JSON responses, extract useful information
                    error_message = f"Azure AI error: {content_str[:200]}..."
            except Exception as e:
                logger.warning(f"Failed to parse error content: {str(e)}")
                # Don't modify error_message if parsing fails

        return {
            "status_code": status_code,
            "message": error_message,
            "type": "azure_inference_error",
        }
    else:
        # Generic error handling
        return {"status_code": 500, "message": str(error), "type": "unknown_error"}


def resolve_api_version(deployment_name: str) -> str:
    """
    Resolve which API version to use based on the deployment_name.
    Falls back to an environment variable DEFAULT_API_VERSION or
    a default '2025-02-01-preview' if not found.
    """
    # First check if it's in our config's MODEL_API_VERSIONS
    if (
        hasattr(config, "MODEL_API_VERSIONS")
        and deployment_name in config.MODEL_API_VERSIONS
    ):
        return config.MODEL_API_VERSIONS[deployment_name]

    # Else use the static version matrix
    version_matrix = {
        "o1-prod": "2025-02-01-preview",
        "o3-mini": "2025-02-01-preview",
        "DeepSeek-R1": "2024-05-01-preview",
        "gpt-4": "2023-12-01",
    }
    return version_matrix.get(
        deployment_name.lower(), os.getenv("DEFAULT_API_VERSION", "2025-02-01-preview")
    )


def validate_streaming(model_id: str) -> bool:
    """
    Determine if the current model supports streaming.
    We parse out a 'base model' from model_id by prefix.
    Updated to disallow streaming for all o1 variants.
    """
    if not model_id:
        return False

    model_id = model_id.lower()
    base_model = None

    # Only o3-mini supports streaming among the o-series.
    if model_id.startswith("o3-mini"):
        base_model = "o3-mini"
    # Disallow streaming for any o1 variants.
    elif model_id.startswith("o3-mini"):
        return True
    elif model_id.startswith("gpt-4"):
        base_model = "gpt-4"
    elif model_id.startswith("gpt-35") or model_id.startswith("gpt-3.5"):
        base_model = "gpt-35-turbo"

    # Registry for models that support streaming.
    STREAMING_MODEL_REGISTRY = {
        "o3-mini": {"supports_streaming": True, "max_streams": 5},
        "gpt-4": {"supports_streaming": True},
        "gpt-35-turbo": {"supports_streaming": True},
    }

    if base_model and base_model in STREAMING_MODEL_REGISTRY:
        return STREAMING_MODEL_REGISTRY[base_model].get("supports_streaming", False)

    return False


def count_tokens(content, model: Optional[str] = None) -> int:
    """
    Count tokens for either text or vision-based content.

    - If 'content' is a list of items (vision or otherwise), delegate to count_vision_tokens.
    - Otherwise, treat 'content' as a string and do tiktoken-based counting.
    """
    # If this is a list, treat as 'vision' content
    if isinstance(content, list):
        return count_vision_tokens(content, model)

    # Otherwise, assume this is plain text
    try:
        if model and any(m in model.lower() for m in ["o1-", "o3-"]):
            encoding = tiktoken.get_encoding("cl100k_base")
        else:
            encoding = tiktoken.get_encoding("cl100k_base")

        return len(encoding.encode(content))
    except Exception as e:
        logger.warning(f"Token counting error: {str(e)}")
        # Fallback: approximate tokens at 1 per 4 characters
        return len(content) // 4


def count_vision_tokens(items: List[Dict], model: Optional[str] = None) -> int:
    """
    Calculate token usage for a list of 'vision items'.
    Each item is a dict with at least {"type": "..."} key.
    """
    token_count = 0

    for item in items:
        if item["type"] == "text":
            # Recurse back to count_tokens for text
            # in case it is a string or nested structure
            token_count += count_tokens(item["text"], model)

        elif item["type"] == "image_url":
            # Base tokens for the presence of an image
            token_count += 85
            # Add detail-based tokens
            detail = item.get("detail", "auto")
            if detail == "high":
                token_count += 170 * 2
            elif detail == "low":
                token_count += 85

    return token_count


def is_o_series_model(name: str) -> bool:
    """Returns True if model name is recognized as O-series (o1, o2, etc)."""
    return name.lower().startswith("o-series") or "o1" in name.lower()


def is_deepseek_model(name: str) -> bool:
    """Returns True if model name is recognized as a DeepSeek model."""
    return name.lower().startswith("deepseek-")


def calculate_model_timeout(messages, model_name, reasoning_effort="medium"):
    """
    Dynamically compute a timeout based on message length
    and which model is used. For O-series, apply special multipliers.
    """
    is_o_series = (
        any(m in model_name.lower() for m in ["o1-", "o3-"])
        and "preview" not in model_name.lower()
    )

    approx_token_count = len(str(messages))

    if is_o_series:
        effort_multiplier = config.REASONING_EFFORT_MULTIPLIERS.get(
            reasoning_effort, config.REASONING_EFFORT_MULTIPLIERS["medium"]
        )
        calculated_timeout = max(
            config.O_SERIES_BASE_TIMEOUT,
            approx_token_count * config.O_SERIES_TOKEN_FACTOR * effort_multiplier,
        )
        return min(config.O_SERIES_MAX_TIMEOUT, calculated_timeout)
    else:
        calculated_timeout = max(
            config.STANDARD_BASE_TIMEOUT,
            approx_token_count * config.STANDARD_TOKEN_FACTOR,
        )
        return min(config.STANDARD_MAX_TIMEOUT, calculated_timeout)
