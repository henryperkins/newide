# routers/session.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_db_session, Session, Conversation
from errors import create_error_response
from models import ConversationResponse, ClearConversationResponse, ConversationMessage
import uuid
import datetime
import config

router = APIRouter(prefix="/session")

@router.post("/new")
async def new_session(db_session: AsyncSession = Depends(get_db_session)):
    session_id = uuid.uuid4()
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=config.SESSION_TIMEOUT_MINUTES)
    new_session_obj = Session(id=session_id, expires_at=expires_at)
    db_session.add(new_session_obj)
    await db_session.commit()
    return {"session_id": str(session_id)}

@router.get("/conversation/{session_id}", response_model=ConversationResponse)
async def get_conversation(session_id: str, db_session: AsyncSession = Depends(get_db_session)):
    try:
        session_obj = await db_session.get(Session, session_id)
        if not session_obj:
            raise create_error_response(
                status_code=404,
                code="session_not_found",
                message="Session not found",
                error_type="not_found",
                param="session_id",
            )
        result = await db_session.execute(text("""
            SELECT role, content, timestamp FROM conversations 
            WHERE session_id = :session_id::uuid
            ORDER BY timestamp ASC
            LIMIT 50
        """), {"session_id": session_id})
        history = result.mappings().all()
        return ConversationResponse(
            conversation=[
                ConversationMessage(
                    role=row["role"],
                    content=row["content"],
                    timestamp=row["timestamp"].isoformat(),
                ) for row in history
            ],
            total_messages=len(history),
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error retrieving conversation history",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )

@router.delete("/conversation/{session_id}", response_model=ClearConversationResponse)
async def clear_conversation(session_id: str, db_session: AsyncSession = Depends(get_db_session)):
    try:
        session_obj = await db_session.get(Session, session_id)
        if not session_obj:
            raise create_error_response(
                status_code=404,
                code="session_not_found",
                message="Session not found",
                error_type="not_found",
                param="session_id",
            )
        result = await db_session.execute(text("""
            SELECT COUNT(*) as count FROM conversations
            WHERE session_id = :session_id
        """), {"session_id": session_id})
        message_count = result.scalar()
        await db_session.execute(text("DELETE FROM conversations WHERE session_id = :session_id"), {"session_id": session_id})
        await db_session.commit()
        return ClearConversationResponse(
            message="Conversation history cleared",
            cleared_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            message_count=message_count,
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error clearing conversation history",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )
