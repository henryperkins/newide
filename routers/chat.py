"""
Routers for chat endpoints, providing storage, retrieval, and streaming completions.
"""

import uuid
import json
import re
import time
import asyncio
from typing import Optional, Dict, Any, Union, AsyncIterator, List
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, HTTPException, Query
import config
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, insert, delete, update, func, text
from sqlalchemy.ext.asyncio import AsyncSession
import sentry_sdk

# Local modules
from logging_config import logger
from database import get_db_session
from clients import get_model_client_dependency
from pydantic_models import (
    CreateChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChoice,
    ChatCompletionUsage,
    ErrorResponse,
)
from models import Conversation, Session, User
from routers.security import get_current_user
from services.config_service import ConfigService, get_config_service
from services.chat_service import save_conversation
from services.model_stats_service import ModelStatsService
from utils import (
    handle_client_error,
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
# Helper: Expand chain-of-thought blocks in HTML
# -------------------------------------------------------------------------
def expand_chain_of_thought(full_content: str, request: Request) -> str:
    """
       Replaces <details style="margin: 0.5rem 0 1.5rem; padding: 0.75rem; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-secondary)">
               <summary style="cursor: pointer; color: var(--text-muted); font-size: 0.8em; margin-bottom: 0.5rem; user-select: none">Thought for a second</summary>
               <div class="text-muted" style="margin-top: 0.75rem; padding: 0.75rem; border-radius: 4px; background-color: var(--background-primary)">...</div>
             </details>

    blocks with a hidden HTML expansion
       for chain-of-thought style content. Uses CSP nonce and DOMPurify.
    """
    if not full_content:
        return full_content

    from bs4 import BeautifulSoup
    from bleach import clean as bleach_clean

    soup = BeautifulSoup(full_content, "html.parser")
    think_blocks = soup.find_all("think")

    for block in think_blocks:
        block_html = str(block)
        sanitized_html = bleach_clean(
            block_html,
            tags=["think", "div", "button", "span", "pre"],
            attributes={
                "div": ["class", "nonce"],
                "button": ["class", "aria-expanded"],
                "span": ["class"],
                "pre": ["class"],
            },
        )
        nonce = request.state.nonce
        thinking_html = f"""
<div class="thinking-process" nonce="{nonce}">
    <div class="thinking-header">
        <button class="thinking-toggle" aria-expanded="true">
            <span class="toggle-icon">▼</span> Thinking Process
        </button>
    </div>
    <div class="thinking-content">
        <pre class="thinking-pre">{sanitized_html}</pre>
    </div>
</div>
        """
        block.replace_with(BeautifulSoup(thinking_html, "html.parser"))

    final_html = bleach_clean(
        str(soup),
        tags=["div", "button", "span", "pre"],
        attributes={
            "div": ["class", "nonce"],
            "button": ["class", "aria-expanded"],
            "span": ["class"],
            "pre": ["class"],
        },
    )
    return final_html


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

        # Create a brand-new Session.
        session_id = uuid.uuid4()
        new_session = Session(id=session_id)
        db.add(new_session)
        await db.flush()  # Ensures new_session is persisted but not yet committed.

        # Create the initial Conversation row
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

        # Verify session exists
        sess_stmt = select(Session).where(Session.id == conversation_id)
        sess_res = await db.execute(sess_stmt)
        session_db = sess_res.scalar_one_or_none()
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
        # Validate conversation
        sess_stmt = select(Session).where(Session.id == conversation_id)
        sess_res = await db.execute(sess_stmt)
        session_db = sess_res.scalar_one_or_none()
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
            pinned = messages[0].pinned
            archived = messages[0].archived
            if messages[0].title:
                title_val = messages[0].title

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
                    "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                }
                for m in messages
            ],
            "has_more": offset + limit < total_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        import traceback

        traceback.print_exc()
        logger.exception(f"SSE error in chat_sse: {exc}")
        raise HTTPException(status_code=500, detail=f"SSE error: {exc}")


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
        # Validate session
        sel_stmt = select(Session).where(Session.id == conversation_id)
        sess_res = await db.execute(sel_stmt)
        session_db = sess_res.scalar_one_or_none()
        if not session_db:
            return {"status": "cleared", "detail": "No conversation found"}

        del_conversation = delete(Conversation).where(
            Conversation.session_id == session_db.id
        )
        await db.execute(del_conversation)

        await db.delete(session_db)
        await db.commit()

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

        # Validate session
        sel_stmt = select(Session).where(Session.id == conversation_id)
        sess_res = await db.execute(sel_stmt)
        session_db = sess_res.scalar_one_or_none()
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
    """
    try:
        body = await request.json()
        pinned_val = body.get("pinned", True)

        # Validate session
        sel_stmt = select(Session).where(Session.id == conversation_id)
        sess_res = await db.execute(sel_stmt)
        session_db = sess_res.scalar_one_or_none()
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
        archived = data.get("archived", True)

        # Update all messages in the conversation
        await db.execute(
            update(Conversation)
            .where(Conversation.session_id == conversation_id)
            .values(archived=archived)
        )
        await db.commit()

        return {"status": "success", "archived": archived}
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
        # Base query: gather info per session_id
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

        # Filter pinned
        if pinned is not None:
            base_query = base_query.having(func.bool_or(Conversation.pinned) == pinned)

        # Filter archived
        if archived is not None:
            base_query = base_query.having(
                func.bool_or(Conversation.archived) == archived
            )

        # Filter search across title/content
        if search:
            pattern = f"%{search}%"
            base_query = base_query.where(
                (Conversation.title.ilike(pattern))
                | (Conversation.content.ilike(pattern))
            )

        # For counting total distinct sessions (with same filters)
        count_query = select(
            func.count(func.distinct(Conversation.session_id))
        ).select_from(Conversation)

        if search:
            count_query = count_query.where(
                (Conversation.title.ilike(pattern))
                | (Conversation.content.ilike(pattern))
            )
        if pinned is not None:
            count_query = count_query.having(
                func.bool_or(Conversation.pinned) == pinned
            )
        if archived is not None:
            count_query = count_query.having(
                func.bool_or(Conversation.archived) == archived
            )

        total_res = await db.execute(count_query)
        total_count = total_res.scalar() or 0

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
    Store conversation data from client (user or system messages).
    Body must include {"session_id", "role", "content"}.
    """
    try:
        data = await request.json()
        session_id = data.get("session_id")
        role = data.get("role")
        content = data.get("content")

        if not all([session_id, role, content]):
            raise HTTPException(status_code=400, detail="Missing required fields")

        # Validate session
        stmt = select(Session).where(Session.id == session_id)
        result = await db.execute(stmt)
        if not result.scalar_one_or_none():
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
    Creates a non-streaming chat completion, returning an Azure-like JSON.
    Demonstrates the integration point for O-series or DeepSeek calls.
    """
    try:
        if not request.messages:
            raise HTTPException(status_code=400, detail="Missing 'messages' field")

        model_name = request.model or "o1"
        client_wrapper = await get_model_client_dependency(model_name)
        client = client_wrapper["client"]

        # TODO: Replace this mock with a real completion call if desired.
        # For now, returning an empty text or any minimal fallback to avoid the "Hello from the AI" default.
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
        user_text = request.messages[-1]["content"]
        assistant_text = response_data["choices"][0]["message"]["content"]

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
async def chat_sse(
    request: Request,
    session_id: UUID,
    model: str,
    message: str,
    reasoning_effort: str = "medium",
    db: AsyncSession = Depends(get_db_session),
):
    """
    Stream chat completions using Server-Sent Events (SSE).
    """
    logger.info(f"Starting SSE streaming for model: {model}, session: {session_id}")
    
    # Set transaction name for Sentry
    sentry_sdk.set_tag("model", model)
    sentry_sdk.set_tag("session_id", str(session_id))

    # Validate DeepSeek required headers
    if is_deepseek_model(model):
        with sentry_sdk.start_span(op="Validate DeepSeek Headers"):
            required_headers = {
                "x-ms-thinking-format": "html",
                "x-ms-streaming-version": "2024-05-01-preview",
            }

            for header, expected_value in required_headers.items():
                actual_value = request.headers.get(header)
                if not actual_value:
                    error_msg = f"Missing required header: {header} for DeepSeek-R1"
                    logger.error(error_msg)
                    raise HTTPException(status_code=400, detail=error_msg)
                if actual_value != expected_value:
                    error_msg = f"Invalid {header} value. Expected {expected_value} got {actual_value}"
                    logger.error(error_msg)
                    raise HTTPException(status_code=400, detail=error_msg)

        await SSE_SEMAPHORE.acquire()
    try:
        # Validate session
        with sentry_sdk.start_span(op="session.validate", description="Validate Session") as span:
            sel_stmt = select(Session).where(Session.id == session_id)
            sess_res = await db.execute(sel_stmt)
            session_db = sess_res.scalar_one_or_none()
            if not session_db:
                raise HTTPException(status_code=404, detail="Session not found")

        # Retrieve model client
        with sentry_sdk.start_span(op="model.client", description=f"Get Model Client ({model})") as span:
            try:
                client_wrapper = await get_model_client_dependency(model)

                # Check if client was successfully created
                if client_wrapper.get("error"):
                    error_msg = client_wrapper.get("error")
                    logger.error(f"Error creating client for {model}: {error_msg}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Error initializing model client: {error_msg}",
                    )

                client = client_wrapper.get("client")
                if not client:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to initialize client for model: {model}",
                    )

                supports_streaming = client_wrapper.get("supports_streaming", True)
                if not supports_streaming:
                    raise HTTPException(
                        status_code=400, detail="Model doesn't support streaming"
                    )
            except Exception as e:
                logger.exception(f"Error getting model client for {model}")
                sentry_sdk.capture_exception(e)
                raise HTTPException(
                    status_code=500, detail=f"Error retrieving model client: {str(e)}"
                )

        logger.info(f"Starting streaming response with model: {model}")

        # Add appropriate SSE headers
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
                "X-Accel-Buffering": "no",  # Helps with nginx proxying
            },
        )
    except Exception as exc:
        logger.exception(f"Error in chat_sse: {str(exc)}")
        sentry_sdk.capture_exception(exc)
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        SSE_SEMAPHORE.release()


def sse_json(data: Dict[str, Any]) -> str:
    """
    Format SSE data lines as: data: {...}\n\n
    """
    return "data: " + json.dumps(data) + "\n\n"


@sentry_sdk.trace()
async def generate_stream_chunks(
    request: Request,
    message: str,
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: UUID,
    client: Any,
) -> AsyncIterator[str]:
    """
    Async generator yielding SSE data chunks from streaming model responses.
    Optimized to handle both DeepSeek-R1 and O-series models properly.

    Args:
        request: The FastAPI request object
        message: The user's input message
        model_name: The model identifier to use
        reasoning_effort: The reasoning effort level (low/medium/high)
        db: The database session
        session_id: The conversation session UUID
        client: The model client instance (either Azure ChatCompletionsClient or OpenAI client)

    Yields:
        Server-Sent Events formatted strings with model outputs
    """
    full_content = ""
    usage_data: Dict[str, Any] = {}
    user_message = {"role": "user", "content": message}
    messages: List[Dict[str, str]] = []
    stream_start_time = time.time()

    try:
        # Identify model types
        with sentry_sdk.start_profiling_span(description="Prepare Streaming Request"):
            is_deepseek = is_deepseek_model(model_name)
            is_o_series = is_o_series_model(model_name)

            # Log client information
            client_info = f"Type: {type(client).__name__}"
            logger.info(f"Client info: {client_info}")

            # Prepare messages based on model type
            if is_o_series:
                # O-series uses "developer" role instead of "system"
                messages = [
                    {"role": "developer", "content": "You are a helpful assistant."},
                    user_message,
                ]
            else:
                # Other models just need the user message
                messages = [user_message]

            # Prepare request parameters based on model type
            params: Dict[str, Any] = {
                "messages": messages,
                "stream": True,
            }

            if is_deepseek:
                params.update(
                    {
                        "temperature": 0.5,
                        "max_tokens": config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
                    }
                )
            elif is_o_series:
                params.update(
                    {
                        "max_completion_tokens": config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
                        "reasoning_effort": reasoning_effort,
                    }
                )
            else:
                params.update(
                    {
                        "temperature": 0.7,
                        "max_tokens": 4096,
                    }
                )

        # Create streaming request based on client type
        try:
            # Handle differences in client APIs
            with sentry_sdk.start_span(op="model.stream", description=f"Stream Model Response ({model_name})") as span:
                if hasattr(client, "chat") and hasattr(client.chat, "completions"):
                    # OpenAI-style client (for O-series models)
                    logger.info(f"Using OpenAI-style client with model: {model_name}")

                    # For OpenAI client, create the streaming response
                    stream_response = client.chat.completions.create(
                        model=model_name, **params
                    )

                    # OpenAI client returns a Stream object that must be iterated synchronously
                    for chunk in stream_response:
                        # Extract content from chunk
                        chunk_content = ""
                        if hasattr(chunk, "choices") and chunk.choices:
                            delta = chunk.choices[0].delta
                            if hasattr(delta, "content") and delta.content is not None:
                                chunk_content = delta.content

                        # Add to full content
                        full_content += chunk_content

                        # Handle thinking blocks
                        if "<think>" in chunk_content:
                            yield sse_json(
                                {
                                    "choices": [
                                        {
                                            "delta": {"content": chunk_content},
                                            "finish_reason": None,
                                        }
                                    ],
                                    "model": model_name,
                                    "thinking_block": True,
                                }
                            )
                        else:
                            yield sse_json(
                                {
                                    "choices": [
                                        {
                                            "delta": {"content": chunk_content},
                                            "finish_reason": None,
                                        }
                                    ],
                                    "model": model_name,
                                }
                            )

                        # Use asyncio.sleep to allow other tasks to run
                        await asyncio.sleep(0)

                else:
                    # Azure AI Inference ChatCompletionsClient (for DeepSeek models)
                    logger.info(f"Using ChatCompletionsClient with model: {model_name}")

                    # For ChatCompletionsClient, create the streaming response
                    stream_response = client.complete(
                        messages=messages,
                        temperature=0.5 if is_deepseek else params.get("temperature", 0.7),
                        max_tokens=params.get("max_tokens", 4096),
                        stream=True,
                    )

                    # The StreamingChatCompletions object is synchronously iterable
                    for chunk in stream_response:
                        # Extract content from chunk
                        chunk_content = ""
                        if hasattr(chunk, "choices") and chunk.choices:
                            choice = chunk.choices[0]
                            if hasattr(choice, "delta") and hasattr(
                                choice.delta, "content"
                            ):
                                chunk_content = choice.delta.content or ""

                        # Add to full content
                        full_content += chunk_content

                        # Handle thinking blocks
                        if "<think>" in chunk_content:
                            yield sse_json(
                                {
                                    "choices": [
                                        {
                                            "delta": {"content": chunk_content},
                                            "finish_reason": None,
                                        }
                                    ],
                                    "model": model_name,
                                    "thinking_block": True,
                                }
                            )
                        else:
                            yield sse_json(
                                {
                                    "choices": [
                                        {
                                            "delta": {"content": chunk_content},
                                            "finish_reason": None,
                                        }
                                    ],
                                    "model": model_name,
                                }
                            )

                        # Allow other tasks to run
                        await asyncio.sleep(0)

        except Exception as e:
            logger.exception(f"Error during streaming process: {str(e)}")
            sentry_sdk.capture_exception(e)
            yield sse_json({"error": str(e)})
            return

        # Final chunk with a "stop" reason
        yield sse_json({"choices": [{"finish_reason": "stop"}]})
        yield "event: complete\ndata: done\n\n"

        # Record usage statistics based on token counting
        with sentry_sdk.start_span(op="usage.record", description="Record Usage Statistics") as span:
            prompt_tokens = 0
            completion_tokens = 0

            # Count tokens based on the message format
            message_text = "\n".join([m.get("content", "") for m in messages])
            prompt_tokens = count_tokens(message_text, model_name)
            completion_tokens = count_tokens(full_content, model_name)
            total_tokens = prompt_tokens + completion_tokens

            usage_data = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }

            # Calculate streaming duration
            stream_duration = time.time() - stream_start_time
            
            # Add streaming metrics to Sentry
            sentry_sdk.set_measurement("stream_duration_seconds", stream_duration)
            sentry_sdk.set_measurement("prompt_tokens", prompt_tokens)
            sentry_sdk.set_measurement("completion_tokens", completion_tokens)
            sentry_sdk.set_measurement("total_tokens", total_tokens)

            # Log successful completion
            logger.info(f"Successfully completed streaming response for {model_name} in {stream_duration:.2f}s")

            # Record usage and save conversation
            stats_service = ModelStatsService(db)
            await stats_service.record_usage(
                model=model_name,
                session_id=session_id,
                usage=usage_data,
            )

            # Save the conversation to the database
            from services.chat_service import save_conversation

            await save_conversation(
                db_session=db,
                session_id=session_id,
                model_name=model_name,
                user_text=message,
                assistant_text=full_content,
                formatted_assistant_text=full_content,
                raw_response=None,
            )

    except Exception as exc:
        logger.exception(f"Error in generate_stream_chunks: {exc}")
        sentry_sdk.capture_exception(exc)
        yield sse_json({"error": str(exc)})
        return


def sse_json(data: Dict[str, Any]) -> str:
    """
    Format SSE data lines as: data: {...}\n\n
    """
    return f"data: {json.dumps(data)}\n\n"
