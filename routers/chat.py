import uuid
import json
import re
import time
import asyncio
from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, insert, delete, update, func
from sqlalchemy.ext.asyncio import AsyncSession

# Internal modules (adjust as needed)
from database import get_db_session
from routers.security import get_current_user
import logging
from logging_config import logger

from bleach import clean as bleach_clean
from utils import (
    count_tokens,
    handle_client_error,
    is_o_series_model,
    is_deepseek_model,
)
from clients import get_model_client_dependency
from services.model_stats_service import ModelStatsService
from services.chat_service import save_conversation
from services.config_service import ConfigService, get_config_service

# Models & Schemas (from your own code)
from models import Session, User, Conversation
from pydantic_models import (
    CreateChatCompletionRequest,
    ChatMessage,
    ChatCompletionResponse,
    ChatCompletionUsage,
    ChatCompletionChoice,
    ErrorResponse,
)

router = APIRouter(prefix="/chat")

# Concurrency settings for SSE
MAX_SSE_CONNECTIONS = 10
SSE_SEMAPHORE = asyncio.Semaphore(MAX_SSE_CONNECTIONS)

# Defaults for your DeepSeek or O-series models, if relevant
DEEPSEEK_R1_DEFAULT_MAX_TOKENS = 131072  # 128k context window
DEEPSEEK_R1_DEFAULT_TEMPERATURE = 0.0
O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS = 40000


