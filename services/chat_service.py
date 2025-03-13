from time import perf_counter
from typing import Optional, List, Dict, Any

import time
import sentry_sdk
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import insert, text
from logging_config import logger, response_logger
import config
from pydantic_models import ChatMessage
import re
import mimetypes
import base64

def encode_image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        data = f.read()
    return f"data:image/jpeg;base64,{base64.b64encode(data).decode('utf-8')}"
from models import Conversation
from azure.core.exceptions import HttpResponseError

from services.tracing_utils import (
    trace_function,
    profile_block,
    add_breadcrumb,
    create_transaction,
    add_ai_prompt_breadcrumb,
    set_ai_token_counts,
    ai_operation_block,
    set_measurement
)
from clients import get_model_client_dependency

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
        params["max_completion_tokens"] = chat_message.max_completion_tokens or config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
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
async def get_file_context(  # noqa: C901
    db_session: AsyncSession, file_ids: List[str], use_search: bool = False
) -> Optional[str]:
    """
    Retrieve file content to be used as context in the chat.
    If Azure Search is enabled, use it to get content. Otherwise,
    retrieve directly from the database. 
    """
    if not file_ids:
        return None

    # Add breadcrumb for file context retrieval
    add_breadcrumb(
        category="file.context",
        message=f"Retrieving file context for {len(file_ids)} file(s)",
        level="info",
        file_ids=file_ids[:5] if len(file_ids) <= 5 else file_ids[:5] + ["..."],
        use_search=use_search
    )

    try:
        # If Azure Search is enabled, use it to get content
        if use_search:
            try:
                with profile_block(description="Azure Search Context Retrieval", op="search.context") as search_span:
                    from services.azure_search_service import AzureSearchService

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

                    client_wrapper = await get_model_client_dependency()
                    azure_client = client_wrapper.get("client")

                    search_service = AzureSearchService(azure_client)
                    results = await search_service.query_index(
                        session_id=session_id,
                        query="",  # Empty query returns all content
                        file_ids=file_ids,
                        top=10,
                    )

                    if results:
                        search_span.set_data("results_count", len(results))
                        formatted_content = "## Document Context\n\n"
                        for i, result in enumerate(results):
                            formatted_content += f"### {result.get('filename')}\n"
                            if "content" in result:
                                formatted_content += result.get("content", "") + "\n\n"
                        return formatted_content
            except Exception as e:
                logger.error(f"Error using Azure Search for file context: {e}")
                sentry_sdk.capture_exception(e)
                # Fall back to direct file content retrieval

        # Get the file contents directly from database
        with profile_block(description="DB File Content Retrieval", op="db.query") as db_span:
            file_contents = []
            total_chars = 0
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
                    MAX_CHARS_PER_FILE = 15000
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
                    total_chars += len(content) if content else 0

            db_span.set_data("files_retrieved", len(file_contents))
            db_span.set_data("total_chars", total_chars)

        if not file_contents:
            add_breadcrumb(
                category="file.context",
                message="No file contents found in DB",
                level="warning",
                file_ids=file_ids[:5]
            )
            return None

        # Format the context string
        with profile_block(description="Format Context String", op="text.format"):
            context = "## Document Context\n\n"
            for file_info in file_contents:
                context += f"### {file_info['filename']}\n\n"
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
                    context += f"```{file_info['file_type'][1:]}\n{file_info['content']}\n```\n\n"
                else:
                    context += file_info["content"] + "\n\n"
            context += "\nRefer to the document context above when answering questions about the files. Include specific details from the files when relevant."
        return context

    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        sentry_sdk.capture_exception(e)
        return None


