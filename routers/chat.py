"""
Routers for chat endpoints, providing storage, retrieval, and streaming completions.
"""

import uuid
import json
import time
import asyncio
from typing import Optional, Dict, Any, AsyncIterator
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, delete, update, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
import sentry_sdk

# Local modules
from logging_config import logger
from database import get_db_session
from clients import get_model_client_dependency
from pydantic_models import (
    CreateChatCompletionRequest,
)
from models import Conversation, User
from routers.security import get_current_user
from services.chat_service import save_conversation
from services.session_service import SessionService
from utils import (
    count_tokens,
    is_o_series_model,
    is_deepseek_model,
)

router = APIRouter(prefix="/chat")

# Concurrency settings for SSE
MAX_SSE_CONNECTIONS = 10
SSE_SEMAPHORE = asyncio.Semaphore(MAX_SSE_CONNECTIONS)

# Defaults for your DeepSeek or O-series models
DEEPSEEK_R1_DEFAULT_MAX_TOKENS = 131072  # 128k context window
DEEPSEEK_R1_DEFAULT_TEMPERATURE = 0.0
O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS = 40000


# -------------------------------------------------------------------------
# Conversations Endpoints
# -------------------------------------------------------------------------
@router.post("/conversations")
async def create_new_conversation(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Creates a new conversation (which also requires a Session row).
    Then inserts an initial system message in the 'conversations' table.
    """
    try:
        data = await request.json()
        title = data.get("title", "Untitled Conversation")
        pinned = data.get("pinned", False)
        archived = data.get("archived", False)

        # Create a brand-new Session (1 row per conversation) using SessionService
        # Pass the user's ID if they're authenticated
        user_id = str(current_user.id) if current_user else None
        new_session = await SessionService.create_session(
            db_session=db,
            user_id=user_id
        )

        # Create the initial Conversation row (the first message)
        timestamp = datetime.now(timezone.utc)
        conv = Conversation(
            session_id=new_session.id,
            user_id=current_user.id if current_user else None,
            role="system",
            content=f"Conversation started: {title}",
            title=title,
            pinned=pinned,
            archived=archived,
            timestamp=timestamp,
        )
        db.add(conv)
        await db.commit()

        return {
            "conversation_id": str(new_session.id),
            "title": title,
            "pinned": pinned,
            "archived": archived,
            "created_at": timestamp.isoformat(),
            "message_count": 1,
        }
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/conversations/{conversation_id}/messages")
async def add_conversation_message(
    conversation_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Add a new message (role/content) to an existing conversation.
    Body must have: {"role": "...", "content": "..."}.
    """
    try:
        body = await request.json()
        role = body.get("role")
        content = body.get("content")

        if not role or not content:
            raise HTTPException(status_code=400, detail="Missing role or content")

        # Verify session exists using SessionService
        session_db = await SessionService.validate_session(
            session_id=conversation_id,
            db_session=db,
            require_valid=False
        )
        
        if not session_db:
            raise HTTPException(status_code=404, detail="Conversation not found")

        msg = Conversation(
            session_id=session_db.id,
            user_id=current_user.id if current_user else None,
            role=role,
            content=content,
            timestamp=datetime.now(timezone.utc),
        )
        db.add(msg)
        await db.commit()

        return {"status": "success", "message_id": msg.id}
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Retrieve messages for a conversation, with pagination (offset/limit).
    Returns pinned/archived/title from the first message row found.
    """
    try:
        # Validate conversation using SessionService
        session_db = await SessionService.validate_session(
            session_id=conversation_id,
            db_session=db,
            require_valid=False
        )
        if not session_db:
            # Return an empty conversation instead of raising 404
            return {
                "conversation_id": str(conversation_id),
                "title": "Unknown Conversation",
                "pinned": False,
                "archived": False,
                "total_count": 0,
                "messages": [],
                "has_more": False
            }

        # Count total
        count_query = select(func.count(Conversation.id)).where(
            Conversation.session_id == session_db.id
        )
        total_count_res = await db.execute(count_query)
        total_count = total_count_res.scalar() or 0

        # Fetch the messages
        msg_query = (
            select(Conversation)
            .where(Conversation.session_id == session_db.id)
            .order_by(Conversation.timestamp.asc())
            .offset(offset)
            .limit(limit)
        )
        msg_res = await db.execute(msg_query)
        messages = msg_res.scalars().all()

        pinned = False
        archived = False
        title_val = "Untitled Conversation"
        if messages:
            pinned = bool(messages[0].pinned)
            archived = bool(messages[0].archived)
            title_val = messages[0].title or "Untitled Conversation"

        return {
            "conversation_id": str(conversation_id),
            "title": title_val,
            "pinned": pinned,
            "archived": archived,
            "total_count": total_count,
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat() if m.timestamp is not None else None,
                }
                for m in messages
            ],
            "has_more": offset + limit < total_count,
        }
    except Exception as exc:
        logger.exception(f"Error retrieving conversation messages: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/conversations/{conversation_id}")
async def clear_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Deletes all messages for a given conversation (and the Session row if desired).
    """
    try:
        # Validate session using SessionService
        session_db = await SessionService.validate_session(
            session_id=conversation_id,
            db_session=db,
            require_valid=False
        )
        if not session_db:
            return {"status": "cleared", "detail": "No conversation found"}

        # Delete messages in that session
        del_stmt = delete(Conversation).where(Conversation.session_id == session_db.id)
        await db.execute(del_stmt)
        # Delete session row using SessionService
        await SessionService.delete_session(str(session_db.id), db_session=db)

        return {"status": "cleared"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/conversations/{conversation_id}/title")
async def rename_conversation(
    conversation_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Update the conversation's title across all messages.
    Body must have: {"title": "..."}.
    """
    try:
        body = await request.json()
        new_title = body.get("title", "").strip()
        if not new_title:
            raise HTTPException(status_code=400, detail="No 'title' provided")

        # Validate session using SessionService
        session_db = await SessionService.validate_session(
            session_id=conversation_id,
            db_session=db,
            require_valid=False
        )
        if not session_db:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Update all rows in this conversation
        upd_stmt = (
            update(Conversation)
            .where(Conversation.session_id == session_db.id)
            .values(title=new_title)
        )
        await db.execute(upd_stmt)
        await db.commit()

        return {
            "status": "success",
            "conversation_id": str(conversation_id),
            "title": new_title,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/conversations/{conversation_id}/pin")
async def pin_conversation(
    conversation_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Pin or unpin a conversation. Body must have {"pinned": bool}.
    Enforce ownership checks to prevent unauthorized pinning.
    """
    try:
        body = await request.json()
        pinned_val = body.get("pinned", True)

        # Validate session with ownership checks
        session_db = await SessionService.validate_session(
            session_id=conversation_id,
            db_session=db,
            user_id=str(current_user.id) if current_user else None,
            require_valid=True
        )

        if not session_db:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Update pinned value in all rows
        upd_stmt = (
            update(Conversation)
            .where(Conversation.session_id == session_db.id)
            .values(pinned=pinned_val)
        )
        await db.execute(upd_stmt)
        await db.commit()

        return {"status": "success", "pinned": pinned_val}
    except HTTPException as exc:
        await db.rollback()
        logger.exception(f"Ownership or session error: {exc}")
        raise exc
    except Exception as exc:
        await db.rollback()
        logger.exception(f"Error updating pin status: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/conversations/{conversation_id}/archive")
async def archive_conversation(
    conversation_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Archive or unarchive a conversation. Body must have {"archived": bool}.
    """
    try:
        data = await request.json()
        archived_val = data.get("archived", True)

        # Validate session using SessionService
        session_db = await SessionService.validate_session(
            session_id=conversation_id,
            db_session=db,
            require_valid=False
        )
        if not session_db:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Update archived value in all messages
        upd_stmt = (
            update(Conversation)
            .where(Conversation.session_id == conversation_id)
            .values(archived=archived_val)
        )
        await db.execute(upd_stmt)
        await db.commit()

        return {"status": "success", "archived": archived_val}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error archiving conversation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations")
async def list_conversations(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    pinned: Optional[bool] = Query(None),
    archived: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Lists distinct conversations by session_id, with optional pinned, archived, or search filters.
    Returns pagination info plus summary info about each conversation.
    """
    try:
        base_query = (
            select(
                Conversation.session_id,
                func.bool_or(Conversation.pinned).label("pinned"),
                func.bool_or(Conversation.archived).label("archived"),
                func.max(Conversation.timestamp).label("updated_at"),
                func.count(Conversation.id).label("message_count"),
                func.max(Conversation.title).label("title"),
            )
            .group_by(Conversation.session_id)
            .order_by(func.max(Conversation.timestamp).desc())
        )

        # Handle search
        if search:
            pattern = f"%{search}%"
            base_query = base_query.where(
                or_(
                    Conversation.title.ilike(pattern),
                    Conversation.content.ilike(pattern)
                )
            )
            # pinned / archived filters
        if pinned is not None:
            base_query = base_query.having(func.bool_or(Conversation.pinned) == pinned)
        if archived is not None:
            base_query = base_query.having(func.bool_or(Conversation.archived) == archived)

        # We'll fetch everything first, then slice
        sub_res = await db.execute(base_query)
        all_rows = sub_res.all()
        total_count = len(all_rows)

        # Apply pagination
        base_query = base_query.offset(offset).limit(limit)
        rows = (await db.execute(base_query)).all()

        conversations = []
        for row in rows:
            sess_id = row.session_id
            pinned_val = row.pinned
            archived_val = row.archived
            updated_at = row.updated_at
            msg_count = row.message_count
            title_val = row.title or "Untitled Conversation"

            conversations.append(
                {
                    "id": str(sess_id),
                    "title": title_val,
                    "pinned": pinned_val,
                    "archived": archived_val,
                    "updated_at": updated_at.isoformat() if updated_at else None,
                    "message_count": msg_count,
                }
            )

        return {
            "conversations": conversations,
            "total_count": total_count,
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < total_count,
        }
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/conversations/store")
async def store_conversation(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Store conversation data from client. Body must include {"session_id", "role", "content"}.
    """
    try:
        data = await request.json()
        session_id = data.get("session_id")
        role = data.get("role")
        content = data.get("content")

        if not session_id or not role or not content:
            raise HTTPException(status_code=400, detail="Missing required fields")

        # Validate session using SessionService
        session = await SessionService.validate_session(
            session_id=session_id,  # Now declared above from the header
            db_session=db,
            require_valid=False
        )
        
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        msg = Conversation(
            session_id=session_id,
            user_id=current_user.id if current_user else None,
            role=role,
            content=content,
            timestamp=datetime.now(timezone.utc),
        )
        db.add(msg)
        await db.commit()
        return {"status": "success", "message_id": msg.id}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error storing conversation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# -------------------------------------------------------------------------
# Non-Streaming Chat Completion
# -------------------------------------------------------------------------
@router.post("")
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Creates a non-streaming chat completion (Azure/OpenAI style).
    Here it's just a stub that returns an empty string for assistant text.
    """
    try:
        if not request.messages:
            raise HTTPException(status_code=400, detail="Missing 'messages' field")

        model_name = request.model or "o1"

        # STUB: replace with real completion call if desired
        response_data = {
            "id": f"chatcmpl-{uuid.uuid4()}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_name,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": ""},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

        # Store user & assistant messages in the conversation table
        temp_user_dict = request.messages[-1]  # type: ignore
        user_text = temp_user_dict.get("content", "") if isinstance(temp_user_dict, dict) else ""
        
        choices_list = response_data.get("choices", []) if isinstance(response_data, dict) else []
        first_choice = choices_list[0] if isinstance(choices_list, list) and choices_list else {}
        message_dict = first_choice.get("message", {}) if isinstance(first_choice, dict) else {}
        assistant_text = message_dict.get("content", "") if isinstance(message_dict, dict) else ""

        from uuid import UUID
        user_msg = Conversation(
            session_id=UUID(request.session_id),
            user_id=current_user.id if current_user else None,
            role="user",
            content=user_text,
            model=model_name,
        )
        assistant_msg = Conversation(
            session_id=UUID(request.session_id),
            role="assistant",
            content=assistant_text,
            model=model_name,
            raw_response={"streaming": False, "token_usage": response_data["usage"]},
        )
        db.add_all([user_msg, assistant_msg])
        await db.commit()

        return response_data
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


# -------------------------------------------------------------------------
# Streaming SSE Endpoint
# -------------------------------------------------------------------------
@router.get("/sse")
@sentry_sdk.trace()
async def chat_sse(  # noqa: C901
    request: Request,
    model: str = "",
    message: str = "",
    reasoning_effort: str = "medium",  # used by O-series
    db: AsyncSession = Depends(get_db_session),
):
    # Extract session_id from the X-Session-ID header
    header_session_id = request.headers.get("X-Session-ID")
    if not header_session_id:
        raise HTTPException(status_code=400, detail="Missing X-Session-ID header")

    try:
        session_id = UUID(header_session_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid session ID format")

    # Explicitly validate that 'model' and 'message' were provided
    if not model or not message:
        raise HTTPException(
            status_code=400,
            detail="Missing required arguments: 'message' and 'model' must be non-empty."
        )
    """
    Stream chat completions using Server-Sent Events (SSE).
    """
    logger.info(f"SSE streaming request: model={model}, session_id={session_id}")
    sentry_sdk.set_tag("model", model)
    sentry_sdk.set_tag("session_id", str(session_id))

    # If it's DeepSeek, verify special headers
    if is_deepseek_model(model):
        with sentry_sdk.start_span(op="Validate DeepSeek Headers"):
            required_headers = {
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": "2024-05-01-preview",
            }
            for header, expected_value in required_headers.items():
                actual_value = request.headers.get(header)
                if not actual_value:
                    msg = f"Missing required header: {header} for DeepSeek-R1"
                    logger.error(msg)
                    raise HTTPException(status_code=400, detail=msg)
                if actual_value != expected_value:
                    msg = f"Invalid {header} value. Expected {expected_value}, got {actual_value}"
                    logger.error(msg)
                    raise HTTPException(status_code=400, detail=msg)

        # Acquire semaphore to limit concurrent SSE connections
        await SSE_SEMAPHORE.acquire()

    try:
        # Validate session using the SessionService
        session_db = await SessionService.validate_session(
            session_id=session_id,
            db_session=db,
            require_valid=False
        )
        
        if not session_db:
            # Automatically create a session if the provided session_id doesn't exist
            logger.info(f"Session {session_id} not found, creating a new session")
            session_db = await SessionService.create_session(db_session=db)
            
            # Record that we created a session
            sentry_sdk.set_tag("session_auto_created", "true")
            session_info = {
                "id": str(session_db.id),
                "created_at": session_db.created_at.isoformat() if session_db.created_at is not None else None,  # type: ignore
                "expires_at": session_db.expires_at.isoformat() if session_db.expires_at is not None else None,  # type: ignore
            }
            logger.info(f"Automatically created new Session: {session_info}")
            
            # Update the model for this session
            await SessionService.switch_model(
                session_id=str(session_db.id),
                new_model=model,
                db_session=db
            )

        # Retrieve the correct client
        client_wrapper = await get_model_client_dependency(model)
        if client_wrapper.get("error"):
            raise HTTPException(
                status_code=500,
                detail=f"Error initializing model client: {client_wrapper['error']}"
            )
        client = client_wrapper["client"]
        supports_streaming = client_wrapper.get("supports_streaming", True)
        if not client or not supports_streaming:
            raise HTTPException(status_code=400, detail="Model doesn't support streaming")

        logger.info(f"Initiating SSE with model={model}")

        # Return streaming response
        return StreamingResponse(
            generate_stream_chunks(
                request=request,
                message=message,
                model_name=model,
                reasoning_effort=reasoning_effort,
                db=db,
                session_id=session_id,
                client=client,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as exc:
        logger.exception(f"Error in chat_sse: {exc}")
        sentry_sdk.capture_exception(exc)
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if is_deepseek_model(model):
            SSE_SEMAPHORE.release()


async def generate_stream_chunks(  # noqa: C901
    request: Request,
    message: str,
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: UUID,
    client: Any,
) -> AsyncIterator[str]:
    """Async generator yielding SSE data from streaming model responses."""
    full_content = ""
    usage_data: Dict[str, Any] = {}
    
    try:
        is_deepseek = is_deepseek_model(model_name)
        is_o_series = is_o_series_model(model_name)
        
        # Initialize model parameters
        params = {
            "messages": [{"role": "user", "content": message}],
            "stream": True  # Enable streaming
        }
        
        # Add model-specific settings
        if is_deepseek:
            params["max_tokens"] = 131072  # type: ignore
            params["temperature"] = 0.5  # type: ignore
            params["model"] = model_name  # type: ignore
            params["headers"] = {  # type: ignore
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": "2024-05-01-preview"
            }
            
            # Log what we're about to call
            logger.info(f"Calling DeepSeek client.complete with params: {params}")
            
            # For DeepSeek, use complete() directly and iterate over the response
            try:
                stream_response = await client.complete(**params)
                logger.info("DeepSeek stream_response initiated successfully")

                # Iterate over the response chunks
                async for chunk in stream_response:
                    if await request.is_disconnected():
                        logger.info("Client disconnected, stopping stream")
                        break
                        
                    chunk_text = ""
                    if hasattr(chunk, "choices") and chunk.choices:
                        delta = chunk.choices[0].delta
                        if hasattr(delta, "content"):
                            chunk_text = delta.content or ""
                            full_content += chunk_text
                            
                    yield f"data: {json.dumps({'text': chunk_text})}\n\n"
                    
            except Exception as model_error:
                logger.exception(f"Error in DeepSeek client.complete: {model_error}")
                yield f"data: {json.dumps({'error': str(model_error)})}\n\n"
                # Fall back to a simple response
                yield f"data: {json.dumps({'text': 'Error generating streaming response. Please try again.'})}\n\n"
                
        elif is_o_series:
            # Suppress Pylance type issues by forcing these entries to Any
            params["max_completion_tokens"] = int(O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS)  # type: ignore
            params["reasoning_effort"] = str(reasoning_effort)  # type: ignore
            params["model"] = model_name  # type: ignore
            # O-series uses different client
            stream_response = await client.chat.completions.create(**params)
            async for chunk in stream_response:
                if await request.is_disconnected():
                    break

                chunk_text = ""
                if chunk.choices and len(chunk.choices) > 0:
                    if hasattr(chunk.choices[0], "delta"):
                        delta = chunk.choices[0].delta
                        if hasattr(delta, "content"):
                            chunk_text = delta.content or ""
                            full_content += chunk_text
                    yield f"data: {json.dumps({'text': chunk_text})}\n\n"
                else:
                    logger.warning("Received empty choices from O1 chunk, skipping.")
                    yield f"data: {json.dumps({'text': ''})}\n\n"
        else:
            # Default OpenAI-style client
            stream_response = await client.chat.completions.create(**params)
            async for chunk in stream_response:
                if await request.is_disconnected():
                    break

                chunk_text = ""
                if hasattr(chunk.choices[0], "delta"):
                    delta = chunk.choices[0].delta
                    if hasattr(delta, "content"):
                        chunk_text = delta.content or ""
                        full_content += chunk_text

                yield f"data: {json.dumps({'text': chunk_text})}\n\n"
        
        # Send completion messages
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
        # Calculate and send usage stats
        usage_data = {
            "prompt_tokens": count_tokens(message, model_name),
            "completion_tokens": count_tokens(full_content, model_name),
            "total_tokens": count_tokens(message, model_name) + count_tokens(full_content, model_name)
        }
        
        yield f"event: complete\ndata: {json.dumps(usage_data)}\n\n"
        
        # Save conversation
        await save_conversation(
            db_session=db,
            session_id=str(session_id),
            model_name=model_name,
            user_text=message,
            assistant_text=full_content,
            formatted_assistant_text=full_content,
            raw_response=None
        )

    except Exception as exc:
        logger.exception(f"Error in generate_stream_chunks: {exc}")
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"


async def _model_chunks_async(stream_response):
    """
    Helper to yield chunks in async form.
    The azure-ai-inference ChatCompletionsClient returns an async iterator if stream=True.
    """
    if hasattr(stream_response, "__aiter__"):
        async for chunk in stream_response:
            yield chunk
    else:
        # Fallback if the response is not async for some reason
        for chunk in stream_response:
            yield chunk
