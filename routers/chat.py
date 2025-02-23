# chat.py (or routers/chat.py)

import json
import uuid
import time

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db_session
from clients import get_model_client
from logging_config import logger
import config

# If you have custom models or schemas:
#   from models import ChatMessage, CreateChatCompletionRequest, ChatCompletionResponse, Conversation
# or define them inline if you prefer.
from models import (
    ChatMessage,
    CreateChatCompletionRequest,
    ChatCompletionResponse,
    Conversation
)

router = APIRouter(prefix="/chat")


class ChatRequest(BaseModel):
    """
    Example request body for a streaming or custom chat endpoint.
    """
    message: str
    session_id: str
    model: str = None         # optional model override
    reasoning_effort: str = "medium"
    include_files: bool = False


@router.post("/")
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    api_version: str = Query(..., alias="api-version"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Creates a single chat completion in a non-streaming (standard) manner,
    returning a ChatCompletionResponse following Azure OpenAI style.
    """
    # Validate requested API version
    if api_version != config.AZURE_OPENAI_API_VERSION:
        logger.error(f"[ChatRouter] API version mismatch: {api_version} vs {config.AZURE_OPENAI_API_VERSION}")
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "invalid_request_error",
                    "message": f"Unsupported or invalid API version: {api_version}",
                    "type": "invalid_request_error"
                }
            }
        )

    # Get model name or fallback to default from config
    model_name = request.model or config.AZURE_OPENAI_DEPLOYMENT_NAME

    if model_name not in config.MODEL_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "invalid_request_error",
                    "message": f"Unsupported model: {model_name}",
                    "type": "invalid_request_error"
                }
            }
        )

    # Acquire AzureOpenAI client
    client = await get_model_client(model_name)

    # Build an internal ChatMessage object from the request
    #   (Assuming your "ChatMessage" model can handle these fields.)
    chat_message = ChatMessage(
        message=request.messages[-1]["content"],
        session_id=request.session_id,
        developer_config=request.developer_config,
        reasoning_effort=request.reasoning_effort,
        include_files=request.include_files,
        response_format=getattr(request, 'response_format', None),
        max_completion_tokens=getattr(request, 'max_completion_tokens', None),
        temperature=getattr(request, 'temperature', None)
    )

    # The function that calls the client or orchestrates the chat logic is typically in services.chat_service
    from services.chat_service import process_chat_message
    response_data = await process_chat_message(
        chat_message=chat_message,
        db_session=db,
        azure_client=client,
        model_name=model_name
    )

    # Return a typed ChatCompletionResponse object
    return ChatCompletionResponse(**response_data)


@router.post("/stream")
async def stream_chat_response(
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    """
    SSE-style streaming endpoint for models that support streaming.
    Yields incremental chunks of content in text/event-stream format.
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
                        "message": "Missing required fields: 'message', 'session_id'",
                        "type": "validation_error"
                    }
                }
            )

        model_config = config.MODEL_CONFIGS.get(model_name)
        if not (model_config and model_config.get("supports_streaming", False)):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": f"Streaming not supported for model: {model_name}",
                        "type": "validation_error"
                    }
                }
            )

        reasoning_effort = request_data.get("reasoning_effort", "medium")
        if reasoning_effort not in ["low", "medium", "high"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": "Invalid 'reasoning_effort' value",
                        "allowed_values": ["low", "medium", "high"],
                        "type": "validation_error"
                    }
                }
            )

        # Acquire AzureOpenAI client
        client = await get_model_client(model_name)

        # Return an SSE streaming response
        return StreamingResponse(
            generate_stream_chunks(message, client, model_name, reasoning_effort, db, session_id),
            media_type="text/event-stream",
            headers={
                "X-Accel-Buffering": "no",
                "Cache-Control": "no-cache"
            }
        )

    except Exception as e:
        logger.exception("[ChatRouter] Error in /chat/stream endpoint")
        raise HTTPException(status_code=500, detail=str(e))


async def generate_stream_chunks(
    message: str,
    client: "AzureOpenAI",
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str
):
    """
    Async generator that yields SSE data chunks from Azure OpenAI streaming responses.
    """
    from models import Conversation  # If you store the conversation in DB
    model_config = config.MODEL_CONFIGS[model_name]

    params = {
        "messages": [{"role": "user", "content": message}],
        "stream": True,
        "max_tokens": model_config.get("max_tokens", 4096),
    }

    # If the model supports temperature, pass it; otherwise reasoning_effort param
    if model_config.get("supports_temperature", True):
        # Example: default temperature 0.7
        params["temperature"] = 0.7
    else:
        # Some "o-series" or "DeepSeek" might want a "reasoning_effort" param
        params["reasoning_effort"] = reasoning_effort

    full_content = ""

    try:
        response = await client.chat.completions.create(**params)

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
                    content_part = choice.delta.content
                    full_content += content_part
                    partial["delta"]["content"] = content_part
                if getattr(choice.delta, "role", None):
                    partial["delta"]["role"] = choice.delta.role
                if getattr(choice.delta, "tool_calls", None):
                    partial["delta"]["tool_calls"] = choice.delta.tool_calls

                if hasattr(choice, "content_filter_results"):
                    partial["content_filter_results"] = choice.content_filter_results

                chunk_choices.append(partial)

            response_data["choices"] = chunk_choices
            yield f"data: {json.dumps(response_data)}\n\n"

        # After the stream completes, store conversation in DB if there's content
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
                {"session_id": session_id, "model_name": model_name}
            )
            await db.commit()

    except Exception as e:
        logger.exception("[ChatRouter] SSE streaming error")
        error_payload = {"error": str(e)}
        yield f"data: {json.dumps(error_payload)}\n\n"


@router.get("/model/capabilities")
async def get_model_capabilities(model: str = Query(None, description="Model to get capabilities for")):
    """
    Get capabilities (streaming, temperature, max_tokens, etc.)
    for a specific model or all available models in config.MODEL_CONFIGS.
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
                "api_version": model_config.get("api_version", config.AZURE_OPENAI_API_VERSION),
            }
        }
    else:
        # Return capabilities for all models
        return {
            name: {
                "supports_streaming": cfg.get("supports_streaming", False),
                "supports_temperature": cfg.get("supports_temperature", True),
                "max_tokens": cfg.get("max_tokens", 4096),
                "api_version": cfg.get("api_version", config.AZURE_OPENAI_API_VERSION),
            }
            for name, cfg in config.MODEL_CONFIGS.items()
        }
