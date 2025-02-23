# chat_service.py

import os
import json
import re
from time import perf_counter
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from logging_config import logger
import config
# If you use a custom error response pattern:
#   from errors import create_error_response
# or if you prefer to use FastAPI's HTTPException directly:
#   from fastapi import HTTPException

from models import (
    ChatMessage,  # e.g., a Pydantic or custom class for inbound chat requests
    Conversation  # SQLAlchemy model for conversation logging
)

# If you track usage statistics in a separate service or model, import it:
# from services.model_stats_service import ModelStatsService


# --------------------------------------------------------------------------
# Utility / Helper Classes & Functions
# --------------------------------------------------------------------------

def create_error_response(
    status_code: int,
    code: str,
    message: str,
    error_type: str = "service_error",
    inner_error: str = ""
):
    """
    Example function to create a uniform error response dict.
    If you prefer to raise HTTPException, you can do that instead.
    """
    return {
        "status_code": status_code,
        "detail": {
            "error": {
                "code": code,
                "message": message,
                "type": error_type,
                "inner_error": inner_error
            }
        }
    }


class TokenManager:
    """
    Example token manager for counting tokens and limiting context size.
    You can adapt or remove if your code doesn't need it.
    """
    @staticmethod
    def get_model_limits(model_name: str) -> Dict[str, int]:
        """Get token limits for a specific model from config."""
        model_config = config.MODEL_CONFIGS.get(model_name, {})
        # fallback to e.g. 4096 if not defined
        max_tokens = model_config.get("max_tokens", 4096)
        return {
            "max_tokens": max_tokens,
            # e.g. 80% of total tokens for context
            "max_context_tokens": int(max_tokens * 0.8)
        }

    @staticmethod
    def count_tokens(text_content: str) -> int:
        """
        Naive token count for demonstration.
        Replace with GPT token counting if you need accuracy (e.g. tiktoken).
        """
        return len(text_content.split())

    @staticmethod
    def sum_context_tokens(messages: List[Dict[str, Any]]) -> int:
        """Sum token usage across all messages."""
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += TokenManager.count_tokens(content)
            elif isinstance(content, list):
                # If content is structured in a list, handle accordingly
                for item in content:
                    if isinstance(item, dict):
                        total += TokenManager.count_tokens(item.get("text", ""))
                    elif isinstance(item, str):
                        total += TokenManager.count_tokens(item)
        return total


# --------------------------------------------------------------------------
# Main Chat Logic
# --------------------------------------------------------------------------

