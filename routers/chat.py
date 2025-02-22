# routers/chat.py

import json
import uuid
import time

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from clients import get_azure_client
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
    reasoning_effort: str = "medium"
    include_files: bool = False


@router.post("/")
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    api_version: str = Query(..., alias="api-version"),
    db: AsyncSession = Depends(get_db_session),
    client: "AsyncAzureOpenAI" = Depends(get_azure_client)
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

    # Optionally warn if user provided a different model name than expected
    if request.model != config.AZURE_OPENAI_DEPLOYMENT_NAME:
        logger.warning(
            f"Model name mismatch: {request.model} vs {config.AZURE_OPENAI_DEPLOYMENT_NAME}"
        )

    # Build an internal ChatMessage object from the request
    # (We only take the last message's content to store as 'message', for example)
    chat_message = ChatMessage(
        message=request.messages[-1]["content"],
        session_id=request.session_id,  # for your internal state tracking
        developer_config=request.developer_config,
        reasoning_effort=request.reasoning_effort,
        include_files=request.include_files,
        response_format=None,
        max_completion_tokens=request.max_completion_tokens
    )

    # Delegates the heavy-lifting to process_chat_message
    response_data = await process_chat_message(chat_message, db, client)

    # Return the response in a standard shape, e.g. ChatCompletionResponse
    return ChatCompletionResponse(**response_data)


@router.post("/stream")
async def stream_chat_response(
    request: Request,
    client: "AsyncAzureOpenAI" = Depends(get_azure_client)
):
    """
    SSE-style streaming endpoint for certain model types.
    Example scenario: streaming for o3-mini, disallow for o1.
    """

    try:
        request_data = await request.json()
        message = request_data.get("message")
        session_id = request_data.get("session_id", None)

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
            generate(message, client, reasoning_effort),
            media_type="text/event-stream",
            headers={
                "X-Accel-Buffering": "no",
                "Cache-Control": "no-cache"
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def generate(message: str, client: "AsyncAzureOpenAI", reasoning_effort: str = "medium"):
    """
    Generator for SSE chunked streaming. Permitted only for 'o3-mini' in this example.
    """

    deployment_name = config.AZURE_OPENAI_DEPLOYMENT_NAME.lower()

    # Check if this is an o-series model
    is_o_series = any(m in deployment_name for m in ["o1-", "o3-"]) and "preview" not in deployment_name

    # Build the minimal parameters needed for AzureOpenAI call
    params = {
        "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,  # Usually the deployment name
        "messages": [{"role": "user", "content": message}],
        "stream": True
    }

    if is_o_series:
        # For o-series, we can only stream if it's o3-mini (per your logic)
        if "o3-mini" not in deployment_name:
            raise HTTPException(
                status_code=400,
                detail="Streaming only supported for o3-mini models in this deployment."
            )

        # So for o3-mini, we do max_completion_tokens + reasoning_effort
        params["max_completion_tokens"] = 40000
        params["reasoning_effort"] = reasoning_effort
    else:
        # Non-o-series fallback (just an example)
        # E.g. use normal 'max_tokens'
        params["max_tokens"] = 4096

    try:
        # Make the streaming request. The library uses 'model' param 
        # as the deployment ID in AzureOpenAI vs. the standard OpenAI.
        response = await client.chat.completions.create(
            **{k: v for k, v in params.items() if k != "api_version"}
        )

        # SSE chunk emission
        async for chunk in response:
            response_data = {
                "id": f"chatcmpl-{uuid.uuid4()}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
                "system_fingerprint": getattr(response, "system_fingerprint", ""),
                "choices": []
            }

            chunk_choices = []
            for idx, choice in enumerate(chunk.choices):
                # Build partial response object
                partial = {
                    "index": idx,
                    "delta": {},
                    "finish_reason": choice.finish_reason
                }

                if getattr(choice.delta, "content", None):
                    partial["delta"]["content"] = choice.delta.content
                if getattr(choice.delta, "role", None):
                    partial["delta"]["role"] = choice.delta.role
                if getattr(choice.delta, "tool_calls", None):
                    partial["delta"]["tool_calls"] = choice.delta.tool_calls

                # Optionally attach content_filter_results
                if hasattr(choice, "content_filter_results"):
                    partial["content_filter_results"] = choice.content_filter_results

                chunk_choices.append(partial)

            response_data["choices"] = chunk_choices
            yield f"data: {json.dumps(response_data)}\n\n"

    except Exception as e:
        # Return an SSE-friendly error
        error_payload = {"error": str(e)}
        yield f"data: {json.dumps(error_payload)}\n\n"


@router.get("/model/capabilities")
async def get_model_capabilities():
    """
    Example endpoint to retrieve various model capabilities
    like streaming, vision, max tokens, etc.
    """
    deployment_name = config.AZURE_OPENAI_DEPLOYMENT_NAME.lower()
    is_o_series = any(m in deployment_name for m in ["o1-", "o3-"])

    return {
        "model": deployment_name,
        "capabilities": {
            # "o3-mini" in the name means we allow streaming
            "supports_streaming": "o3-mini" in deployment_name,
            # "o1" in the name means we interpret as vision support in your scenario
            "supports_vision": "o1" in deployment_name,
            # For example, 40000 tokens for an o-series big context,
            # or fallback 4096 for older or standard models
            "max_tokens": 40000 if is_o_series else 4096,
            # The selected API version
            "api_version": config.AZURE_OPENAI_API_VERSION
        }
    }