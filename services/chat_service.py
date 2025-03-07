import json
import uuid
import time
from time import perf_counter
from typing import Optional, List, Dict, Any
import os
import re

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import insert, text
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
    # Validate parameters against model requirements
    if is_deepseek and chat_message.temperature not in (None, 0.5):
        raise ValueError("DeepSeek models require temperature=0.0")

    if is_o_series and chat_message.temperature is not None:
        raise ValueError("O-series models do not support temperature parameter")

    messages = chat_message.messages or [
        {"role": "user", "content": chat_message.message}
    ]

    params = {
        "messages": messages,
        "api_version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
        "headers": {
            "x-ms-thinking-format": "html",
            "x-ms-streaming-version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
        },
        "temperature": 0.5,
    }

    if is_o_series:
        # O1 temperature validation
        if params.get("temperature") is not None:
            params.pop("temperature", None)

    if is_deepseek:
        # Enforce DeepSeek-R1 token limits
        params["max_tokens"] = min(
            chat_message.max_completion_tokens or config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
            131072,  # Max context size
        )
        params["temperature"] = (
            chat_message.temperature
            if chat_message.temperature is not None
            else config.DEEPSEEK_R1_DEFAULT_TEMPERATURE
        )
        params["max_tokens"] = min(
            params.get("max_tokens", config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS),
            config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
        )
    elif is_o_series:
        params["max_completion_tokens"] = (
            chat_message.max_completion_tokens
            or config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
        )
        # Enforce O1 context limit of 200,000 tokens
        params["max_completion_tokens"] = min(params["max_completion_tokens"], 200000)
        params["reasoning_effort"] = chat_message.reasoning_effort or "medium"
        params.pop("temperature", None)
    else:
        # DeepSeek recommends temperature 0.0 for best results
        params["temperature"] = chat_message.temperature or (
            0.0 if is_deepseek else 0.7
        )
        params["max_completion_tokens"] = chat_message.max_completion_tokens or 1000

    return params


async def get_file_context(
    db_session: AsyncSession, file_ids: List[str], use_search: bool = False
) -> Optional[str]:
    """
    Retrieve file content to be used as context in the chat.

    Args:
        db_session: Database session
        file_ids: List of file IDs to include as context
        use_search: Whether to use Azure Search for context retrieval

    Returns:
        Formatted context string or None if no valid files found
    """
    if not file_ids:
        return None

    try:
        # Import here to avoid circular imports
        from clients import get_model_client_dependency

        # If Azure Search is enabled, use it to get content
        if use_search:
            try:
                from services.azure_search_service import AzureSearchService
                from models import UploadedFile

                # Need to get the session_id first
                file_result = await db_session.execute(
                    text(
                        """
                        SELECT session_id 
                        FROM uploaded_files 
                        WHERE id = :file_id::uuid
                        LIMIT 1
                    """
                    ),
                    {"file_id": file_ids[0]},
                )

                session_id_row = file_result.fetchone()
                if not session_id_row:
                    logger.warning(f"Could not find session_id for file {file_ids[0]}")
                    return None

                session_id = session_id_row[0]

                # Get Azure client
                client_wrapper = await get_model_client_dependency()
                azure_client = client_wrapper.get("client")

                # Use Azure Search
                search_service = AzureSearchService(azure_client)
                results = await search_service.query_index(
                    session_id=session_id,
                    query="",  # Empty query returns all content
                    file_ids=file_ids,
                    top=10,
                )

                if results:
                    # Format search results
                    formatted_content = "## Document Context\n\n"
                    for i, result in enumerate(results):
                        # Add file information
                        formatted_content += f"### {result.get('filename')}\n"
                        if "content" in result:
                            formatted_content += result.get("content", "") + "\n\n"

                    return formatted_content
            except Exception as e:
                logger.error(f"Error using Azure Search for file context: {e}")
                # Fall back to direct file content retrieval

        # Get the file contents directly from database
        file_contents = []
        for file_id in file_ids:
            result = await db_session.execute(
                text(
                    """
                    SELECT filename, content, file_type
                    FROM uploaded_files 
                    WHERE id = :file_id::uuid
                """
                ),
                {"file_id": file_id},
            )

            row = result.fetchone()
            if row:
                filename, content, file_type = row
                # Truncate large files
                MAX_CHARS_PER_FILE = (
                    15000  # Limit file size to avoid exceeding context window
                )
                if content and len(content) > MAX_CHARS_PER_FILE:
                    content = (
                        content[:MAX_CHARS_PER_FILE]
                        + f"\n\n[File truncated due to size. Original length: {len(content)} characters]"
                    )

                file_contents.append(
                    {"filename": filename, "content": content, "file_type": file_type}
                )

        if not file_contents:
            return None

        # Format the context string
        context = "## Document Context\n\n"
        for file_info in file_contents:
            # Add file information
            context += f"### {file_info['filename']}\n\n"

            # Add file content based on file type
            if file_info["file_type"] in [
                ".py",
                ".js",
                ".html",
                ".css",
                ".jsx",
                ".ts",
                ".tsx",
                ".json",
            ]:
                # Format code files with markdown code blocks
                context += (
                    f"```{file_info['file_type'][1:]}\n{file_info['content']}\n```\n\n"
                )
            else:
                # Regular text content
                context += file_info["content"] + "\n\n"

        # Add instructions for AI on how to use the context
        context += "\nRefer to the document context above when answering questions about the files. Include specific details from the files when relevant."

        return context

    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        return None


