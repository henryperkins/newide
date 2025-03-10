import json
import uuid
import time
from time import perf_counter
from typing import Optional, List, Dict, Any

# Placeholder: Added code to store token usage in the database
# For instance:
# def record_token_usage(session_id: str, prompt_tokens: int, completion_tokens: int, reasoning_tokens: int):
#     """
#     Insert or update token usage data in the database.
#     """
#     pass
import os
import re

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import insert, text
from logging_config import logger, response_logger
import config
from config import is_deepseek_model, is_o_series_model
from models import Conversation
from .config_service import ConfigService
from pydantic_models import ChatMessage
from azure.core.exceptions import HttpResponseError

from services.tracing_utils import trace_function, profile_block
from clients import get_model_client_dependency
import sentry_sdk



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
        maybe_max_tokens = params.get("max_tokens", config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS)
        if not isinstance(maybe_max_tokens, (int, float)):
            maybe_max_tokens = config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
        params["max_tokens"] = int(min(maybe_max_tokens, config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS))
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


@trace_function(op="file.context", name="get_file_context")
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
        # If Azure Search is enabled, use it to get content
        if use_search:
            try:
                with profile_block(description="Azure Search Context Retrieval", op="search.context"):
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
                        logger.warning(
                            f"Could not find session_id for file {file_ids[0]}"
                        )
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
                sentry_sdk.capture_exception(e)
                # Fall back to direct file content retrieval

        # Get the file contents directly from database
        with profile_block(description="DB File Content Retrieval", op="db.query"):
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
                        {
                            "filename": filename,
                            "content": content,
                            "file_type": file_type,
                        }
                    )

        if not file_contents:
            return None

        # Format the context string
        with profile_block(description="Format Context String", op="text.format"):
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
                    context += f"```{file_info['file_type'][1:]}\n{file_info['content']}\n```\n\n"
                else:
                    # Regular text content
                    context += file_info["content"] + "\n\n"

            # Add instructions for AI on how to use the context
            context += "\nRefer to the document context above when answering questions about the files. Include specific details from the files when relevant."

        return context

    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        sentry_sdk.capture_exception(e)
        return None


