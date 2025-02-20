# utils.py
import tiktoken
from typing import Optional
import config
from logging_config import logger

def count_tokens(text: str, model: Optional[str] = None) -> int:
    """
    Fast token estimation with fallback to tiktoken for high-precision needs
    """
    try:
        # Fast path: Use byte-based estimation for most cases
        if not model or len(text) < 10000:
            # Empirically derived formula: bytes/3 + adjustment for special chars
            return (len(text.encode("utf-8")) // 3) + (len(text) // 4 // 1000) * 250
        
        # Slow path: Use tiktoken for large texts or specific model requirements
        if any(m in str(model).lower() for m in ["o1-", "o3-"]):
            encoding = tiktoken.get_encoding("cl100k_base")
        else:
            try:
                encoding = tiktoken.encoding_for_model(model if model else "gpt-4")
            except KeyError:
                encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except Exception as e:
        logger.warning(f"Token counting error for model {model}: {str(e)}")
        return len(text) // 3

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
