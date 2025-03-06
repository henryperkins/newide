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
        "temperature": 0.0,  # Required for DeepSeek-R1
    }

    if is_o_series:
        # O1 temperature validation
        if is_o_series:
            if params.get("temperature") not in [None, 1.0]:
                raise ValueError("O1 models only support temperature=1.0 when provided")
            if params.get("temperature") is None:
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
    chat_message: ChatMessage,
    db_session: AsyncSession,
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Processes a single chat message, calling the appropriate client to get a response,
    and stores conversation data in the database.
    """
    start_time = perf_counter()
    session_id = chat_message.session_id
    # Use provided model_name or fallback to chat_message.model_name or default deployment
    model_name = (
        model_name
        or getattr(chat_message, "model_name", None)
        or config.AZURE_INFERENCE_DEPLOYMENT
    )

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
    params = prepare_model_parameters(
        chat_message, model_name, is_deepseek, is_o_series
    )

    # Process advanced data sources integration if files are included
    if (
        chat_message.include_files
        and chat_message.file_ids
        and chat_message.use_file_search
    ):
        try:
            from services.azure_search_service import AzureSearchService
            from models import UploadedFile

            # Get session_id for Azure Search
            file_result = await db_session.execute(
                text(
                    """
                    SELECT session_id 
                    FROM uploaded_files 
                    WHERE id = :file_id::uuid
                    LIMIT 1
                """
                ),
                {"file_id": chat_message.file_ids[0]},
            )

            session_id_row = file_result.fetchone()
            if not session_id_row:
                logger.warning(
                    f"Could not find session_id for file {chat_message.file_ids[0]}"
                )
            else:
                session_id = session_id_row[0]

                # Set up data_sources for direct Azure Search integration
                params["data_sources"] = [
                    {
                        "type": "azure_search",
                        "parameters": {
                            "endpoint": config.AZURE_SEARCH_ENDPOINT,
                            "authentication": {
                                "type": "api_key",
                                "api_key": config.AZURE_SEARCH_KEY,
                            },
                            "index_name": f"index-{session_id}",
                            "query_type": "hybrid",  # Use both vector and keyword search
                            "embedding_dependency": {
                                "type": "deployment_name",
                                "deployment_name": config.AZURE_EMBEDDING_DEPLOYMENT,
                            },
                            "in_scope": True,
                            "top_n_documents": 5,
                            "strictness": 3,
                            "role_information": "You are an AI assistant that helps people find information from their files. When referencing information from files, cite the specific file.",
                            "fields_mapping": {
                                "content_fields_separator": "\n",
                                "content_fields": ["content", "chunk_content"],
                                "filepath_field": "filepath",
                                "title_field": "filename",
                                "url_field": "id",
                                "vector_fields": ["content_vector"],
                            },
                        },
                    }
                ]

                # If specific file_ids are provided, add filter to only search those files
                if len(chat_message.file_ids) > 0:
                    id_filters = [
                        f"id eq '{file_id}' or startsWith(id, '{file_id}-chunk-')"
                        for file_id in chat_message.file_ids
                    ]
                    params["data_sources"][0]["parameters"]["filter"] = " or ".join(
                        id_filters
                    )

                logger.info(
                    f"Using direct Azure Search integration with {len(chat_message.file_ids)} files"
                )
        except Exception as e:
            logger.error(f"Error setting up direct Azure Search integration: {e}")
            # Fall back to traditional context approach
            file_context = await get_file_context(
                db_session, chat_message.file_ids, False
            )
            if file_context:
                # Add file context as a system message before the user's message
                file_system_message = {"role": "system", "content": file_context}

                # Insert file context before the user's message
                user_msg_index = 0
                for i, msg in enumerate(params["messages"]):
                    if msg["role"] not in ["system", "developer"]:
                        user_msg_index = i
                        break

                # Insert the file context message
                params["messages"].insert(user_msg_index, file_system_message)

                logger.info(
                    f"Added file context ({len(file_context)} chars) to message (fallback method)"
                )
    # Use traditional context method if not using search or if direct integration isn't requested
    elif chat_message.include_files and chat_message.file_ids:
        file_context = await get_file_context(db_session, chat_message.file_ids, False)
        if file_context:
            # Add file context as a system message before the user's message
            file_system_message = {
                "role": "developer" if is_o_series else "system",
                "content": file_context,
            }

            # Insert file context before the user's message
            user_msg_index = 0
            for i, msg in enumerate(params["messages"]):
                if msg["role"] not in ["system", "developer"]:
                    user_msg_index = i
                    break

            # Insert the file context message
            params["messages"].insert(user_msg_index, file_system_message)

            logger.info(f"Added file context ({len(file_context)} chars) to message")

    try:
        from clients import get_model_client_dependency

        # Distinguish between ChatCompletionsClient and AzureOpenAI:
        client_wrapper = get_model_client_dependency(model_name)
        azure_client = client_wrapper.get("client")
        if isinstance(azure_client, ChatCompletionsClient):
            if is_deepseek:
                logger.debug(
                    f"Calling DeepSeek-R1 model with messages and temperature: {params.get('temperature')}"
                )
                response = azure_client.complete(
                    messages=params["messages"],
                    temperature=params.get("temperature"),
                    max_tokens=params.get("max_tokens"),
                )
                content = (
                    response.choices[0].message.content if response.choices else ""
                )
                usage_data = {
                    "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                    "completion_tokens": getattr(
                        response.usage, "completion_tokens", 0
                    ),
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
                content = (
                    response.choices[0].message.content if response.choices else ""
                )
                usage_data = {
                    "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                    "completion_tokens": getattr(
                        response.usage, "completion_tokens", 0
                    ),
                    "total_tokens": getattr(response.usage, "total_tokens", 0),
                }
        else:
            # Using the openai.AzureOpenAI client
            # Add DeepSeek-specific streaming headers
            # For DeepSeek models, use ChatCompletionsClient directly
            response = azure_client.complete(
                model=model_name,
                messages=params["messages"],  # type: ignore
                temperature=params.get("temperature", 0.7),  # type: ignore
                max_completion_tokens=params.get("max_completion_tokens", 1000),  # type: ignore
                # Removed reasoning_effort for DeepSeek models:
                # No longer passing reasoning_effort in the call for DeepSeek-R1
            )
            content = response.choices[0].message.content if response.choices else ""
            usage_raw = getattr(response, "usage", None)
            usage_data = {
                "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
                "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
                "total_tokens": getattr(usage_raw, "total_tokens", 0),
            }
            if (
                usage_raw
                and hasattr(usage_raw, "completion_tokens_details")
                and usage_raw.completion_tokens_details
            ):
                usage_data["reasoning_tokens"] = getattr(
                    usage_raw.completion_tokens_details, "reasoning_tokens", 0
                )
            if is_deepseek and "<think>" in content and "</think>" in content:
                thinking_text = content.split("<think>")[1].split("</think>")[0]
                usage_data["thinking_process"] = thinking_text
                if "reasoning_tokens" not in usage_data:
                    usage_data["reasoning_tokens"] = len(thinking_text.split())
    except HttpResponseError as e:
        # Handle DeepSeek-specific errors
        if "no healthy upstream" in str(e).lower():
            raise ValueError("DeepSeek service unavailable") from e

        status_code = e.status_code if hasattr(e, "status_code") else 500
        err_code = (
            getattr(e.error, "code", "Unknown")
            if getattr(e, "error", None)
            else "Unknown"
        )
        err_message = getattr(e, "message", str(e))
        err_reason = getattr(e, "reason", "Unknown")

        # Special handling for DeepSeek's thinking format requirements
        if "x-ms-thinking-format" in err_message:
            err_message += " - Required for chain-of-thought responses"

        # Handle Azure Content Safety filtering
        if hasattr(e, "response") and "content_filter_results" in e.response.json():
            filter_results = e.response.json()["content_filter_results"]
            err_message += f" | Blocked content: {filter_results}"
        logger.error(
            f"[Azure AI Error] Session: {session_id} | Model: {model_name} | Status: {status_code} | Code: {err_code} | Message: {err_message} | Reason: {err_reason}"
        )
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

    processing_time = perf_counter() - start_time
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
        "processing_time_seconds": processing_time,  # Add processing time to help diagnose issues
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

        # DeepSeek requires special handling for temperature and max_tokens
        client = ChatCompletionsClient(
            endpoint=config.AZURE_INFERENCE_ENDPOINT,
            credential=AzureKeyCredential(config.AZURE_INFERENCE_CREDENTIAL),
            model="DeepSeek-R1",
            api_version=config.DEEPSEEK_R1_DEFAULT_API_VERSION,
            headers={
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
            },
        )

        response = client.chat.completions.create(  # type: ignore
            model=config.AZURE_OPENAI_DEPLOYMENT_NAME,
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
            max_completion_tokens=150,
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