@trace_function(op="chat.process", name="process_chat_message")
async def process_chat_message(  # noqa: C901
    chat_message: Any,
    db_session: AsyncSession,
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Processes a chat message, calls the appropriate model(s) using `client.complete`,
    optionally handles file context, and stores the final conversation data.
    """
    # Start a Sentry transaction to better track process_chat_message
    transaction = sentry_sdk.start_transaction(
        op="chat.process",
        name="Process Chat Message"
    )
    # Tag the transaction for search/filter in Sentry
    transaction.set_tag("model_name", model_name or "unknown")
    session_id = getattr(chat_message, "session_id", "unknown")
    transaction.set_tag("session_id", session_id)

    with transaction.start_child(op="task", description="Initial Setup") as span:
        start_time = perf_counter()
        span.set_data("model_name", model_name or "unknown")
        span.set_tag("session_id", session_id)
        # Add breadcrumb for the start of chat processing
        add_breadcrumb(
            category="chat",
            message=f"Starting chat processing for model {model_name}",
            level="info",
            session_id=session_id
        )

    session_id = getattr(chat_message, "session_id", None)
    model_name = (
        str(model_name)
        if model_name
        else getattr(chat_message, "model_name", None)
        or config.AZURE_INFERENCE_DEPLOYMENT
    )
    if not model_name:
        model_name = "unknown_model"

    try:
        with profile_block(description="Get Model Client", op="model.client") as client_span:
            model_client_dep = await get_model_client_dependency(model_name)
            if model_client_dep.get("error"):
                error_info = model_client_dep["error"]
                client_span.set_data("error", error_info)
                add_breadcrumb(
                    category="model.client",
                    message=f"Error initializing model client: {error_info}",
                    level="error"
                )
                raise ValueError(f"Error initializing model client: {error_info}")

            client = model_client_dep["client"]
            if not client:
                client_span.set_data("error", "No valid client found")
                add_breadcrumb(
                    category="model.client",
                    message=f"No valid client found for {model_name}",
                    level="error"
                )
                raise ValueError(f"No valid client found for {model_name}")

        messages = getattr(chat_message, "messages", None)
        user_text = getattr(chat_message, "message", "")
        if not messages:
            messages = [{"role": "user", "content": user_text}]

        params = {
            "stream": False,
            "messages": messages,
        }

        # Determine if it's a DeepSeek model or O-series
        from config import is_deepseek_model, is_o_series_model

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

            # Vision checks
            if any(isinstance(c, dict) and c.get("type") == "image_url"
                   for msg in messages for c in msg.get("content", [])):
                from fastapi import HTTPException
                from routers.chat import validate_vision_request
                for msg in messages:
                    await validate_vision_request(msg.get("content", []))

                # Example: add extra headers for vision
                params.update({
                    "headers": {
                        "x-ms-vision": "enable",
                        "x-ms-image-detail": getattr(chat_message, "detail_level", "auto")
                    }
                })

        else:
            params["temperature"] = getattr(chat_message, "temperature", 0.7)
            params["max_tokens"] = getattr(chat_message, "max_completion_tokens", 1000)

        with profile_block(description="Model API Call", op="model.api") as model_span:
            response = await client.complete(**params)
            # Attempt to log raw response for debugging
            try:
                import json
                response_logger.info("Raw model response:\n%s", json.dumps(response, indent=2, default=str))
            except Exception as dump_error:
                logger.warning("Failed to dump response as JSON: %s", str(dump_error))
                logger.info("Fallback raw response: %s", str(response))

        if not response.choices:
            content = ""
            logger.warning("No choices returned from the model.")
        else:
            content = response.choices[0].message.content

        # If the model includes reasoning in the response
        if hasattr(response.choices[0], "reasoning"):
            reasoning_text = getattr(response.choices[0], "reasoning", None) or ""
            if reasoning_text:
                content += f"\n\n[DeepSeek Reasoning]\n{reasoning_text}"

        usage_raw = getattr(response, "usage", None)
        if usage_raw:
            usage_data = {
                "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
                "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
                "total_tokens": getattr(usage_raw, "total_tokens", 0),
            }
        else:
            usage_data = {
                "prompt_tokens": TokenManager.count_tokens(user_text),
                "completion_tokens": TokenManager.count_tokens(content),
                "total_tokens": TokenManager.count_tokens(user_text) + TokenManager.count_tokens(content),
            }

        # Some DeepSeek responses have <thinking> blocks
        if is_deepseek_model(model_name) and "<thinking>" in content:
            import re
            thinking_blocks = re.findall(r'<thinking>(.*?)</thinking>', content, flags=re.DOTALL)
            if thinking_blocks:
                thinking_output = thinking_blocks[0].strip()
            else:
                thinking_output = ""
        else:
            thinking_output = ""

        if thinking_output:
            content += f"\n\n[DeepSeek Thinking]\n{thinking_output}"

        processing_time = perf_counter() - start_time

        from services.model_stats_service import ModelStatsService
        import uuid

        try:
            session_uuid = uuid.UUID(session_id) if session_id else uuid.UUID("00000000-0000-0000-0000-000000000000")
        except Exception:
            session_uuid = uuid.UUID("00000000-0000-0000-0000-000000000000")

        ms_service = ModelStatsService(db_session)
        await ms_service.record_usage(
            model=model_name,
            session_id=session_uuid,
            usage=usage_data,
            metadata=None
        )

        with profile_block(description="Save Conversation", op="db.save"):
            await save_conversation(
                db_session=db_session,
                session_id=session_id,
                model_name=model_name,
                user_text=user_text,
                assistant_text=content,
                formatted_assistant_text=content,
                raw_response=response
            )

        # Mark transaction success
        transaction.set_data("success", True)
        transaction.set_data("usage", usage_data)
        transaction.set_data("processing_time_seconds", processing_time)
        transaction.set_status("ok")
        transaction.finish()

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
        
        with transaction.start_child(op="error", description="HTTP Response Error") as err_span:
            err_span.set_data("error.type", he.__class__.__name__)
            err_span.set_data("error.message", str(he))
            err_span.set_data("error.status_code", getattr(he, "status_code", "unknown"))
            err_span.set_data("model_name", model_name)

        add_breadcrumb(
            category="http.error",
            message=f"HTTP error from model service: {he}",
            level="error",
            status_code=getattr(he, "status_code", "unknown"),
            model_name=model_name
        )
        sentry_sdk.capture_exception(he)
        transaction.set_status("internal_error")
        transaction.finish()

        return {
            "status_code": he.status_code,
            "detail": str(he),
        }
    except Exception as e:
        logger.exception(f"Unexpected error in process_chat_message: {e}")
        
        with transaction.start_child(op="error", description="Unexpected Error") as err_span:
            err_span.set_data("error.type", e.__class__.__name__)
            err_span.set_data("error.message", str(e))
            err_span.set_data("model_name", model_name)

        add_breadcrumb(
            category="error",
            message=f"Unexpected error in process_chat_message: {e}",
            level="error"
        )
        sentry_sdk.capture_exception(e)
        transaction.set_status("internal_error")
        transaction.finish()

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
                "raw_response": {"trimmed": True} if raw_response else None,
            },
        ]

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
        summarizing_model = "DeepSeek-R1"
        model_dep = await get_model_client_dependency(summarizing_model)
        summarizing_client = model_dep["client"]

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
import os

async def process_vision_content(content: list):
    """Process vision content for o1 model with improved validation"""
    processed_content = []
    
    for item in content:
        if item["type"] == "image_url":
            image_url = item["image_url"]["url"]
            
            # Handle local files with proper MIME type detection
            if image_url.startswith(('http://', 'https://')):
                # Validate remote URL
                if not await validate_image_url(image_url):
                    raise ValueError(f"Invalid image URL: {image_url}")
            elif os.path.isfile(image_url):
                # Encode local file with proper MIME type
                mime_type, _ = mimetypes.guess_type(image_url)
                if mime_type not in config.O_SERIES_VISION_CONFIG["ALLOWED_MIME_TYPES"]:
                    raise ValueError(f"Unsupported image type: {mime_type}")
                
                with open(image_url, "rb") as image_file:
                    encoded = base64.b64encode(image_file.read()).decode("utf-8")
                    image_url = f"data:{mime_type};base64,{encoded}"
            elif image_url.startswith("data:"):
                # Validate base64 format
                if not re.match(config.O_SERIES_VISION_CONFIG["BASE64_HEADER_PATTERN"], image_url):
                    raise ValueError("Invalid base64 image format")

            processed_content.append({
                "type": "image_url",
                "image_url": {
                    "url": image_url,
                    "detail": item["image_url"].get("detail", "auto")
                }
            })
        else:
            processed_content.append(item)
    
    return processed_content
