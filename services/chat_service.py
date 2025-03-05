import json
import uuid
import time
from time import perf_counter
from typing import Optional, List, Dict, Any
import os
import re

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from azure.ai.inference import ChatCompletionsClient
from azure.core.exceptions import HttpResponseError

from openai import AzureOpenAI, OpenAIError

from logging_config import logger
import config
from config import is_deepseek_model, is_o_series_model
from models import Conversation
from pydantic_models import ChatMessage
from azure.core.credentials import AzureKeyCredential


def create_error_response(
    status_code: int,
    code: str,
    message: str,
    error_type: str = "service_error",
    inner_error: str = "",
) -> Dict[str, Any]:
    """
    Parse and handle errors from different client types consistently.
    """
    return {
        "status_code": status_code,
        "detail": {
            "error": {
                "code": code,
                "message": message,
                "type": error_type,
                "inner_error": inner_error,
            }
        },
    }


class TokenManager:
    """
    Example token manager for counting tokens and limiting context size.
    You can adapt or remove if your code doesn't need it.
    """

    @staticmethod
    async def get_model_limits(model_name: str) -> Dict[str, int]:
        """Get token limits for a specific model from the database or use defaults."""
        from services.config_service import ConfigService
        from database import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as config_db:
                config_service = ConfigService(config_db)
                model_configs = await config_service.get_config("model_configs")
        except Exception as e:
            logger.error(f"Error fetching model_configs: {str(e)}")
            model_configs = {}

        model_configs = model_configs or {}
        max_tokens = model_configs.get(model_name, {}).get("max_tokens", 4096)
        return {
            "max_tokens": max_tokens,
            "max_context_tokens": int(max_tokens * 0.8),
        }

    @staticmethod
    def count_tokens(text_content: str) -> int:
        """Naive token count for demonstration."""
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
                for item in content:
                    if isinstance(item, dict):
                        total += TokenManager.count_tokens(item.get("text", ""))
                    elif isinstance(item, str):
                        total += TokenManager.count_tokens(item)
        return total


def prepare_model_parameters(
    chat_message: ChatMessage, model_name: str, is_deepseek: bool, is_o_series: bool
) -> Dict[str, Any]:
    """
    Prepare parameters for model calls based on model type.
    """
    messages = chat_message.messages or [{"role": "user", "content": chat_message.message}]
    params = {"messages": messages}

    if is_deepseek:
        params["max_tokens"] = chat_message.max_completion_tokens or config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
    elif is_o_series:
        params["max_completion_tokens"] = chat_message.max_completion_tokens or config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
    else:
        params["temperature"] = chat_message.temperature or 0.7
        params["max_completion_tokens"] = chat_message.max_completion_tokens or 1000

    return params


