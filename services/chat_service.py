# services/chat_service.py
import asyncio
from urllib.parse import urlparse
import mimetypes
from openai import AzureOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import List, Dict, Any, Optional
import json
from models import ChatMessage
from utils import count_tokens, calculate_model_timeout
from logging_config import input_logger, response_logger, logger
from errors import create_error_response
from database import Conversation
import config
from time import perf_counter

async def get_file_context(
    session_id: str,
    file_ids: List[str],
    db_session
) -> List[Dict[str, Any]]:
    """
    Retrieve file content and metadata for use in chat context
    
    Args:
        session_id: Current session ID
        file_ids: List of file IDs to include, or empty to include all
        db_session: Database session
        
    Returns:
        List of file objects with content and metadata
    """
    file_context = []
    
    try:
        # If no specific files requested, include all session files
        if not file_ids:
            result = await db_session.execute(
                text("""
                    SELECT id FROM uploaded_files 
                    WHERE session_id = :session_id 
                    AND (status = 'ready' OR status IS NULL)
                    AND (metadata IS NULL OR metadata->>'azure_processing' != 'failed')
                """),
                {"session_id": session_id}
            )
            file_ids = [str(row[0]) for row in result.fetchall()]
        
        # Retrieve file content for each file (or its chunks)
        for file_id in file_ids:
            # First check if this file has chunks
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
                continue  # File not found
                
            chunk_count, filename = file_info
            
            if chunk_count and chunk_count > 1:
                # This file has chunks - get them
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
                    # Parse metadata if needed
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except:
                            metadata = {}
                    
                    # Add to context
                    file_context.append({
                        "filename": f"{filename} (chunk {i+1}/{len(chunks)})",
                        "content": content,
                        "metadata": metadata
                    })
            else:
                # Single file - get content directly
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
                    content, filename, metadata = file_data
                    
                    # Parse metadata if needed
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except:
                            metadata = {}
                    
                    # Add to context
                    file_context.append({
                        "filename": filename,
                        "content": content,
                        "metadata": metadata
                    })
        
        return file_context
    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        return []

def format_messages(chat_message, history):
    """
    Build the list of formatted messages for the API.
    """
    formatted = []
    if chat_message.developer_config:
        formatted.append({
            "role": "developer",
            "content": [{"type": "text", "text": chat_message.developer_config}],
        })
    for msg in history:
        formatted.append({
            "role": msg["role"],
            "content": [{"type": "text", "text": msg["content"]}],
        })
    formatted.append({
        "role": "user",
        "content": [{"type": "text", "text": chat_message.message}],
    })
    return formatted

# Define a centralized model configuration registry
MODEL_CONFIGS = {
    "o3": {
        "api_version": config.AZURE_OPENAI_API_VERSION,
        "max_completion_tokens_default": 40000,
        "max_completion_tokens_limit": 100000,
        "supports_streaming": True,
        "supports_vision": False
    },
    "o1": {
        "api_version": config.AZURE_OPENAI_API_VERSION,
        "max_completion_tokens_default": 40000,
        "max_completion_tokens_limit": 100000,
        "supports_streaming": True,
        "supports_vision": True
    },
    "default": {
        "api_version": "2023-12-01",
        "max_tokens_default": 4096,
        "max_tokens_limit": 16384,
        "supports_streaming": True,
        "supports_vision": False
    }
}

def get_model_config():
    model_id = config.AZURE_OPENAI_DEPLOYMENT_NAME.split('-')[0].lower()
    return MODEL_CONFIGS.get(model_id, MODEL_CONFIGS["default"])

def build_api_params(formatted_messages, chat_message, model_name, is_o_series):
    """
    Build the parameters dictionary for the Azure OpenAI API call using the centralized model configuration.
    """
    model_conf = get_model_config()
    params = {
        "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "messages": formatted_messages,
        "stream": model_conf.get("supports_streaming", False),
    }
    if is_o_series:
        params["max_completion_tokens"] = model_conf.get("max_completion_tokens_default", 40000)
        params["reasoning_effort"] = chat_message.reasoning_effort.value if chat_message.reasoning_effort else "low"
    else:
        params["max_tokens"] = model_conf.get("max_tokens_default", 4096)
    if chat_message.response_format:
        params["response_format"] = {"type": chat_message.response_format}
    return params