async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: "AzureOpenAI",
    model_name: Optional[str] = None
) -> dict:
    """
    Processes a single chat message, calling AzureOpenAI to get a response,
    and stores conversation data in the DB.

    :param chat_message: The inbound message object (includes user text, session_id, etc.)
    :param db_session: SQLAlchemy AsyncSession for DB operations.
    :param azure_client: AzureOpenAI client to interact with (already constructed).
    :param model_name: Optional override of the model name; can also be in chat_message.

    :return: A dict matching ChatCompletionResponse shape (with 'choices', 'usage', etc.).
    """
    start_time = perf_counter()
    session_id = chat_message.session_id

    # Determine final model to use
    model_name = model_name or config.AZURE_OPENAI_DEPLOYMENT_NAME
    if model_name not in config.MODEL_CONFIGS:
        # If you prefer an HTTPException, do so. Otherwise, return an error response.
        err = create_error_response(
            status_code=400,
            code="invalid_model_name",
            message=f"Model '{model_name}' is not defined in config.MODEL_CONFIGS",
            error_type="invalid_request_error"
        )
        raise ValueError(err["detail"])  # or raise HTTPException(**err)

    logger.info(f"[session {session_id}] Processing chat request for model: {model_name}")
    user_content = chat_message.message or ""

    # Build minimal messages array for AzureOpenAI
    messages = []
    # If there's a developer/system config, prepend it:
    if getattr(chat_message, "developer_config", None):
        # Some models treat 'system' vs 'developer' differently:
        role = "system"  # or "developer" if your model expects that
        messages.append({"role": role, "content": chat_message.developer_config})

    # Optionally retrieve conversation history
    existing_history = await fetch_conversation_history(db_session, session_id)
    messages.extend(existing_history)

    # Finally add the new user message
    messages.append({"role": "user", "content": user_content})

    # Check token usage
    token_info = TokenManager.get_model_limits(model_name)
    context_tokens = TokenManager.sum_context_tokens(messages)
    if context_tokens >= token_info["max_context_tokens"]:
        logger.warning(
            f"[session {session_id}] Context tokens ({context_tokens}) "
            f"approaching or exceeding limit ({token_info['max_context_tokens']})"
        )

    # Build AzureOpenAI request parameters
    # You can define "stream" here if you want streaming, or keep it false for standard
    params = {
        "messages": messages,
        "stream": False
    }

    # If the model supports temperature, set temperature from the chat_message
    model_config = config.MODEL_CONFIGS[model_name]
    if model_config.get("supports_temperature", True):
        # fallback to 0.7 if user hasn't provided
        params["temperature"] = chat_message.temperature if chat_message.temperature is not None else 0.7
        # Optionally also set max_tokens, top_p, frequency_penalty, etc. 
        max_completion_tokens = getattr(chat_message, 'max_completion_tokens', 1024)
        params["max_tokens"] = min(max_completion_tokens, model_config["max_tokens"])
    else:
        # If not supporting temperature, maybe it uses "reasoning_effort" param
        reasoning_effort = getattr(chat_message, "reasoning_effort", "medium")
        params["reasoning_effort"] = reasoning_effort
        # Some "DeepSeek" models have a high token limit:
        params["max_tokens"] = model_config.get("max_tokens", 40000)

    # If user wants file context or additional data, you might inject it here.
    # Example: if chat_message.include_files, fetch and inject file data.
    # Omitted for brevity—just an example:
    if getattr(chat_message, "include_files", False):
        # Optionally inject file context or do specialized logic
        pass

    # ----------------------------------------------------------------------
    # Actual call to AzureOpenAI
    # ----------------------------------------------------------------------
    try:
        response = await azure_client.chat.completions.create(**params)
    except Exception as e:
        # If you have a standard error response:
        logger.exception(f"[session {session_id}] AzureOpenAI call failed: {str(e)}")
        err = create_error_response(
            status_code=503,
            code="service_error",
            message="Error during AzureOpenAI call",
            error_type="api_call_error",
            inner_error=str(e)
        )
        # Possibly raise HTTPException(**err) or return a standard error dict
        raise ValueError(err["detail"])

    # Extract the main content from the response
    if not response.choices or len(response.choices) == 0:
        # This indicates no text was returned
        logger.warning(f"[session {session_id}] No choices returned from AzureOpenAI.")
        content = ""
    else:
        content = response.choices[0].message.content

    elapsed = perf_counter() - start_time
    logger.info(f"[session {session_id}] Chat completion finished in {elapsed:.2f}s")

    # Save conversation to DB
    await save_conversation(db_session, session_id, model_name, user_content, content)

    # Prepare a response in the style of ChatCompletionResponse
    # Typically includes an 'id', 'object', 'created', 'model', 'choices', 'usage', etc.
    usage_info = getattr(response, "usage", None) or {}
    resp_data = {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": usage_info.get("prompt_tokens", 0),
            "completion_tokens": usage_info.get("completion_tokens", 0),
            "total_tokens": usage_info.get("total_tokens", 0)
        }
    }

    return resp_data


# --------------------------------------------------------------------------
# Auxiliary DB Logic
# --------------------------------------------------------------------------

async def fetch_conversation_history(db_session: AsyncSession, session_id: str) -> List[Dict[str, Any]]:
    """
    Example: retrieve prior conversation messages from the DB.
    Return them in a format suitable for the LLM: e.g., [{"role": ..., "content": ...}, ...].
    """
    # If you store the conversation in a "conversations" table:
    result = await db_session.execute(
        text("""
            SELECT role, content
            FROM conversations
            WHERE session_id = :session_id
            ORDER BY timestamp ASC
        """),
        {"session_id": session_id}
    )
    rows = result.mappings().all()
    history = []
    for row in rows:
        history.append({
            "role": row.role,
            "content": row.content
        })
    return history


async def save_conversation(
    db_session: AsyncSession,
    session_id: str,
    model_name: str,
    user_text: str,
    assistant_text: str
):
    """
    Save the user's message and the assistant's message to the DB,
    plus update session info if needed.
    """
    user_msg = Conversation(
        session_id=session_id,
        role="user",
        content=user_text,
        model=model_name
    )
    assistant_msg = Conversation(
        session_id=session_id,
        role="assistant",
        content=assistant_text,
        model=model_name
    )

    db_session.add(user_msg)
    db_session.add(assistant_msg)
    # Update session's last_activity
    await db_session.execute(
        text("""
            UPDATE sessions
            SET last_activity = NOW(),
                last_model = :model_name
            WHERE id = :session_id
        """),
        {
            "session_id": session_id,
            "model_name": model_name
        }
    )
    await db_session.commit()