@trace_function(op="chat.process", name="process_chat_message")
async def process_chat_message(
    chat_message: Any,
    db_session: AsyncSession,
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Processes a chat message, calls the appropriate model(s) using `client.complete`,
    optionally handles file context, and stores the final conversation data.

    Args:
        chat_message (Any): The incoming message data (which may include text, model info, etc.).
        db_session (AsyncSession): Database session used for storing conversation/usage.
        model_name (Optional[str]): The name of the model to use, if overriding what's in chat_message.

    Returns:
        Dict[str, Any]: A response dictionary structured like a chat completion, containing
                        the 'choices', 'model', 'usage', 'processing_time_seconds', etc.
    """
    start_time = perf_counter()
    session_id = getattr(chat_message, "session_id", None)
    model_name = (
        model_name
        or getattr(chat_message, "model_name", None)
        or config.AZURE_INFERENCE_DEPLOYMENT  # fallback from config
    )

    try:
        # Retrieve model client
        with profile_block(description="Get Model Client", op="model.client"):
            model_client_dep = await get_model_client_dependency(model_name)
            if model_client_dep.get("error"):
                raise ValueError(f"Error initializing model client: {model_client_dep['error']}")

            client = model_client_dep["client"]
            if not client:
                raise ValueError(f"No valid client found for {model_name}")

        # Prepare parameters (for example, combining user text and messages)
        messages = getattr(chat_message, "messages", None)
        user_text = getattr(chat_message, "message", "")
        if not messages:
            # If messages are not provided, we create a simple user prompt
            messages = [{"role": "user", "content": user_text}]

        # Optionally incorporate file contexts, e.g., chat_message.file_ids
        # (omitting details here -- see your existing logic for get_file_context)

        # Construct the default request params for `client.complete(...)`
        params = {
            "stream": False,  # For non-streaming calls. Set True if you want streaming in process_chat_message.
            "messages": messages,
        }

        # Adjust model-specific parameters
        if is_deepseek_model(model_name):
            params.update({
                "model": "DeepSeek-R1",
                "temperature": 0.5,
                "max_tokens": config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
                "headers": {
                    "x-ms-thinking-format": "html",
                    "x-ms-streaming-version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
                }
            })
        elif is_o_series_model(model_name):
            params.update({
                "max_completion_tokens": config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
                "reasoning_effort": getattr(chat_message, "reasoning_effort", "medium"),
            })
        else:
            # Typical Azure OpenAI model
            params["temperature"] = getattr(chat_message, "temperature", 0.7)
            params["max_tokens"] = getattr(chat_message, "max_completion_tokens", 1000)

        # Make the model call using client.complete
        with profile_block(description="Model API Call", op="model.api"):
            response = await client.complete(**params)
            try:
                import json
                response_logger.info("Raw model response:\n%s", json.dumps(response, indent=2, default=str))
            except Exception as dump_error:
                logger.warning("Failed to dump response as JSON: %s", str(dump_error))
                logger.info("Fallback raw response: %s", str(response))

        # Extract the top assistant message content
        if not response.choices:
            content = ""
            logger.warning("No choices returned from the model.")
        else:
            content = response.choices[0].message.content

        # If DeepSeek reasoning is returned, append it
        # based on the 'understanding-reasoning' doc, we look for .reasoning property
        if hasattr(response.choices[0], "reasoning"):
            reasoning_text = getattr(response.choices[0], "reasoning", None) or ""
            if reasoning_text:
                content += f"\n\n[DeepSeek Reasoning]\n{reasoning_text}"

        # Build usage stats. If the service includes usage in the response, parse it. Otherwise, rely on your own token manager.
        usage_raw = getattr(response, "usage", None)
        if usage_raw:
            usage_data = {
                "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
                "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
                "total_tokens": getattr(usage_raw, "total_tokens", 0),
            }
        else:
            # Use a custom token counter if needed
            usage_data = {
                "prompt_tokens": TokenManager.count_tokens(user_text),
                "completion_tokens": TokenManager.count_tokens(content),
                "total_tokens": TokenManager.count_tokens(user_text) + TokenManager.count_tokens(content),
            }

        # Optionally process chain-of-thought or reasoning (if you rely on details from content).
        # If the user wants to see the model's "thinking" output in DeepSeek responses, parse <thinking> blocks and
        # include them in the final response. Adjust the parsing to fit your actual returned HTML or JSON structure.

        if is_deepseek_model(model_name) and "<thinking>" in content:
            import re
            thinking_blocks = re.findall(r'<thinking>(.*?)</thinking>', content, flags=re.DOTALL)
            if thinking_blocks:
                # Just capture the first <thinking> block for demonstration, or concatenate all if you prefer
                thinking_output = thinking_blocks[0].strip()
            else:
                thinking_output = ""
        else:
            thinking_output = ""

        if thinking_output:
            content += f"\n\n[DeepSeek Thinking]\n{thinking_output}"
        
        processing_time = perf_counter() - start_time

        import uuid
        from services.model_stats_service import ModelStatsService

        # Convert session_id to a UUID or use a fallback if it's missing/invalid
        try:
            session_uuid = uuid.UUID(session_id) if session_id else uuid.UUID("00000000-0000-0000-0000-000000000000")
        except:
            session_uuid = uuid.UUID("00000000-0000-0000-0000-000000000000")

        ms_service = ModelStatsService(db_session)
        await ms_service.record_usage(
            model=model_name,
            session_id=session_uuid,
            usage=usage_data,
            metadata=None
        )

        # Store the conversation
        with profile_block(description="Save Conversation", op="db.save"):
            await save_conversation(
                db_session=db_session,
                session_id=session_id,
                model_name=model_name,
                user_text=user_text,
                assistant_text=content,
                formatted_assistant_text=content,
                raw_response=response  # or a truncated version
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
            "deepseek_thinking": thinking_output if thinking_output else None,
            "processing_time_seconds": processing_time,
        }

    except HttpResponseError as he:
        logger.exception(f"[HttpResponseError] {he}")
        sentry_sdk.capture_exception(he)
        return {
            "status_code": he.status_code,
            "detail": str(he),
        }
    except Exception as e:
        logger.exception(f"Unexpected error in process_chat_message: {e}")
        sentry_sdk.capture_exception(e)
        return {
            "status_code": 500,
            "detail": str(e),
        }


@trace_function(op="chat.save", name="save_conversation")
async def save_conversation(
    db_session: AsyncSession,
    session_id: Optional[str],
    model_name: Optional[str],
    user_text: str,
    assistant_text: str,
    formatted_assistant_text: str,
    raw_response: Any,
) -> None:
    if session_id is None:
        session_id = "unknown_session"
    if model_name is None:
        model_name = "unknown_model"
    """
    Saves user and assistant messages to the database.
    Modify according to your table structure and fields.
    """
    try:
        # Insert user message and assistant message
        # using bulk or individual inserts. Example:
        messages_to_insert = [
            {
                "session_id": session_id,
                "role": "user",
                "content": user_text,
                "model": model_name,
                "formatted_content": user_text,
                "raw_response": None,
            },
            {
                "session_id": session_id,
                "role": "assistant",
                "content": assistant_text,
                "model": model_name,
                "formatted_content": formatted_assistant_text,
                # If you don’t want to store entire raw_response, store partial
                "raw_response": {"trimmed": True} if raw_response else None,
            },
        ]

        # Insert into your "conversations" table
        await db_session.execute(insert(Conversation), messages_to_insert)
        await db_session.commit()

    except Exception as e:
        logger.error(f"Failed to save conversation: {str(e)}")
        sentry_sdk.capture_exception(e)
        await db_session.rollback()
        raise


async def fetch_conversation_history(
    db_session: AsyncSession, session_id: str
) -> List[Dict[str, Any]]:
    """
    Retrieves prior messages in a conversation, returning them in a format
    suitable for an LLM’s “messages” argument. Adjust the query to match your schema.
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


async def summarize_messages(messages: List[Dict[str, Any]]) -> str:
    """
    Example method that calls the client again to produce a summary. 
    Adjust as needed or remove if you don’t use summary logic.
    """
    if not messages:
        return ""

    combined_text = "\n".join(f"{m['role'].capitalize()}: {m['content']}" for m in messages)

    try:
        # For summarizing, just pick a model (DeepSeek, O-series, or default)
        # Or pass in an argument specifying the summarizing model
        summarizing_model = "DeepSeek-R1"

        model_dep = await get_model_client_dependency(summarizing_model)
        summarizing_client = model_dep["client"]

        # Build the summarization request
        response = await summarizing_client.complete(
            stream=False,
            messages=[
                {"role": "system", "content": "You are a summarization assistant."},
                {"role": "user", "content": f"Summarize this conversation:\n\n{combined_text}"},
            ],
            temperature=0.5,
            max_tokens=150,
        )

        if response.choices and response.choices[0].message:
            return response.choices[0].message.content.strip()
        return ""

    except Exception as e:
        logger.error(f"Error summarizing messages: {e}")
        sentry_sdk.capture_exception(e)
        return f"Summary not available due to error: {str(e)}"
    