async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: AzureOpenAI,
) -> dict:
    """
    Process a chat message with file context integration, handling:
    - Conversation history retrieval
    - File context processing
    - Azure OpenAI API calls
    - Response formatting and error handling
    """
    
    # Get file context if available
    file_context = []
    if hasattr(chat_message, 'include_files') and chat_message.include_files:
        file_ids = chat_message.file_ids if hasattr(chat_message, 'file_ids') and chat_message.file_ids else []
        file_context = await get_file_context(session_id, file_ids, db_session)
    
    # Add file context to messages
    if file_context:
        # Find or create developer/system message
        system_message = next((m for m in formatted_messages if m["role"] in ["developer", "system"]), None)
        if not system_message:
            system_message = {"role": "developer", "content": ""}
            formatted_messages.insert(0, system_message)
        
        # Add file context instruction
        file_instruction = "\n\nYou have access to the following files:\n"
        for i, file in enumerate(file_context):
            file_instruction += f"{i+1}. {file['filename']}\n"
        
        file_instruction += "\nRefer to these files when answering questions. Use information from the files to provide detailed responses."
        
        # Append to developer/system message
        if isinstance(system_message["content"], str):
            system_message["content"] += file_instruction
        elif isinstance(system_message["content"], list):
            system_message["content"].append({"type": "text", "text": file_instruction})
        
        # Add file content to latest user message
        user_message = formatted_messages[-1]
        if user_message["role"] == "user":
            file_content_text = "\n\nHere is the content of the files:\n\n"
            for i, file in enumerate(file_context):
                file_content_text += f"[File {i+1}: {file['filename']}]\n{file['content']}\n\n"
            
            if isinstance(user_message["content"], str):
                user_message["content"] += file_content_text
            elif isinstance(user_message["content"], list):
                user_message["content"].append({"type": "text", "text": file_content_text})
    
    # Add Azure file search tool support if requested
    use_azure_file_search = hasattr(chat_message, 'use_file_search') and chat_message.use_file_search
    
    # Build API params
    params = build_api_params(formatted_messages, chat_message, model_name, is_o_series)
    
    # Add file tools if using Azure file search
    if use_azure_file_search and azure_client:
        try:
            # Add file search tool
            params["tools"] = params.get("tools", []) + [{"type": "file_search"}]
            
            # Configure Azure AI Search integration
            params["extra_body"] = {
                "data_sources": [{
                    "type": "azure_search",
                    "parameters": {
                        "endpoint": config.AZURE_SEARCH_ENDPOINT,
                        "index_name": f"session-{session_id}",
                        "authentication": {
                            "type": "api_key",
                            "key": config.AZURE_SEARCH_KEY
                        }
                    }
                }]
            }
            
            logger.info(f"Integrated Azure AI Search for session {session_id}")
        except Exception as e:
            logger.error(f"Error setting up file search: {e}")
            # Continue without file search if it fails
    
    """
    Process a chat message by retrieving history, calling the Azure OpenAI API,
    and saving the conversation to the database.
    """
    start_time = perf_counter()
    session_id = chat_message.session_id
    logger.info(f"[session {session_id}] Chat request received")
    input_logger.info(f"[session {session_id}] Message received. Length: {len(chat_message.message)} chars")

    # Retrieve conversation history from the database
    result = await db_session.execute(
        text("SELECT role, content FROM conversations WHERE session_id = :session_id ORDER BY timestamp ASC"),
        {"session_id": session_id},
    )
    history = result.mappings().all()

    # Format messages for the API
    formatted_messages = format_messages(chat_message, history)

    # Determine model type
    model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
    is_o_series = (any(m in model_name for m in ["o1-", "o3-"]) and "preview" not in model_name)

    # Build API parameters
    params = build_api_params(formatted_messages, chat_message, model_name, is_o_series)
    logger.info(f"Using API parameters for {'o-series' if is_o_series else 'standard'} model: {params}")

    # Retry logic for API call
    original_reasoning_effort = params.get("reasoning_effort", "medium")
    retry_attempts = 0
    max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 1
    retry_reasoning_efforts = []
    timeouts_used = []

    while True:
        current_reasoning = params.get("reasoning_effort", "medium")
        timeout = calculate_model_timeout(formatted_messages, model_name, current_reasoning)
        if retry_attempts > 0:
            backoff_multiplier = config.O_SERIES_BACKOFF_MULTIPLIER ** retry_attempts
            timeout *= backoff_multiplier
        timeouts_used.append(timeout)
        logger.info(f"Attempt {retry_attempts+1}/{max_retries+1} with {current_reasoning} reasoning, timeout: {timeout:.1f}s")
        azure_client.timeout = timeout

        try:
            attempt_start = perf_counter()
            if params.get("stream"):
                collected_messages = []
                collected_tokens = {"prompt": 0, "completion": 0, "total": 0}
                async for chunk in azure_client.chat.completions.create(**params):
                    if chunk.choices[0].delta.content is not None:
                        collected_messages.append(chunk.choices[0].delta.content)
                    if hasattr(chunk, "usage"):
                        collected_tokens = {
                            "prompt": chunk.usage.prompt_tokens,
                            "completion": chunk.usage.completion_tokens,
                            "total": chunk.usage.total_tokens
                        }
                response_content = "".join(collected_messages)
                response = type('StreamResponse', (), {
                    'choices': [type('Choice', (), {
                        'message': type('Message', (), {'content': response_content})(),
                        'finish_reason': chunk.choices[0].finish_reason if hasattr(chunk.choices[0], 'finish_reason') else None,
                        'content_filter_results': getattr(chunk.choices[0], 'content_filter_results', None)
                    })()],
                    'usage': type('Usage', (), collected_tokens)(),
                    'system_fingerprint': getattr(chunk, 'system_fingerprint', None),
                    'prompt_filter_results': getattr(chunk, 'prompt_filter_results', None)
                })()
            else:
                response = azure_client.chat.completions.create(**params)
            elapsed = perf_counter() - attempt_start
            logger.info(f"Request completed in {elapsed:.2f}s using {current_reasoning} reasoning")
            break
        except Exception as e:
            elapsed = perf_counter() - attempt_start
            error_msg = str(e).lower()
            retry_reasoning_efforts.append(current_reasoning)
            if retry_attempts >= max_retries:
                logger.exception(f"[session {session_id}] All {retry_attempts+1} attempts failed after {elapsed:.2f}s")
                raise create_error_response(
                    status_code=503,
                    code="service_timeout",
                    message="Service temporarily unavailable - all retry attempts failed",
                    error_type="timeout",
                    inner_error={
                        "original_error": error_msg,
                        "total_elapsed_seconds": perf_counter() - start_time,
                        "reasoning_attempts": [original_reasoning_effort] + retry_reasoning_efforts,
                        "timeouts_used": timeouts_used,
                    },
                )
            retry_attempts += 1
            if is_o_series and current_reasoning != "low":
                if current_reasoning == "high" and retry_attempts == 1:
                    params["reasoning_effort"] = "medium"
                    logger.warning(f"Request timed out after {elapsed:.2f}s with high reasoning. Retrying with medium reasoning.")
                else:
                    params["reasoning_effort"] = "low"
                    logger.warning(f"Request timed out after {elapsed:.2f}s with {current_reasoning} reasoning. Retrying with low reasoning.")
            else:
                logger.warning(f"Request timed out after {elapsed:.2f}s with {current_reasoning} reasoning. Retrying with increased timeout.")

    # Wrap response usage tokens safely
    class AzureResponseWrapper:
        def __init__(self, response):
            self._response = response
        @property
        def prompt_tokens(self):
            return getattr(self._response.usage, 'prompt_tokens', 0)
        @property 
        def completion_tokens(self):
            return getattr(self._response.usage, 'completion_tokens', 0)
        @property
        def total_tokens(self):
            return getattr(self._response.usage, 'total_tokens', 0)
        @property
        def reasoning_tokens(self):
            return getattr(getattr(self._response.usage, 'completion_tokens_details', {}), 'reasoning_tokens', 0)

    elapsed_total = perf_counter() - start_time
    wrapped_response = AzureResponseWrapper(response)
    tokens = {
        "prompt": wrapped_response.prompt_tokens,
        "completion": wrapped_response.completion_tokens,
        "total": wrapped_response.total_tokens,
        "reasoning": wrapped_response.reasoning_tokens,
    }
    logger.info(f"Chat completed in {elapsed_total:.2f}s - Tokens used: {tokens['total']} (prompt: {tokens['prompt']}, completion: {tokens['completion']})")

    assistant_msg = response.choices[0].message.content
    response_logger.info(f"[session {session_id}] Response generated. Length: {len(assistant_msg)} chars. Preview: {assistant_msg[:100]}{'...' if len(assistant_msg) > 100 else ''}")

    # Save conversation to database
    user_msg = Conversation(session_id=session_id, role="user", content=chat_message.message)
    assistant_msg_obj = Conversation(session_id=session_id, role="assistant", content=assistant_msg)
    db_session.add(user_msg)
    db_session.add(assistant_msg_obj)
    await db_session.execute(text("UPDATE sessions SET last_activity = NOW() WHERE id = :session_id"), {"session_id": session_id})
    await db_session.commit()

    final_response = {
        "response": assistant_msg,
        "usage": {
            "prompt_tokens": tokens["prompt"],
            "completion_tokens": tokens["completion"],
            "total_tokens": tokens["total"],
        },
    }
    if is_o_series and hasattr(response.usage, "completion_tokens_details"):
        completion_details = response.usage.completion_tokens_details
        final_response["usage"]["completion_details"] = {
            "reasoning_tokens": getattr(completion_details, "reasoning_tokens", None),
        }
        if hasattr(response.usage, "prompt_tokens_details"):
            final_response["usage"]["prompt_details"] = {
                "cached_tokens": response.usage.prompt_tokens_details.cached_tokens
            }
    if hasattr(response, "choices") and response.choices:
        choice = response.choices[0]
        if hasattr(choice, "finish_reason"):
            final_response["finish_reason"] = choice.finish_reason
        if hasattr(choice, "content_filter_results"):
            final_response["content_filter_results"] = choice.content_filter_results
    if hasattr(response, "system_fingerprint"):
        final_response["system_fingerprint"] = response.system_fingerprint
    if hasattr(response, "prompt_filter_results"):
        final_response["prompt_filter_results"] = response.prompt_filter_results

    return final_response
