from fastapi import APIRouter, Depends
from uuid import uuid4
from datetime import datetime, timedelta
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session, Session
import config

class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    expires_in: int

router = APIRouter()

@router.get("/create", response_model=SessionResponse)
@router.post("/create", response_model=SessionResponse)
async def create_session(db_session: AsyncSession = Depends(get_db_session)):
    session_id = str(uuid4())
    
    # Create session in database
    new_session = Session(
        id=session_id,
        expires_at=datetime.utcnow() + timedelta(minutes=config.SESSION_TIMEOUT_MINUTES)
    )
    db_session.add(new_session)
    await db_session.commit()
    
    return SessionResponse(
        session_id=session_id,
        created_at=datetime.utcnow().isoformat(),
        expires_in=config.SESSION_TIMEOUT_MINUTES * 60
    )
