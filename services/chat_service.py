# chat_service.py - Complete module with Azure AI Search integration

import os
import json
import logging
import asyncio
from time import perf_counter
from typing import List, Dict, Any, Optional

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

# Retrieve file content and metadata for use in chat context
async def get_file_context(
    session_id: str,
    file_ids: List[str],
    db_session: AsyncSession
) -> List[Dict[str, Any]]:
    """
    Retrieve file content and metadata for use in chat context.
    
    Args:
        session_id: Current session ID.
        file_ids: List of file IDs to include, or empty to include all.
        db_session: Database session.
        
    Returns:
        List of file objects with content and metadata.
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
                        except Exception:
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
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except Exception:
                            metadata = {}
                    
                    file_context.append({
                        "filename": filename,
                        "content": content,
                        "metadata": metadata
                    })
        return file_context
    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        return []

def format_messages(chat_message: ChatMessage, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Build the list of formatted messages for the API.
    
    Args:
        chat_message: The current chat message.
        history: List of previous messages (each with role and content).
        
    Returns:
        A list of formatted message dictionaries.
    """
    formatted = []
    if hasattr(chat_message, 'developer_config') and chat_message.developer_config:
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
    Build the parameters dictionary for the Azure OpenAI API call with Azure AI Search integration.
    """
    # Model configuration
    MODEL_CONFIG = {
        "o1": {
            "max_tokens": 40000,
            "temperature": 1.0,
            "reasoning_effort": chat_message.reasoning_effort.value if chat_message.reasoning_effort else "medium"
        },
        "deepseek-r1": {
            "max_tokens": 4096,
            "temperature": 0.7,
            "top_p": 0.9,
            "frequency_penalty": 0.2
        }
    }
    
    # Base parameters
    model_params = MODEL_CONFIG.get(model_name.lower(), MODEL_CONFIG["deepseek-r1"])
    params = {
        "azure_deployment": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "messages": formatted_messages,
        "stream": validate_streaming(model_name),
        "api_version": "2024-05-01-preview",
        **model_params
    }
    
    # Add response format if specified
    if hasattr(chat_message, 'response_format') and chat_message.response_format:
        params["response_format"] = {"type": chat_message.response_format}
    
    # Add Azure AI Search integration if requested
    if use_file_search and session_id:
        try:
            # Get Azure Search endpoint from environment variables
            azure_search_endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
            azure_search_key = os.getenv("AZURE_SEARCH_KEY")
            
            if not azure_search_endpoint or not azure_search_key:
                logger.error("Azure Search credentials missing. Required env vars: AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY")
                raise ValueError("Azure Search configuration incomplete")
            azure_search_index = f"index-{session_id}"  # Index naming convention
            
            # If Azure Search credentials are available
            if azure_search_endpoint:
                params["data_sources"] = [{
                    "type": "azure_search",
                    "parameters": {
                        "endpoint": azure_search_endpoint,
                        "index_name": azure_search_index,
                        "authentication": {
                            "type": "system_assigned_managed_identity"
                        },
                        "query_type": "vector_semantic_hybrid",
                        "fields_mapping": config.AZURE_SEARCH_FIELDS,
                        "strictness": 3,
                        # Use repr() to properly quote file_ids without backslashes in the f-string.
                        "filter": f"id in [{','.join([repr(file_id) for file_id in file_ids])}]" if file_ids and len(file_ids) > 0 else None
                    }
                }]
                logger.info(f"Added Azure AI Search integration with index {azure_search_index}")
            else:
                logger.warning("Azure Search credentials not available. Skipping search integration.")
        except Exception as e:
            logger.error(f"Error setting up Azure AI Search: {e}")
    
    return params

async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: AzureOpenAI,
) -> dict:
    """
    Process a chat message with integrated Azure AI Search when available.
    
    This function:
      1. Retrieves the conversation history.
      2. Formats the messages for the API.
      3. Handles file context inclusion or Azure AI Search integration.
      4. Builds API parameters and calls the Azure OpenAI API.
      5. Saves the conversation to the database.
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
    
    # Handle file context if requested
    file_context = []
    file_ids: List[str] = []
    use_file_search = False
    
    if hasattr(chat_message, 'include_files') and chat_message.include_files:
        file_ids = chat_message.file_ids if hasattr(chat_message, 'file_ids') and chat_message.file_ids else []
        use_file_search = hasattr(chat_message, 'use_file_search') and chat_message.use_file_search
        
        # If not using file search, include file content directly in the prompt
        if not use_file_search:
            file_context = await get_file_context(session_id, file_ids, db_session)
            
            # Add file context to messages
            if file_context:
                # Find or create a system/developer message
                system_message = next((m for m in formatted_messages if m["role"] in ["developer", "system"]), None)
                if not system_message:
                    system_message = {"role": "developer", "content": ""}
                    formatted_messages.insert(0, system_message)
                
                # Add file context instruction
                file_instruction = "\n\nYou have access to the following files:\n"
                for i, file in enumerate(file_context):
                    file_instruction += f"{i+1}. {file['filename']}\n"
                file_instruction += "\nRefer to these files when answering questions."
                
                # Append instruction to system/developer message
                if isinstance(system_message["content"], str):
                    system_message["content"] += file_instruction
                elif isinstance(system_message["content"], list):
                    system_message["content"].append({"type": "text", "text": file_instruction})
                
                # Append file content to the latest user message
                user_message = formatted_messages[-1]
                if user_message["role"] == "user":
                    file_content_text = "\n\nHere are the contents of the files:\n\n"
                    for i, file in enumerate(file_context):
                        file_content_text += f"[File {i+1}: {file['filename']}]\n{file['content']}\n\n"
                    
                    if isinstance(user_message["content"], str):
                        user_message["content"] += file_content_text
                    elif isinstance(user_message["content"], list):
                        user_message["content"].append({"type": "text", "text": file_content_text})
    
    # Build API parameters with Azure AI Search integration if requested
    # Build base parameters with API version and model config
    params = {
        "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "messages": formatted_messages,
        "stream": validate_streaming(model_name),
        "api_version": config.AZURE_OPENAI_API_VERSION  # Enforce correct API version
    }
    
    # Model-specific parameters with validation
    if is_o_series:
        if not chat_message.reasoning_effort:
            raise HTTPException(400, "reasoning_effort is required for o-series models")
            
        params.update({
            "max_completion_tokens": chat_message.max_completion_tokens or 40000,
            "reasoning_effort": chat_message.reasoning_effort.value,
            "temperature": 1.0  # Required fixed value for o-series
        })
    else:
        params["max_tokens"] = 4096
        
    # Add Azure AI Search integration if requested
    if use_file_search and session_id:
        try:
            azure_search_endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
            azure_search_key = os.getenv("AZURE_SEARCH_KEY")
            azure_search_index = f"index-{session_id}"
            
            if azure_search_endpoint:
                from urllib.parse import quote
                file_filter = f"search.in(id, '{','.join(file_ids)}')" if file_ids else None
                
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
                logger.info(f"Added Azure AI Search integration with index {azure_search_index}")
        except Exception as e:
            logger.error(f"Error setting up Azure AI Search: {e}")
    
    # Validate parameters for o-series models
    if is_o_series:
        if params.get("temperature") is None or params.get("max_completion_tokens") is None:
            raise ValueError("o-series models require temperature and max_completion_tokens parameters")
        if any([params.get("top_p"), params.get("frequency_penalty"), params.get("presence_penalty")]):
            raise ValueError("o-series models don't support top_p, frequency_penalty, or presence_penalty parameters")

    # Execute API call (implement retry logic as needed)
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
    response_logger.info(f"[session {session_id}] Response generated. Length: {len(response.choices[0].message.content)} chars")
    
    # Save conversation to the database
    assistant_msg = response.choices[0].message.content
    user_msg = Conversation(session_id=session_id, role="user", content=chat_message.message)
    assistant_msg_obj = Conversation(session_id=session_id, role="assistant", content=assistant_msg)
    db_session.add(user_msg)
    db_session.add(assistant_msg_obj)
    await db_session.execute(text("UPDATE sessions SET last_activity = NOW() WHERE id = :session_id"), {"session_id": session_id})
    await db_session.commit()
    
    # Build response matching Azure API schema
    final_response = {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "created": int(time.time()),
        "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "system_fingerprint": getattr(response, 'system_fingerprint', ''),
        "object": "chat.completion",
        "choices": [{
            "index": idx,
            "message": {
                "role": "assistant",
                "content": choice.message.content,
                **({"tool_calls": choice.message.tool_calls} if hasattr(choice.message, 'tool_calls') else {})
            },
            "finish_reason": choice.finish_reason,
            "content_filter_results": getattr(choice, 'content_filter_results', {})
        } for idx, choice in enumerate(response.choices)],
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
