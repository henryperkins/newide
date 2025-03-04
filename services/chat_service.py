import json
import uuid
import time
from time import perf_counter
from typing import Optional, List, Dict, Any, Union
import os

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
):
    """Parse and handle errors from different client types consistently."""
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
        """Get token limits for a specific model from database or use default."""
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


def prepare_model_parameters(chat_message, model_name, is_deepseek, is_o_series):
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
    """
    Processes a single chat message, calling the appropriate client to get a response,
    and stores conversation data in the DB.
    """
    start_time = perf_counter()
    session_id = chat_message.session_id

    model_name = model_name or config.AZURE_INFERENCE_DEPLOYMENT  # Use the correct deployment name

    # Grab model_configs if available
    try:
        from services.config_service import ConfigService
        from database import AsyncSessionLocal

        async with AsyncSessionLocal() as config_db:
            config_service = ConfigService(config_db)
            model_configs = await config_service.get_model_configs()
        model_configs = model_configs or {}
        if model_name not in model_configs:
            logger.warning(f"No configuration found for model {model_name}")
    except Exception as e:
        logger.error(f"Error fetching model_configs: {str(e)}")
        model_configs = {}

    # Identify if this is a DeepSeek model
    is_deepseek = is_deepseek_model(model_name)

    # Construct "messages" from ChatMessage if none provided
    if hasattr(chat_message, "messages") and chat_message.messages:
        messages = chat_message.messages
    else:
        messages = [{"role": "user", "content": chat_message.message}]

    # Model-specific parameter handling
    params: Dict[str, Any] = {"messages": messages}
    temperature = chat_message.temperature
    max_tokens = chat_message.max_completion_tokens

    if is_deepseek:
        # DeepSeek-specific parameters
        if temperature is not None:
            raise ValueError("Temperature not supported for DeepSeek models")
        params["max_tokens"] = max_tokens if max_tokens is not None else config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
    elif is_o_series_model(model_name):
        # O-series parameters
        if temperature is not None:
            raise ValueError("Temperature not supported for O-series models")
        params["max_completion_tokens"] = max_tokens if max_tokens is not None else config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
        # No need to add reasoning_effort to params - handled by client headers
    else:
        # Standard models
        params["temperature"] = temperature if temperature is not None else 0.7
        params["max_completion_tokens"] = max_tokens if max_tokens is not None else 1000

    try:
        # Distinguish between ChatCompletionsClient and AzureOpenAI:
        if isinstance(azure_client, ChatCompletionsClient):
            #
            #  1) The azure.ai.inference ChatCompletionsClient
            #     Usually used for DeepSeek if your environment requires it.
            #
            if is_deepseek:
                # For DeepSeek, we need to use the appropriate API pattern
                # The ChatCompletionsClient has already been initialized with the model name
                # We just need to pass messages and other parameters
                logger.debug(f"Calling DeepSeek-R1 model with messages and temperature: {params['temperature']}")
                response = azure_client.complete(
                    messages=params["messages"],
                    temperature=params["temperature"],
                    max_tokens=params["max_tokens"]
                )
                # Extract content
                if not response.choices:
                    content = ""
                else:
                    content = response.choices[0].message.content or ""

                # Usage
                usage_data = {
                    "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                    "completion_tokens": getattr(response.usage, "completion_tokens", 0),
                    "total_tokens": getattr(response.usage, "total_tokens", 0),
                }
                
                # Extract reasoning tokens from DeepSeek's thinking process
                if "<think>" in content and "</think>" in content:
                    # Store the thinking process as reasoning tokens
                    thinking_text = content.split("<think>")[1].split("</think>")[0]
                    usage_data["thinking_process"] = thinking_text
                    # Estimate thinking tokens (rough approximation)
                    thinking_tokens = len(thinking_text.split())
                    usage_data["reasoning_tokens"] = thinking_tokens

            else:
                # If we got a ChatCompletionsClient but not for DeepSeek,
                # you may need a different approach or raise an error
                raise ValueError("ChatCompletionsClient is currently only set up for DeepSeek usage.")
        else:
            #
            #  2) The openai.AzureOpenAI client
            #
            # We'll call .chat.completions.create(...) with the recognized arguments.
            # We'll map `params` keys to explicit arguments so that Pylance doesn't complain.
            # We'll # type: ignore if Pylance is still too strict about extra parameters.
            response = azure_client.chat.completions.create(  # type: ignore
                model=model_name,
                messages=params["messages"],  # type: ignore
                temperature=params["temperature"],  # type: ignore
                max_completion_tokens=params.get("max_completion_tokens", 1000),  # type: ignore
                reasoning_effort=params.get("reasoning_effort", "medium"),  # type: ignore
            )

            # Extract content
            if not response.choices:
                content = ""
            else:
                content = (response.choices[0].message.content or "")

            # Extract usage
            usage_raw = getattr(response, "usage", None)
            usage_data = {
                "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
                "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
                "total_tokens": getattr(usage_raw, "total_tokens", 0),
            }
            # For O-series reasoning tokens (optional)
            if usage_raw and hasattr(usage_raw, "completion_tokens_details") and usage_raw.completion_tokens_details:
                usage_data["reasoning_tokens"] = getattr(usage_raw.completion_tokens_details, "reasoning_tokens", 0)

            # Handle DeepSeek formatting for AzureOpenAI client too
            if is_deepseek and "<think>" in content and "</think>" in content:
                # Store the thinking process
                thinking_text = content.split("<think>")[1].split("</think>")[0]
                usage_data["thinking_process"] = thinking_text
                # If reasoning_tokens not already set, estimate from thinking text
                if "reasoning_tokens" not in usage_data:
                    thinking_tokens = len(thinking_text.split())
                    usage_data["reasoning_tokens"] = thinking_tokens

    except HttpResponseError as e:
        # Enhanced error handling for Azure AI Inference
        status_code = e.status_code if hasattr(e, "status_code") else 500
        err_code = "Unknown"
        if getattr(e, "error", None) and hasattr(e.error, "code"):
            err_code = e.error.code

        err_message = getattr(e, "message", str(e))
        err_reason = getattr(e, "reason", "Unknown")

        logger.error(f"""
        [Azure AI Error] Session: {session_id}
        Model: {model_name}
        Status: {status_code}
        Code: {err_code}
        Message: {err_message}
        Reason: {err_reason}
        """)

        return create_error_response(
            status_code=status_code,
            code=str(err_code),
            message="Azure AI service error",
            error_type="azure_error",
            inner_error=err_message,
        )

    except OpenAIError as e:
        logger.exception(f"[session {session_id}] AzureOpenAI call failed: {str(e)}")

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
        logger.exception(f"[session {session_id}] Unexpected error occurred: {str(e)}")

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

    # Process and format content for display
    formatted_content = full_content

    # If it's DeepSeek, handle <think> replacements
    if is_deepseek and full_content:
        import re

        think_regex = r"<think>([\s\S]*?)<\/think>"

        def replace_thinking(match_obj):
            thinking_text = match_obj.group(1)
            return f"""<div class="thinking-process">
                  <div class="thinking-header">
                    <button class="thinking-toggle" aria-expanded="true">
                      <span class="toggle-icon">▼</span> Thinking Process
                    </button>
                  </div>
                  <div class="thinking-content">
                    <pre class="thinking-pre">{thinking_text}</pre>
                  </div>
                </div>"""

        formatted_content = re.sub(think_regex, replace_thinking, formatted_content)

    # Store conversation in DB
    await save_conversation(
        db_session,
        session_id,
        model_name,
        chat_message.message,
        full_content,
        formatted_content,
        response,
    )

    # Build final return
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
    Retrieve prior conversation messages from the DB,
    returning in a format suitable for the LLM.
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
):
    """
    Save user and assistant messages to the database.
    """
    try:
        user_msg = Conversation(
            session_id=session_id,
            role="user",
            content=user_text,
            model=model_name,
        )

        assistant_msg = Conversation(
            session_id=session_id,
            role="assistant",
            content=assistant_text,
            formatted_content=formatted_assistant_text,
            model=model_name,
            raw_response={"streaming": False, "final_content": assistant_text},
        )

        db_session.add(user_msg)
        db_session.add(assistant_msg)
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
        # Provide a fallback if endpoint is None
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or "https://o1models.openai.azure.com"
        api_version = os.getenv("AZURE_OPENAI_API_VERSION") or "2025-02-01-preview"

        client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_endpoint=endpoint,  # now guaranteed str
            api_version=api_version,
        )
        
        response = client.chat.completions.create(  # type: ignore
            model=config.AZURE_OPENAI_DEPLOYMENT_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that summarizes conversations."},
                {"role": "user", "content": f"Summarize the following chat:\n\n{combined_text}\n\nBrief Summary:"},
            ],
            max_completion_tokens=150
        )
        # Safely handle None
        summary_text = ""
        if response.choices and response.choices[0].message and response.choices[0].message.content:
            summary_text = response.choices[0].message.content.strip()
        return summary_text
    except Exception as e:
        return f"Summary of older messages: [Error fallback] {str(e)}"
