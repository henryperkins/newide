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
    """Parse and handle errors from different client types consistently"""
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

        if not model_configs:
            logger.warning("No model configurations found in the database.")

        max_tokens = model_configs.get(model_name, {}).get("max_tokens", 4096)
        return {
            "max_tokens": max_tokens,
            "max_context_tokens": int(max_tokens * 0.8),
        }

    @staticmethod
    def count_tokens(text_content: str) -> int:
        """
        Naive token count for demonstration.
        Replace with GPT token counting (e.g., tiktoken) if you need accuracy.
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
                for item in content:
                    if isinstance(item, dict):
                        total += TokenManager.count_tokens(item.get("text", ""))
                    elif isinstance(item, str):
                        total += TokenManager.count_tokens(item)
        return total


async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: Union[AzureOpenAI, ChatCompletionsClient],
    model_name: Optional[str] = None,
) -> dict:
    """
    Processes a single chat message, calling the appropriate client to get a response,
    and stores conversation data in the DB.
    """
    start_time = perf_counter()
    session_id = chat_message.session_id

    model_name = model_name or config.AZURE_OPENAI_DEPLOYMENT_NAME

    # Get model configurations from database with better error handling
    try:
        from services.config_service import ConfigService
        from database import AsyncSessionLocal

        async with AsyncSessionLocal() as config_db:
            config_service = ConfigService(config_db)
            model_configs = await config_service.get_model_configs()

        if not model_configs or model_name not in model_configs:
            logger.warning(f"No configuration found for model {model_name}")
    except Exception as e:
        logger.error(f"Error fetching model_configs: {str(e)}")
        model_configs = {}

    # Check if this is a DeepSeek model
    is_deepseek = model_name.lower() == "deepseek-r1" or config.is_deepseek_model(
        model_name
    )

    # Prepare parameters based on client type and model
    # FIX: Create messages from the single message if not provided
    if hasattr(chat_message, "messages") and chat_message.messages:
        messages = chat_message.messages
    else:
        # Create a messages array from the single message
        messages = [{"role": "user", "content": chat_message.message}]

    temperature = chat_message.temperature
    max_tokens = chat_message.max_completion_tokens

    # Determine which client type we're using
    is_inference_client = isinstance(azure_client, ChatCompletionsClient)

    # Set up parameters based on client type and model
    params = {
        "messages": messages,
        "temperature": temperature if temperature is not None else 0.7,
        "max_tokens": max_tokens if max_tokens is not None else 4096,
    }

    if is_inference_client and is_deepseek:
        # Additional parameters for DeepSeek
        params["temperature"] = config.DEEPSEEK_R1_DEFAULT_TEMPERATURE
        params["max_tokens"] = config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
    elif is_inference_client:
        # Use the same .complete(...) call for non-DeepSeek too
        response = azure_client.complete(
            model=model_name,
            messages=params["messages"],
            temperature=params["temperature"] if params.get("temperature") is not None else 0.7,
            max_tokens=params["max_tokens"] if params.get("max_tokens") is not None else 4096,
        )

        if not response.choices or len(response.choices) == 0:
            logger.warning(
                f"[session {session_id}] No choices returned from Azure AI Inference."
            )
            content = ""
        else:
            content = response.choices[0].message.content or ""

        usage_data = {
            "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
            "completion_tokens": getattr(response.usage, "completion_tokens", 0),
            "total_tokens": getattr(response.usage, "total_tokens", 0),
        }
    else:
        # OpenAI client
        if not is_deepseek:
            params["reasoning_effort"] = (
                chat_message.reasoning_effort
                if chat_message.reasoning_effort
                else "medium"
            )

    try:
        if is_inference_client and is_deepseek:
            # Azure AI Inference client for DeepSeek
            response = azure_client.complete(
                model=model_name,
                messages=params["messages"],
                temperature=params["temperature"],
                max_tokens=params["max_tokens"],
            )

            # Extract content from response
            if not response.choices or len(response.choices) == 0:
                logger.warning(
                    f"[session {session_id}] No choices returned from Azure AI Inference."
                )
                content = ""
            else:
                content = response.choices[0].message.content or ""

            # Extract usage info
            usage_data = {
                "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                "completion_tokens": getattr(response.usage, "completion_tokens", 0),
                "total_tokens": getattr(response.usage, "total_tokens", 0),
            }
        else:
            # OpenAI client for o-series models
            if not is_deepseek:
                params["reasoning_effort"] = (
                    chat_message.reasoning_effort
                    if chat_message.reasoning_effort
                    else "medium"
                )
            response = azure_client.chat.completions.create(**params)

            # Extract content
            if not response.choices or len(response.choices) == 0:
                logger.warning(
                    f"[session {session_id}] No choices returned from AzureOpenAI."
                )
                content = ""
            else:
                content = response.choices[0].message.content or ""

            # Extract usage
            usage_raw = getattr(response, "usage", None)
            usage_data = {}
            if usage_raw:
                usage_data = {
                    "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
                    "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
                    "total_tokens": getattr(usage_raw, "total_tokens", 0),
                }

    except HttpResponseError as e:
        # Enhanced error handling for Azure AI Inference
        error_details = {
            "status_code": e.status_code,
            "code": e.error.code if hasattr(e, 'error') else "Unknown",
            "message": e.message if hasattr(e, 'message') else str(e),
            "reason": e.reason if hasattr(e, 'reason') else "Unknown",
        }
        
        logger.error(f"""
        [Azure AI Error] Session: {session_id}
        Model: {model_name}
        Status: {error_details['status_code']}
        Code: {error_details['code']}
        Message: {error_details['message']}
        Reason: {error_details['reason']}
        """)

        return create_error_response(
            status_code=error_details['status_code'],
            code=error_details['code'],
            message="Azure AI service error",
            error_type="azure_error",
            inner_error=error_details['message']
        )

    except OpenAIError as e:
        # Error handling for OpenAI
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
        # Generic error handling
        logger.exception(f"[session {session_id}] Unexpected error occurred: {str(e)}")

        err = create_error_response(
            status_code=500,
            code="internal_server_error",
            message="An unexpected error occurred during processing.",
            error_type="unknown_error",
            inner_error="Internal server error",
        )
        logger.critical(f"Handled unexpected error gracefully. {err['detail']}")
        return err

    full_content = content

    # Process and format content for display
    formatted_content = full_content

    # Format DeepSeek thinking tags if present
    if model_name == "DeepSeek-R1" and full_content:
        import re

        # Use a simpler regex pattern for <think> tags
        thinkRegex = r"<think>([\s\S]*?)<\/think>"

        # Replace the matched thinking block with formatted HTML.
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

        formatted_content = re.sub(
            thinkRegex, replace_thinking, formatted_content
        )

    # Create user message
    user_msg = Conversation(
        session_id=session_id,
        role="user",
        content=chat_message.message,
        model=model_name,
    )

    # Create assistant message with formatted content and raw response
    assistant_msg = Conversation(
        session_id=session_id,
        role="assistant",
        content=full_content,
        formatted_content=formatted_content,
        model=model_name,
        raw_response={"streaming": False, "final_content": full_content},
    )

    # Store messages in database
    await save_conversation(
        db_session,
        session_id,
        model_name,
        chat_message.message,
        full_content,
        formatted_content,
        response,
    )

    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
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

    combined_text = "\n".join(
        f"{m['role'].capitalize()}: {m['content']}" for m in messages
    )
    try:
        response = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_base=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
        ).completions.create(
            engine="text-davinci-003",
            prompt=f"Summarize the following chat:\n\n{combined_text}\n\nBrief Summary:",
            max_tokens=150,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return "Summary of older messages: [Error fallback] " + str(e)
