# utils.py
import tiktoken
import os
from typing import Optional
import config
from logging_config import logger

def resolve_api_version(deployment_name: str) -> str:
    version_matrix = {
        "o1-prod": "2024-12-01",
        "o3-mini": "2025-01-01-preview", 
        "gpt-4": "2023-12-01"
    }
    return version_matrix.get(deployment_name.lower(), 
                            os.getenv("DEFAULT_API_VERSION", "2024-12-01-preview"))

def count_tokens(text: str, model: Optional[str] = None) -> int:
    """
    Model-specific token counting with fallback
    """
    try:
        if model and any(m in model.lower() for m in ["o1-", "o3-"]):
            encoding = tiktoken.get_encoding("cl100k_base")
        else:
            encoding = tiktoken.get_encoding("cl100k_base")
            
        return len(encoding.encode(text))
    except Exception as e:
        logger.warning(f"Token counting error: {str(e)}")
        return len(text) // 4  # Conservative fallback

def calculate_model_timeout(messages, model_name, reasoning_effort="medium"):
    is_o_series = (
        any(m in model_name.lower() for m in ["o1-", "o3-"]) and "preview" not in model_name.lower()
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