async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    model_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Processes a single chat message, calling the appropriate client to get a response,
    and stores conversation data in the database.
    """
    start_time = perf_counter()
    session_id = chat_message.session_id
    # Use provided model_name or fallback to chat_message.model_name or default deployment
    model_name = model_name or getattr(chat_message, "model_name", None) or config.AZURE_INFERENCE_DEPLOYMENT

    # Fetch model configurations if available
    model_configs = {}
    try:
        from services.config_service import ConfigService
        from clients import get_model_client_dependency
        from database import AsyncSessionLocal

        async def fetch_model_configs() -> Dict[str, Any]:
            async with AsyncSessionLocal() as config_db:
                config_service = ConfigService(config_db)
                return await config_service.get_model_configs() or {}

        model_configs = await fetch_model_configs()
        if model_name not in model_configs:
            logger.warning(f"No configuration found for model {model_name}")
    except Exception as e:
        logger.error(f"Error fetching model_configs: {str(e)}")
        model_configs = {}

    # Identify model type flags
    is_deepseek = is_deepseek_model(model_name)
    is_o_series = is_o_series_model(model_name)

    # Prepare API parameters based on model type
    params = prepare_model_parameters(chat_message, model_name, is_deepseek, is_o_series)

    try:
        from clients import get_model_client_dependency

        # Distinguish between ChatCompletionsClient and AzureOpenAI:
        client_wrapper = get_model_client_dependency(model_name)
        azure_client = client_wrapper.get("client")
        if isinstance(azure_client, ChatCompletionsClient):
            if is_deepseek:
                logger.debug(f"Calling DeepSeek-R1 model with messages and temperature: {params.get('temperature')}")
                response = azure_client.complete(
                    messages=params["messages"],
                    temperature=params.get("temperature"),
                    max_tokens=params.get("max_tokens"),
                )
                content = response.choices[0].message.content if response.choices else ""
                usage_data = {
                    "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                    "completion_tokens": getattr(response.usage, "completion_tokens", 0),
                    "total_tokens": getattr(response.usage, "total_tokens", 0),
                }
                if "<think>" in content and "</think>" in content:
                    thinking_text = content.split("<think>")[1].split("</think>")[0]
                    usage_data["thinking_process"] = thinking_text
                    usage_data["reasoning_tokens"] = len(thinking_text.split())
            else:
                response = azure_client.complete(
                    messages=params["messages"],
                    temperature=params.get("temperature", 0.7),
                    max_tokens=params.get("max_tokens", 1000),
                )
                content = response.choices[0].message.content if response.choices else ""
                usage_data = {
                    "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                    "completion_tokens": getattr(response.usage, "completion_tokens", 0),
                    "total_tokens": getattr(response.usage, "total_tokens", 0),
                }
        else:
            # Using the openai.AzureOpenAI client
            response = azure_client.chat.completions.create(
                model=model_name,
                messages=params["messages"],  # type: ignore
                temperature=params.get("temperature", 0.7),  # type: ignore
                max_completion_tokens=params.get("max_completion_tokens", 1000),  # type: ignore
                reasoning_effort=params.get("reasoning_effort", "medium"),  # type: ignore
            )
            content = response.choices[0].message.content if response.choices else ""
            usage_raw = getattr(response, "usage", None)
            usage_data = {
                "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
                "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
                "total_tokens": getattr(usage_raw, "total_tokens", 0),
            }
            if usage_raw and hasattr(usage_raw, "completion_tokens_details") and usage_raw.completion_tokens_details:
                usage_data["reasoning_tokens"] = getattr(usage_raw.completion_tokens_details, "reasoning_tokens", 0)
            if is_deepseek and "<think>" in content and "</think>" in content:
                thinking_text = content.split("<think>")[1].split("</think>")[0]
                usage_data["thinking_process"] = thinking_text
                if "reasoning_tokens" not in usage_data:
                    usage_data["reasoning_tokens"] = len(thinking_text.split())
    except HttpResponseError as e:
        status_code = e.status_code if hasattr(e, "status_code") else 500
        err_code = getattr(e.error, "code", "Unknown") if getattr(e, "error", None) else "Unknown"
        err_message = getattr(e, "message", str(e))
        err_reason = getattr(e, "reason", "Unknown")
        logger.error(f"[Azure AI Error] Session: {session_id} | Model: {model_name} | Status: {status_code} | Code: {err_code} | Message: {err_message} | Reason: {err_reason}")
        return create_error_response(
            status_code=status_code,
            code=str(err_code),
            message="Azure AI service error",
            error_type="azure_error",
            inner_error=err_message,
        )
    except OpenAIError as e:
        logger.exception(f"[Session {session_id}] AzureOpenAI call failed: {str(e)}")
        error_code = getattr(e, "code", "api_error")
        error_message = str(e)
        err = create_error_response(
            status_code=503,
            code=error_code,
            message="Error during AzureOpenAI call",
            error_type="api_call_error",
            inner_error=error_message,
        )
        logger.critical(f"Handled AzureOpenAI error gracefully. {err['detail']}")
        return err
    except Exception as e:
        logger.exception(f"[Session {session_id}] Unexpected error occurred: {str(e)}")
        err = create_error_response(
            status_code=500,
            code="internal_server_error",
            message="An unexpected error occurred during processing.",
            error_type="unknown_error",
            inner_error=str(e),
        )
        logger.critical(f"Handled unexpected error gracefully. {err['detail']}")
        return err

    full_content = content
    formatted_content = full_content

    # No server-side transform for DeepSeek; rely on client
    if is_deepseek and full_content:
        pass
    formatted_content = full_content

    # Store the conversation in the database
    await save_conversation(
        db_session=db_session,
        session_id=session_id,
        model_name=model_name,
        user_text=chat_message.message,
        assistant_text=full_content,
        formatted_assistant_text=formatted_content,
        raw_response=response,
    )

    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": full_content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage_data,
    }


async def fetch_conversation_history(
    db_session: AsyncSession, session_id: str
) -> List[Dict[str, Any]]:
    """
    Retrieve prior conversation messages from the database,
    returning them in a format suitable for the LLM.
    """
    result = await db_session.execute(
        text(
            """
            SELECT role, content
            FROM conversations
            WHERE session_id = :session_id
            ORDER BY id ASC
            """
        ),
        {"session_id": session_id},
    )
    rows = result.mappings().all()
    return [{"role": row.role, "content": row.content} for row in rows]


async def save_conversation(
    db_session: AsyncSession,
    session_id: str,
    model_name: str,
    user_text: str,
    assistant_text: str,
    formatted_assistant_text: str,
    raw_response: Any,
) -> None:
    """
    Save user and assistant messages to the database.
    """
    try:
        # Bulk insert both messages atomically
        messages_to_insert = [
            {
                "session_id": session_id,
                "role": "user",
                "content": user_text,
                "model": model_name,
                "formatted_content": user_text,
                "raw_response": None  # Don't store full API responses
            },
            {
                "session_id": session_id,
                "role": "assistant",
                "content": assistant_text,
                "model": model_name,
                "formatted_content": formatted_assistant_text,
                "raw_response": {"trimmed": True}  # Store metadata only
            }
        ]
    
        # Use SQLAlchemy bulk insert with return_defaults=False for better performance
        await db_session.execute(
            insert(Conversation),
            messages_to_insert
        )
        await db_session.commit()
    except Exception as e:
        logger.error(f"Failed to save conversation to the database: {str(e)}")
        await db_session.rollback()
        raise


async def summarize_messages(messages: List[Dict[str, Any]]) -> str:
    """
    Summarize older messages into a single system message.
    """
    if not messages:
        return ""

    combined_text = "\n".join(f"{m['role'].capitalize()}: {m['content']}" for m in messages)
    try:
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or "https://o1models.openai.azure.com"
        api_version = os.getenv("AZURE_OPENAI_API_VERSION") or "2025-02-01-preview"

        client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_endpoint=endpoint,
            api_version=api_version,
        )

        response = client.chat.completions.create(  # type: ignore
            model=config.AZURE_OPENAI_DEPLOYMENT_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that summarizes conversations."},
                {"role": "user", "content": f"Summarize the following chat:\n\n{combined_text}\n\nBrief Summary:"},
            ],
            max_completion_tokens=150,
        )
        summary_text = ""
        if response.choices and response.choices[0].message and response.choices[0].message.content:
            summary_text = response.choices[0].message.content.strip()
        return summary_text
    except Exception as e:
        return f"Summary of older messages: [Error fallback] {str(e)}"