# -------------------------------------------------------------------------
# Helper: Expand chain-of-thought blocks in HTML
# -------------------------------------------------------------------------
def expand_chain_of_thought(full_content: str, request: Request) -> str:
    """
    Replaces <think>...</think> blocks with a hidden HTML expansion
    for chain-of-thought style content. Uses CSP nonce and DOMPurify.
    """
    if not full_content:
        return full_content

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(full_content, "html.parser")
    think_blocks = soup.find_all("think")

    for block in think_blocks:
        block_html = str(block)
        sanitized_html = bleach_clean(block_html, tags=['think', 'div', 'button', 'span', 'pre'], attributes={'div': ['class', 'nonce'], 'button': ['class', 'aria-expanded'], 'span': ['class'], 'pre': ['class']})
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

    final_html = bleach_clean(str(soup), tags=['div', 'button', 'span', 'pre'], attributes={'div': ['class', 'nonce'], 'button': ['class', 'aria-expanded'], 'span': ['class'], 'pre': ['class']})
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
            raise HTTPException(status_code=404, detail="Conversation not found")

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
        body = await request.json()
        archived_val = body.get("archived", True)

        # Validate session
        sel_stmt = select(Session).where(Session.id == conversation_id)
        sess_res = await db.execute(sel_stmt)
        session_db = sess_res.scalar_one_or_none()
        if not session_db:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Update archived value in all rows
        upd_stmt = (
            update(Conversation)
            .where(Conversation.session_id == session_db.id)
            .values(archived=archived_val)
        )
        await db.execute(upd_stmt)
        await db.commit()

        return {"status": "success", "archived": archived_val}
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


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

        if pinned is not None:
            base_query = base_query.having(func.bool_or(Conversation.pinned) == pinned)

        if archived is not None:
            base_query = base_query.having(func.bool_or(Conversation.archived) == archived)

        if search:
            pattern = f"%{search}%"
            base_query = base_query.where(
                (Conversation.title.ilike(pattern))
                | (Conversation.content.ilike(pattern))
            )

        # Count distinct sessions (for pagination)
        count_stmt = select(func.count(func.distinct(Conversation.session_id)))
        total_res = await db.execute(count_stmt)
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
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/conversations/store")
async def store_conversation(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Store conversation data from client (user or system messages)."""
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
    This is a stub showing where you'd integrate O-series or DeepSeek calls.
    """
    try:
        if not request.messages:
            raise HTTPException(status_code=400, detail="Missing 'messages' field")

        model_name = request.model or "o1"

        # Acquire the model client
        client_wrapper = await get_model_client_dependency(model_name)
        client = client_wrapper["client"]

        # Mocked response for demonstration
        response_data = {
            "id": f"chatcmpl-{uuid.uuid4()}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_name,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello from the AI."},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
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
        try:
            error_data = exc.response.json()
            if "content_filter_results" in error_data:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "content_filtered",
                        "filter_results": error_data["content_filter_results"],
                    },
                ) from exc
        except (AttributeError, json.JSONDecodeError):
            pass
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# -------------------------------------------------------------------------
# Streaming SSE Endpoint
# -------------------------------------------------------------------------
@router.get("/sse")
async def chat_sse(
    request: Request,
    session_id: UUID,
    model: str,
    message: str,
    developer_config: Optional[str] = None,
    reasoning_effort: str = "medium",
    db: AsyncSession = Depends(get_db_session),
):
    """
    SSE endpoint for streaming chat responses from your model.
    Uses an in-memory concurrency limiter (SSE_SEMAPHORE).
    """
    await SSE_SEMAPHORE.acquire()
    try:
        # Validate session
        sel_stmt = select(Session).where(Session.id == session_id)
        sess_res = await db.execute(sel_stmt)
        session_db = sess_res.scalar_one_or_none()
        if not session_db:
            raise HTTPException(status_code=404, detail="Session not found")

        # Retrieve model client
        client_wrapper = await get_model_client_dependency(model)
        client = client_wrapper["client"]
        if not client or not client_wrapper.get("supports_streaming", False):
            raise HTTPException(status_code=400, detail="Model doesn't support streaming")

        # Return the streaming response
        return StreamingResponse(
            generate_stream_chunks(
                request=request,
                message=message,
                model_name=model,
                reasoning_effort=reasoning_effort,
                db=db,
                session_id=session_id,
                developer_config=developer_config,
                client=client,
            ),
            media_type="text/event-stream",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        SSE_SEMAPHORE.release()


async def generate_stream_chunks(
    request: Request,
    message: str,
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: UUID,
    developer_config: Optional[str],
    client: Any,
):
    """
    Async generator yielding SSE data chunks from your streaming model.
    Replace this stub with your actual streaming code to Azure/DeepSeek/etc.
    """
    full_content = ""
    usage_block: Dict[str, Any] = {}

    try:
        # Determine if chain-of-thought expansion is needed
        enable_thinking = "true" if "deepseek" in model_name.lower() else "false"

        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": message}],
            stream=True,
            headers={
                "x-ms-thinking-format": "html" if enable_thinking else "none",
                "x-ms-streaming-version": "2024-05-01-preview",
            },
        )

        try:
            async for chunk in response:
                content = chunk.choices[0].delta.content or ""
                full_content += content

                if enable_thinking == "true":
                    processed_content = expand_chain_of_thought(content, request)
                    yield sse_json({
                        "choices": [{
                            "delta": {
                                "content": processed_content,
                                "role": "assistant"
                            }
                        }],
                        "model": model_name,
                        "usage": {
                            "completion_tokens": len(processed_content.split()),
                            "reasoning_tokens": len(re.findall(r"", processed_content))
                        }
                    })
                else:
                    yield sse_json({"choices": [{"delta": {"content": content}}]})
        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.exception(f"SSE error: {e}")
            raise HTTPException(status_code=500, detail=f"SSE failed: {e}")

        # Final chunk with stop reason
        yield sse_json({"choices": [{"finish_reason": "stop"}]})
        yield "event: complete\ndata: done\n\n"

        # Store user & assistant messages in DB if desired
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
            raw_response={
                "streaming": True,
                "final_content": full_content,
                "token_usage": usage_block,
            },
        )
        db.add_all([user_msg, assistant_msg])
        await db.commit()

    except asyncio.CancelledError:
        return
    except Exception as exc:
        error_payload = {
            "error": {
                "message": "Streaming error occurred",
                "code": 500,
                "type": "server_error",
                "details": str(exc),
            }
        }
        yield sse_json(error_payload)


def sse_json(data: Dict[str, Any]) -> str:
    """
    Utility to format SSE data lines as:
    data: {...}\n\n
    """
    return "data: " + json.dumps(data) + "\n\n"
