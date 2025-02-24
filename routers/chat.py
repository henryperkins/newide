import json
import uuid
import time
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func
from openai import AzureOpenAI

from database import get_db_session  # Corrected import
from clients import get_model_client
from logging_config import logger
import config

# Import models and schemas that define request/response shapes
from pydantic_models import (
    ChatMessage,
    CreateChatCompletionRequest,
    ChatCompletionResponse
)
from models import Conversation
from pydantic_models import ModelCapabilities, ModelCapabilitiesResponse

from routers.security import get_current_user
from models import User

router = APIRouter(prefix="/chat")

@router.post("/api/conversations/store")
async def store_message(
    session_id: UUID = Query(...),
    role: str = Query(...),
    content: str = Query(...),
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    try:
        from sqlalchemy import insert
        stmt = insert(Conversation).values(
            session_id=session_id,
            user_id=current_user.id,
            role=role,
            content=content
        )
        await db.execute(stmt)
        await db.commit()
        return {"status": "success"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/conversations/history")
async def get_conversation_history(
    session_id: UUID = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Returns messages for a specified session in ascending order.
    Allows pagination via offset & limit.
    """
    try:
        query = (select(Conversation)
                 .where(Conversation.session_id == session_id)
                 .order_by(Conversation.id.asc())
                 .offset(offset)
                 .limit(limit)
        )
        result = await db.execute(query)
        messages = result.scalars().all()
        return {
            "session_id": str(session_id),
            "messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.timestamp.isoformat() if msg.timestamp else None
                } for msg in messages
            ],
            "offset": offset,
            "limit": limit,
            "returned_count": len(messages),
            "has_more": (len(messages) == limit)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/conversations/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db_session)):
    """
    Returns a list of distinct session_ids in the conversations table,
    along with how many messages each session has.
    Useful for listing conversation histories in the UI.
    """
    try:
        stmt = select(
            Conversation.session_id,
            func.count(Conversation.id).label("message_count")
        ).group_by(Conversation.session_id)

        result = await db.execute(stmt)
        rows = result.all()
        return [
            {
                "session_id": str(row.session_id),
                "message_count": row.message_count
            }
            for row in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=ChatCompletionResponse)
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    api_version: str = Query(..., alias="api-version"),
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """
    Creates a single chat completion in a non-streaming (standard) manner,
    returning a ChatCompletionResponse following Azure OpenAI style.
    """
    try:
        # Validate requested API version
        if api_version != config.AZURE_OPENAI_API_VERSION:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "code": "invalid_request_error",
                        "message": f"Unsupported or invalid API version: {api_version}",
                        "type": "invalid_request_error",
                    }
                },
            )

        # Determine which model to use
        model_name = request.model or config.AZURE_OPENAI_DEPLOYMENT_NAME
        if model_name not in config.MODEL_CONFIGS:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "code": "invalid_request_error",
                        "message": f"Unsupported model: {model_name}",
                        "type": "invalid_request_error",
                    }
                },
            )

        # Acquire AzureOpenAI client
        client = await get_model_client(model_name)

        # Build an internal ChatMessage object from the request
        chat_message = ChatMessage(
            message=request.messages[-1]["content"],
            session_id=request.session_id,
            developer_config=request.developer_config,
            reasoning_effort=request.reasoning_effort,
            include_files=request.include_files,
            file_ids=request.file_ids,
            use_file_search=request.use_file_search,
            response_format=request.response_format,
            max_completion_tokens=request.max_completion_tokens,
            temperature=request.temperature,
            model=model_name,  # Pass the model name along
        )

        # Handle the chat logic (imported from services.chat_service)
        from services.chat_service import process_chat_message

        response_data = await process_chat_message(
            chat_message=chat_message,
            db_session=db,
            azure_client=client,
            model_name=model_name,
        )

        # Return a typed ChatCompletionResponse object
        return ChatCompletionResponse(**response_data)

    except HTTPException:
        # Re-raise known HTTPExceptions (e.g. invalid request, missing model)
        raise

    except Exception as e:
        # Catch any unhandled exceptions and log them
        logger.exception(
            f"[ChatRouter] An unexpected error occurred in /chat/: {str(e)}"
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "internal_server_error",
                    "message": "An unexpected error occurred while processing your request.",
                    "type": "internal_server_error",
                    "details": str(e),
                }
            },
        )


@router.post("/stream")
async def stream_chat_response(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
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
                        "type": "validation_error",
                    }
                },
            )

        model_config = config.MODEL_CONFIGS.get(model_name)
        if not (model_config and model_config.get("supports_streaming", False)):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": f"Streaming not supported for model: {model_name}",
                        "type": "validation_error",
                    }
                },
            )

        reasoning_effort = request_data.get("reasoning_effort", "medium")
        if reasoning_effort not in ["low", "medium", "high"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "message": "Invalid 'reasoning_effort' value",
                        "allowed_values": ["low", "medium", "high"],
                        "type": "validation_error",
                    }
                },
            )

        # Acquire AzureOpenAI client
        client = await get_model_client(model_name)

        # Return an SSE streaming response
        return StreamingResponse(
            generate_stream_chunks(
                message=message,
                client=client,
                model_name=model_name,
                reasoning_effort=reasoning_effort,
                db=db,
                session_id=session_id,
            ),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
        )

    except HTTPException:
        # Re-raise known HTTPExceptions
        raise

    except Exception as e:
        logger.exception("[ChatRouter] Error in /chat/stream endpoint")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "internal_server_error",
                    "message": "An unexpected error occurred while processing your request.",
                    "type": "internal_server_error",
                    "details": str(e),
                }
            },
        )


async def generate_stream_chunks(
    message: str,
    client: "AzureOpenAI",
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str,
):
    """
    Async generator that yields SSE data chunks from Azure OpenAI streaming responses.
    """
    from models import Conversation  # If conversation logs are stored in DB

    model_config = config.MODEL_CONFIGS.get(model_name, {})  # Safe get and default

    params = {
        "messages": [{"role": "user", "content": message}],
        "stream": True,
        "max_tokens": model_config.get("max_tokens", 4096),  # Safe get
    }

    # If the model supports temperature, pass it; otherwise, use reasoning_effort
    if model_config.get("supports_temperature", True):  # Safe get
        params["temperature"] = 0.7  # Example default; consider making this configurable
    else:
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
                "choices": [],
            }

            chunk_choices = []
            for idx, choice in enumerate(chunk.choices):
                partial = {
                    "index": idx,
                    "delta": {},
                    "finish_reason": choice.finish_reason,
                }
                if getattr(choice.delta, "content", None):
                    content_part = choice.delta.content
                    full_content += content_part
                    partial["delta"]["content"] = content_part

                if getattr(choice.delta, "role", None):
                    partial["delta"]["role"] = choice.delta.role

                # If there are any tool calls or filter results, pass them along
                if getattr(choice.delta, "tool_calls", None):
                    partial["delta"]["tool_calls"] = choice.delta.tool_calls
                if hasattr(choice, "content_filter_results"):
                    partial["content_filter_results"] = choice.content_filter_results

                chunk_choices.append(partial)

            response_data["choices"] = chunk_choices
            yield f"data: {json.dumps(response_data)}\n\n"

        # After streaming completes, store conversation if there's any content
        if full_content:
            user_msg = Conversation(
                session_id=session_id,
                role="user",
                content=message,
                model=model_name,
            )
            assistant_msg = Conversation(
                session_id=session_id,
                role="assistant",
                content=full_content,
                model=model_name,
            )
            # Database logic for user_msg / assistant_msg could be placed here if needed

    except Exception as e:
        logger.exception("[ChatRouter] SSE streaming error")
        error_payload = {"error": str(e)}
        # Yield an SSE event indicating an error
        yield f"data: {json.dumps(error_payload)}\n\n"
