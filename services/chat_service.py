# chat_service.py

import os
import json
import logging
import asyncio
import uuid
import time
from time import perf_counter
from typing import List, Dict, Any, Optional
from urllib.parse import quote

from openai import AzureOpenAI
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

import config
from models import ChatMessage
from utils import count_tokens, calculate_model_timeout, validate_streaming
from logging_config import input_logger, response_logger, logger
from errors import create_error_response
from database import Conversation

# ----------------------------------------------------------------------------------
# 1. Retrieve file content and metadata for use in chat context
# ----------------------------------------------------------------------------------

async def get_file_context(
    session_id: str,
    file_ids: List[str],
    db_session: AsyncSession
) -> List[Dict[str, Any]]:
    """
    Retrieve file content and metadata for use in the chat context.
    """
    file_context = []
    try:
        # If no specific files requested, include all "ready" session files.
        if not file_ids:
            result = await db_session.execute(
                text("""
                    SELECT id FROM uploaded_files 
                    WHERE session_id = :session_id 
                      AND (status = 'ready' OR status IS NULL)
                      AND (metadata IS NULL 
                           OR metadata->>'azure_processing' != 'failed')
                """),
                {"session_id": session_id}
            )
            file_ids = [str(row[0]) for row in result.fetchall()]

        for file_id in file_ids:
            # Check if this file has chunks
            result = await db_session.execute(
                text("""
                    SELECT chunk_count, filename 
                    FROM uploaded_files 
                    WHERE id = :file_id::uuid
                """),
                {"file_id": file_id}
            )
            file_info = result.fetchone()
            if not file_info:
                continue  # If the file wasn't found, skip

            chunk_count, filename = file_info
            if chunk_count and chunk_count > 1:
                # Retrieve each chunk if the file was split
                result = await db_session.execute(
                    text("""
                        SELECT uf.content, uf.filename, uf.metadata
                        FROM uploaded_files uf
                        WHERE uf.status = 'chunk'
                          AND uf.metadata->>'parent_file_id' = :parent_id
                        ORDER BY (uf.metadata->>'chunk_index')::int
                    """),
                    {"parent_id": file_id}
                )
                chunks = result.fetchall()

                # Process each chunk
                for i, (content, chunk_filename, metadata) in enumerate(chunks):
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except Exception:
                            metadata = {}

                    file_context.append({
                        "filename": f"{filename} (chunk {i+1}/{len(chunks)})",
                        "content": content,
                        "metadata": metadata
                    })

            else:
                # Single-file scenario
                result = await db_session.execute(
                    text("""
                        SELECT content, filename, metadata 
                        FROM uploaded_files 
                        WHERE id = :file_id::uuid
                    """),
                    {"file_id": file_id}
                )
                file_data = result.fetchone()
                if file_data:
                    content, single_filename, metadata = file_data
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except Exception:
                            metadata = {}
                    file_context.append({
                        "filename": single_filename,
                        "content": content,
                        "metadata": metadata
                    })

        return file_context

    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        return []


# ----------------------------------------------------------------------------------
# 2. Format messages for OpenAI Chat Completion
# ----------------------------------------------------------------------------------

