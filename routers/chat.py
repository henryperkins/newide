# routers/chat.py
import json
from fastapi import APIRouter, Depends, Request, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncAzureOpenAI
from database import get_db_session
from clients import get_azure_client
from models import ChatMessage
from services.chat_service import process_chat_message
from errors import create_error_response
from logging_config import logger
import config
router = APIRouter(prefix="/chat")
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    session_id: str
    reasoning_effort: str = "medium"
    include_files: bool = False

from models import CreateChatCompletionRequest, ChatCompletionResponse
import uuid
import time

@router.post("/")
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    api_version: str = Query(..., alias="api-version"),
    db: AsyncSession = Depends(get_db_session),
    client: AsyncAzureOpenAI = Depends(get_azure_client)
):
    # Validate API version first
    if api_version != config.AZURE_OPENAI_API_VERSION:
        logger.error(f"API version mismatch: {api_version} vs {config.AZURE_OPENAI_API_VERSION}")
        raise create_error_response(
            status_code=400,
            code="invalid_deployment",
            message="Invalid deployment ID",
            error_type="invalid_request_error"
        )
    # Transform flat request into message format expected by processing
    chat_message = ChatMessage(
        message=request.message,
        session_id=request.session_id,
        developer_config=request.developer_config,
        reasoning_effort=request.reasoning_effort,
        include_files=request.include_files,
        response_format=None,
        max_completion_tokens=request.max_completion_tokens
    )
    response_data = await process_chat_message(chat_message, db, client)
    return ChatCompletionResponse(**response_data)

@router.post("/stream")
async def stream_chat_response(
    request: Request,
    client: AsyncAzureOpenAI = Depends(get_azure_client)
):
    try:
        request_data = await request.json()
        message = request_data.get("message")
        session_id = request_data.get("session_id")
        
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
            
        # Validate reasoning effort value
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

async def generate(message, client, reasoning_effort="medium"):
    deployment_name = config.AZURE_OPENAI_DEPLOYMENT_NAME.lower()
    if any(m in deployment_name for m in ["o1-", "o3-"]) and "preview" not in deployment_name:
        try:
            # Configure parameters based on model type
            model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME.lower()
            is_o_series = any(m in model_name for m in ["o1-", "o3-"]) and "preview" not in model_name
            
            params = {
                "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
                "messages": [{"role": "user", "content": message}],
                "stream": True,
            }
            
            # Add o-series specific parameters
            if is_o_series:
                params.update({
                    "temperature": 1,  # Mandatory for o-series
                    "max_completion_tokens": 40000,
                    "reasoning_effort": reasoning_effort
                })
            else:
                params["max_tokens"] = 4096
            
            # Check again right before making the call
            if any(m in deployment_name for m in ["o1-", "o3-"]) and "preview" not in deployment_name:
                raise HTTPException(400, "o-series models don't support streaming")
            
            response = await client.chat.completions.create(**params)
            
            async for chunk in response:
                response_data = {
                    "id": f"chatcmpl-{uuid.uuid4()}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
                    "system_fingerprint": getattr(response, 'system_fingerprint', ''),
                    "choices": [{
                        "index": idx,
                        "delta": {
                            "content": choice.delta.content,
                            "role": choice.delta.role,
                            "tool_calls": choice.delta.tool_calls
                        },
                        "finish_reason": choice.finish_reason,
                        **({"content_filter_results": choice.content_filter_results} if hasattr(choice, 'content_filter_results') else {})
                    } for idx, choice in enumerate(chunk.choices)]
                }
                yield f"data: {json.dumps(response_data)}\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

@router.get("/model/capabilities")
async def get_model_capabilities():
    from services.chat_service import get_model_config
    deployment_name = config.AZURE_OPENAI_DEPLOYMENT_NAME.lower()
    return {
        "model": deployment_name,
        "capabilities": {
            "supports_streaming": "preview" not in deployment_name and any(m in deployment_name for m in ["o3-mini"]),
            "supports_vision": "o1" in deployment_name,
            "max_tokens": 40000 if "o" in deployment_name else 4096,
            "api_version": "2024-12-01-preview"
        }
    }
