# utils.py
import tiktoken
from typing import Optional
import config
from logging_config import logger

def count_tokens(text: str, model: Optional[str] = None) -> int:
    """
    Ultra-fast token estimation - byte-based only 
    """
    # Simple byte-length approximation
    return len(text.encode("utf-8")) // 3
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