def format_messages(chat_message: ChatMessage, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Build the list of formatted messages for the Azure OpenAI API.
    """
    formatted = []

    # If there's developer_config, prepend it as a "developer" role message
    if getattr(chat_message, 'developer_config', None):
        formatted.append({
            "role": "developer" if is_o_series else "system",
            "content": chat_message.developer_config
        })

    # Add conversation history
    for msg in history:
        formatted.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    # Finally, add the current user's message
    formatted.append({
        "role": "user",
        "content": chat_message.message
    })

    return formatted


# ----------------------------------------------------------------------------------
# 3. Build API Params (consolidating Azure AI Search logic)
# ----------------------------------------------------------------------------------

async def build_api_params_with_search(
    formatted_messages: List[Dict[str, Any]], 
    chat_message: ChatMessage, 
    model_name: str, 
    is_o_series: bool,
    file_ids: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    use_file_search: bool = False
) -> Dict[str, Any]:
    """
    Build the parameters for the Azure OpenAI Chat Completion API call,
    optionally integrating Azure AI Search if requested.
    """

    deployment_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

    # 1) Basic parameters
    # The library expects 'model' to be your deployment name for Azure
    params: Dict[str, Any] = {
        # Our format_messages() used the new "multi-part content" style:
        "messages": formatted_messages,
    }

    # For streaming or not
    # If it's an o-series (o1), streaming is generally not supported,
    # so we forcibly disable. Otherwise, use validate_streaming logic.
    if is_o_series:
        params["stream"] = False
    else:
        params["stream"] = validate_streaming(deployment_name)

    # 2) Model-specific checks
    if is_o_series:
        # For o-series, we can’t pass temperature, top_p, presence_penalty, or frequency_penalty
        # The doc also says we must pass "reasoning_effort" and "max_completion_tokens".
        params["max_completion_tokens"] = chat_message.max_completion_tokens or 40000

    else:
        # For non-o-series, default to max_tokens=4096
        params["max_tokens"] = 4096
        # If your model supports these, pass them along if set
        if getattr(chat_message, 'temperature', None) is not None:
            params["temperature"] = chat_message.temperature
        else:
            params["temperature"] = 0.7

        if getattr(chat_message, 'top_p', None) is not None:
            params["top_p"] = chat_message.top_p
        if getattr(chat_message, 'frequency_penalty', None) is not None:
            params["frequency_penalty"] = chat_message.frequency_penalty
        if getattr(chat_message, 'presence_penalty', None) is not None:
            params["presence_penalty"] = chat_message.presence_penalty

    # 3) Optional "structured outputs" or "json_schema" usage
    if getattr(chat_message, 'response_format', None):
        params["response_format"] = {"type": chat_message.response_format}

    # 4) Azure Search Integration if requested
    #    The new "data_sources" param is recognized by Azure chat extension
    if use_file_search and session_id:
        azure_search_endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
        azure_search_key = os.getenv("AZURE_SEARCH_KEY")
        if not azure_search_endpoint or not azure_search_key:
            logger.error(
                "Azure Search credentials missing. "
                "Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY."
            )
            raise ValueError("Azure Search configuration incomplete")

        azure_search_index = f"index-{session_id}"  # Example index naming
        file_filter = None
        if file_ids:
            # Build a simple search filter for the requested file IDs
            file_filter = f"search.in(id, '{','.join(file_ids)}')"

        # Data source config
        params["data_sources"] = [{
            "type": "azure_search",
            "parameters": {
                "endpoint": azure_search_endpoint,
                "index_name": azure_search_index,
                "authentication": {
                    "type": "api_key",
                    "key": azure_search_key
                },
                "query_type": "vector_semantic_hybrid",
                "fields_mapping": {
                    "content_fields": ["content"],
                    "title_field": "filename",
                    "url_field": "filepath"
                },
                "strictness": 3,
                "top_n_documents": 5,
                "filter": quote(file_filter) if file_filter else None
            }
        }]
        logger.info(f"Added Azure AI Search integration for index: {azure_search_index}")

    return params


# ----------------------------------------------------------------------------------
# 4. Main Chat Processing
# ----------------------------------------------------------------------------------

async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: AzureOpenAI,
) -> dict:
    """
    Process a chat message with optional Azure AI Search integration.
    """

    start_time = perf_counter()
    session_id = chat_message.session_id
    logger.info(f"[session {session_id}] Chat request received")

    input_logger.info(
        f"[session {session_id}] Message received. Length: {len(chat_message.message)} chars"
    )

    # 1) Retrieve conversation history
    result = await db_session.execute(
        text("""
            SELECT role, content
            FROM conversations
            WHERE session_id = :session_id
            ORDER BY timestamp ASC
        """),
        {"session_id": session_id},
    )
    history = result.mappings().all()

    # 2) Format messages for the API
    formatted_messages = format_messages(chat_message, history)

    # 3) Determine if it’s an o-series
    model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME
    is_o_series = (
        any(m in model_name.lower() for m in ["o1-", "o3-"])
        and "preview" not in model_name.lower()
    )

    # 4) Possibly inject file context or set up file search
    file_context = []
    file_ids: List[str] = []
    use_file_search = False

    if getattr(chat_message, 'include_files', False):
        file_ids = getattr(chat_message, 'file_ids', []) or []
        use_file_search = getattr(chat_message, 'use_file_search', False)

        if not use_file_search:
            file_context = await get_file_context(session_id, file_ids, db_session)
            if file_context:
                # Insert or update dev/system message about the files
                system_message = next(
                    (m for m in formatted_messages if m["role"] in ["developer", "system"]),
                    None
                )
                if not system_message:
                    system_message = {"role": "developer", "content": []}
                    formatted_messages.insert(0, system_message)

                file_instruction = "\n\nYou have access to the following files:\n"
                for i, file in enumerate(file_context):
                    file_instruction += f"{i+1}. {file['filename']}\n"
                file_instruction += "\nRefer to these files when answering questions."

                # If content is list-based, add a text part
                if isinstance(system_message.get("content"), list):
                    system_message["content"].append({"type": "text", "text": file_instruction})
                else:
                    # Convert to list if needed
                    existing = system_message.get("content") or ""
                    system_message["content"] = [
                        {"type": "text", "text": existing + file_instruction}
                    ]

                # Append actual file content to user’s message
                user_message = formatted_messages[-1]
                if user_message["role"] == "user":
                    file_content_text = "\n\nHere are the contents of the files:\n\n"
                    for i, file in enumerate(file_context):
                        file_content_text += (
                            f"[File {i+1}: {file['filename']}]\n{file['content']}\n\n"
                        )
                    # If user_message content is list
                    if isinstance(user_message["content"], list):
                        user_message["content"].append({"type": "text", "text": file_content_text})
                    else:
                        existing_text = user_message.get("content") or ""
                        user_message["content"] = [
                            {"type": "text", "text": existing_text + file_content_text}
                        ]

    # 5) Build API parameters
    try:
        params = await build_api_params_with_search(
            formatted_messages=formatted_messages,
            chat_message=chat_message,
            model_name=model_name,
            is_o_series=is_o_series,
            file_ids=file_ids,
            session_id=session_id,
            use_file_search=use_file_search
        )
    except Exception as e:
        logger.error(f"Error building API params: {e}")
        raise create_error_response(
            status_code=503,
            code="param_build_error",
            message="Failed to build API parameters",
            error_type="ParameterError",
            inner_error=str(e)
        )

    # 6) Execute the API call
    try:
        response = azure_client.chat.completions.create(**params)
    except Exception as e:
        logger.error(f"Error during API call: {e}")
        raise create_error_response(
            status_code=503,
            code="service_error",
            message="Error during API call",
            error_type="api_call_error",
            inner_error=str(e)
        )

    elapsed = perf_counter() - start_time
    logger.info(f"[session {session_id}] Chat completed in {elapsed:.2f}s")
    response_logger.info(
        f"[session {session_id}] Response generated. Length: {len(response.choices[0].message.content)} chars"
    )

    # 7) Save the conversation to the DB
    assistant_msg = response.choices[0].message.content
    user_msg_entry = Conversation(session_id=session_id, role="user", content=chat_message.message)
    assistant_msg_entry = Conversation(session_id=session_id, role="assistant", content=assistant_msg)
    db_session.add(user_msg_entry)
    db_session.add(assistant_msg_entry)

    await db_session.execute(
        text("UPDATE sessions SET last_activity = NOW() WHERE id = :session_id"),
        {"session_id": session_id}
    )
    await db_session.commit()

    # 8) Build final response in an AzureOpenAI-like shape
    final_response = {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "created": int(time.time()),
        "model": model_name,
        "system_fingerprint": getattr(response, 'system_fingerprint', ''),
        "object": "chat.completion",
        "choices": [
            {
                "index": idx,
                "message": {
                    "role": "assistant",
                    "content": choice.message.content,
                    **({"tool_calls": choice.message.tool_calls} if hasattr(choice.message, 'tool_calls') else {})
                },
                "finish_reason": choice.finish_reason,
                "content_filter_results": getattr(choice, 'content_filter_results', {})
            }
            for idx, choice in enumerate(response.choices)
        ],
        "usage": {
            "completion_tokens": response.usage.completion_tokens,
            "prompt_tokens": response.usage.prompt_tokens,
            "total_tokens": response.usage.total_tokens,
            "completion_tokens_details": {
                "reasoning_tokens": getattr(response.usage, 'reasoning_tokens', None)
            },
            "prompt_tokens_details": {
                "cached_tokens": getattr(response.usage, 'cached_tokens', 0)
            }
        },
        "prompt_filter_results": getattr(response, 'prompt_filter_results', [])
    }

    return final_response