async def process_chat_message(
    chat_message: Any,
    db_session: AsyncSession,
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    start_time = perf_counter()
    session_id = chat_message.session_id

    model_name = (
        model_name
        or getattr(chat_message, "model_name", None)
        or config.AZURE_INFERENCE_DEPLOYMENT
    )

    try:
        model_configs = await fetch_model_configs(db_session)
        if model_name not in model_configs:
            logger.warning(f"No configuration found for model {model_name}")
    except Exception as e:
        logger.error(f"Error fetching model_configs: {str(e)}")
        model_configs = {}

    is_deepseek = is_deepseek_model(model_name)
    is_o_series = is_o_series_model(model_name)

    # Set params based on model
    if is_deepseek:
        params = {
            "messages": chat_message.messages,
            "temperature": chat_message.temperature or 0.5,
            "max_tokens": chat_message.max_tokens or 131072,
            "response_format": {"type": "text"},
        }
    elif is_o_series:
        params = {
            "model": model_name,
            "messages": chat_message.messages,
            "max_completion_tokens": chat_message.max_tokens or 40000,
            "reasoning_effort": "medium",
            "response_format": {"type": "text"},
        }
    else:
        params = {
            "model": model_name,
            "messages": chat_message.messages,
            "temperature": chat_message.temperature or 0.7,
            "max_tokens": chat_message.max_tokens or 4096,
            "response_format": {"type": "text"},
        }

    # Handle file context integration
    if chat_message.include_files and chat_message.file_ids:
        try:
            file_context = await get_file_context(
                db_session, chat_message.file_ids, False
            )
            if file_context:
                file_system_message = {
                    "role": "developer" if is_o_series else "system",
                    "content": file_context,
                }
                params["messages"].insert(0, file_system_message)
                logger.info(f"Added file context ({len(file_context)} chars)")
        except Exception as e:
            logger.error(f"Error integrating file context: {e}")

    # Make the model call and handle responses
    try:
        if is_deepseek:
            client = ChatCompletionsClient(
                endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"],
                credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"]),
            )
            response = client.complete(**params)
        else:
            client_wrapper = await get_model_client_dependency(model_name)
            azure_client = client_wrapper["client"]

            if is_o_series:
                response = azure_client.chat.completions.create(
                    model=params["model"],
                    messages=params["messages"],
                    max_completion_tokens=params["max_completion_tokens"],
                    reasoning_effort=params["reasoning_effort"],
                )
            else:
                response = azure_client.chat.completions.create(
                    model=params["model"],
                    messages=params["messages"],
                    temperature=params["temperature"],
                    max_tokens=params["max_tokens"],
                )

        content = response.choices[0].message.content if response.choices else ""
        usage_raw = getattr(response, "usage", None)
        usage_data = {
            "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
            "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
            "total_tokens": getattr(usage_raw, "total_tokens", 0),
        }

        # Robust HTML parsing for reasoning sections (DeepSeek-specific)
        if is_deepseek and "<details" in content:
            details_pattern = re.compile(
                r"""<details.*?>
                <summary.*?>Thought for a second</summary>\s*
                <div[^>]*>(.*?)</div>\s*
                </details>\s*(.*)""",
                re.DOTALL,
            )
            match = details_pattern.match(content)
            if match:
                reasoning = match.group(1).strip()
                answer = match.group(2).strip()
                usage_data["thinking_process"] = reasoning
                usage_data["reasoning_tokens"] = len(reasoning.split())
                content = answer

    except HttpResponseError as e:
        status_code = getattr(e, "status_code", 500)
        err_code = (
            getattr(e.error, "code", "Unknown")
            if getattr(e, "error", None)
            else "Unknown"
        )
        err_message = getattr(e, "message", str(e))
        err_reason = getattr(e, "reason", "Unknown")
        logger.error(f"[Azure AI Error] {err_message}")
        return create_error_response(
            status_code=status_code,
            code=str(err_code),
            message="Azure AI service error",
            error_type="azure_error",
            inner_error=err_message,
        )
    except OpenAIError as e:
        logger.exception(f"[OpenAI Error] {str(e)}")
        return create_error_response(
            status_code=503,
            code=getattr(e, "code", "api_error"),
            message="Error during AzureOpenAI call",
            error_type="api_call_error",
            inner_error=str(e),
        )
    except Exception as e:
        logger.exception(f"[Unexpected Error] {str(e)}")
        return create_error_response(
            status_code=500,
            code="internal_server_error",
            message="An unexpected error occurred during processing.",
            error_type="unknown_error",
            inner_error=str(e),
        )

    processing_time = perf_counter() - start_time

    # Store conversation
    await save_conversation(
        db_session=db_session,
        session_id=session_id,
        model_name=model_name,
        user_text=chat_message.message,
        assistant_text=content,
        formatted_assistant_text=content,
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
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage_data,
        "processing_time_seconds": processing_time,
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
                "raw_response": None,  # Don't store full API responses
            },
            {
                "session_id": session_id,
                "role": "assistant",
                "content": assistant_text,
                "model": model_name,
                "formatted_content": formatted_assistant_text,
                "raw_response": {"trimmed": True},  # Store metadata only
            },
        ]

        # Use SQLAlchemy bulk insert with return_defaults=False for better performance
        await db_session.execute(insert(Conversation), messages_to_insert)
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
        endpoint = (
            os.getenv("AZURE_OPENAI_ENDPOINT") or "https://o1models.openai.azure.com"
        )
        api_version = os.getenv("AZURE_OPENAI_API_VERSION") or "2025-02-01-preview"

        client = ChatCompletionsClient(
            endpoint=config.AZURE_INFERENCE_ENDPOINT,
            credential=AzureKeyCredential(config.AZURE_INFERENCE_CREDENTIAL),
            api_version=config.DEEPSEEK_R1_DEFAULT_API_VERSION,
            headers={
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
            },
        )

        response = client.complete(
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that summarizes conversations.",
                },
                {
                    "role": "user",
                    "content": f"Summarize the following chat:\n\n{combined_text}\n\nBrief Summary:",
                },
            ],
            temperature=0.5,
            max_tokens=150,
        )

        summary_text = ""
        if (
            response.choices
            and response.choices[0].message
            and response.choices[0].message.content
        ):
            summary_text = response.choices[0].message.content.strip()
        return summary_text
    except Exception as e:
        return f"Summary of older messages: [Error fallback] {str(e)}"
