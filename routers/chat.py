# routers/chat.py

import json
import uuid
import time

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from clients import get_model_client
from models import ChatMessage, CreateChatCompletionRequest, ChatCompletionResponse
from services.chat_service import process_chat_message
from errors import create_error_response
from logging_config import logger
import config

router = APIRouter(prefix="/chat")

class ChatRequest(BaseModel):
    """
    Example: an alternate request body for streaming or custom endpoints,
    contains user message, session_id, etc.
    """
    message: str
    session_id: str
    model: str = None  # Optional model selection
    reasoning_effort: str = "medium"
    include_files: bool = False

@router.post("/")
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    api_version: str = Query(..., alias="api-version"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Receives a CreateChatCompletionRequest from the client, 
    validates the API version, merges any developer_config, etc.
    Returns a ChatCompletionResponse following usual Azure OpenAI style.
    """
    # Validate requested API version
    if api_version != config.AZURE_OPENAI_API_VERSION:
        logger.error(f"API version mismatch: {api_version} vs {config.AZURE_OPENAI_API_VERSION}")
        raise create_error_response(
            status_code=400,
            code="invalid_request_error",
            message="Unsupported or invalid API version",
            error_type="invalid_request_error"
        )

    # Get model name from request or use default
    model_name = request.model or config.AZURE_OPENAI_DEPLOYMENT_NAME
    
    # Validate model name
    if model_name not in config.MODEL_CONFIGS:
        raise create_error_response(
            status_code=400,
            code="invalid_request_error",
            message=f"Unsupported model: {model_name}",
            error_type="invalid_request_error"
        )

    # Get appropriate client for the model
    client = await get_azure_client(model_name)

    # Build an internal ChatMessage object from the request
    chat_message = ChatMessage(
        message=request.messages[-1]["content"],
        session_id=request.session_id,
        developer_config=request.developer_config,
        reasoning_effort=request.reasoning_effort,
        include_files=request.include_files,
        response_format=request.response_format if hasattr(request, 'response_format') else None,
        max_completion_tokens=request.max_completion_tokens if hasattr(request, 'max_completion_tokens') else None,
        temperature=request.temperature if hasattr(request, 'temperature') else None
    )

    # Process the chat message with the specified model
    response_data = await process_chat_message(
        chat_message=chat_message,
        db_session=db,
        azure_client=client,
        model_name=model_name
    )

    return ChatCompletionResponse(**response_data)

@router.post("/stream")
async def stream_chat_response(
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    """
    SSE-style streaming endpoint for models that support it.
    """
    try:
        request_data = await request.json()
        message = request_data.get("message")
        session_id = request_data.get("session_id")
        model_name = request_data.get("model", config.AZURE_OPENAI_DEPLOYMENT_NAME)

        if not message or not session_id:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": "Missing required fields",
                        "fields": ["message", "session_id"],
                        "type": "validation_error"
                    }
                }
            )

        # Validate model supports streaming
        model_config = config.MODEL_CONFIGS.get(model_name)
        if not model_config or not model_config.get("supports_streaming", False):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": f"Streaming not supported for model: {model_name}",
                        "type": "validation_error"
                    }
                }
            )

        # Get appropriate client
        client = await get_azure_client(model_name)

        # Validate reasoning_effort
        reasoning_effort = request_data.get("reasoning_effort", "medium")
        if reasoning_effort not in ["low", "medium", "high"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": "Invalid reasoning_effort value",
                        "allowed_values": ["low", "medium", "high"],
                        "type": "validation_error"
                    }
                }
            )

        return StreamingResponse(
            generate(message, client, model_name, reasoning_effort, db, session_id),
            media_type="text/event-stream",
            headers={
                "X-Accel-Buffering": "no",
                "Cache-Control": "no-cache"
            }
        )

    except Exception as e:
        logger.error(f"Error in stream endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def generate(
    message: str,
    client: "AsyncAzureOpenAI",
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str
):
    """
    Generator for SSE chunked streaming.
    """
    model_config = config.MODEL_CONFIGS[model_name]

    # Build the minimal parameters needed for AzureOpenAI call
    params = {
        "messages": [{"role": "user", "content": message}],
        "stream": True,
        "max_tokens": model_config["max_tokens"]
    }

    # Add model-specific parameters
    if model_config.get("supports_temperature", True):
        params["temperature"] = 0.7
    else:
        params["reasoning_effort"] = reasoning_effort

    try:
        response = await client.chat.completions.create(**params)

        # Track the message content for saving
        full_content = ""

        async for chunk in response:
            response_data = {
                "id": f"chatcmpl-{uuid.uuid4()}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model_name,
                "system_fingerprint": getattr(response, "system_fingerprint", ""),
                "choices": []
            }

            chunk_choices = []
            for idx, choice in enumerate(chunk.choices):
                partial = {
                    "index": idx,
                    "delta": {},
                    "finish_reason": choice.finish_reason
                }

                if getattr(choice.delta, "content", None):
                    content = choice.delta.content
                    full_content += content
                    partial["delta"]["content"] = content
                if getattr(choice.delta, "role", None):
                    partial["delta"]["role"] = choice.delta.role
                if getattr(choice.delta, "tool_calls", None):
                    partial["delta"]["tool_calls"] = choice.delta.tool_calls

                if hasattr(choice, "content_filter_results"):
                    partial["content_filter_results"] = choice.content_filter_results

                chunk_choices.append(partial)

            response_data["choices"] = chunk_choices
            yield f"data: {json.dumps(response_data)}\n\n"

        # Save the conversation to the database
        if full_content:
            user_msg = Conversation(
                session_id=session_id,
                role="user",
                content=message,
                model=model_name
            )
            assistant_msg = Conversation(
                session_id=session_id,
                role="assistant",
                content=full_content,
                model=model_name
            )
            db.add(user_msg)
            db.add(assistant_msg)
            
            await db.execute(
                text("""
                    UPDATE sessions 
                    SET last_activity = NOW(),
                        last_model = :model_name
                    WHERE id = :session_id
                """),
                {
                    "session_id": session_id,
                    "model_name": model_name
                }
            )
            await db.commit()

    except Exception as e:
        error_payload = {"error": str(e)}
        yield f"data: {json.dumps(error_payload)}\n\n"

@router.get("/model/capabilities")
async def get_model_capabilities(
    model: str = Query(None, description="Model to get capabilities for")
):
    """
    Get capabilities for a specific model or all available models.
    """
    if model:
        if model not in config.MODEL_CONFIGS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown model: {model}"
            )
        model_config = config.MODEL_CONFIGS[model]
        return {
            "model": model,
            "capabilities": {
                "supports_streaming": model_config.get("supports_streaming", False),
                "supports_temperature": model_config.get("supports_temperature", True),
                "max_tokens": model_config.get("max_tokens", 4096),
                "api_version": config.AZURE_OPENAI_API_VERSION
            }
        }
    else:
        # Return capabilities for all models
        return {
            name: {
                "supports_streaming": cfg.get("supports_streaming", False),
                "supports_temperature": cfg.get("supports_temperature", True),
                "max_tokens": cfg.get("max_tokens", 4096)
            }
            for name, cfg in config.MODEL_CONFIGS.items()
        }
