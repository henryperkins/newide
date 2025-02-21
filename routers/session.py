from fastapi import APIRouter
from uuid import uuid4
from datetime import datetime
from pydantic import BaseModel

class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    expires_in: int

router = APIRouter()

@router.get("/create", response_model=SessionResponse)
@router.post("/create", response_model=SessionResponse)
async def create_session():
    session_id = str(uuid4())
    return SessionResponse(
        session_id=session_id,
        created_at=datetime.utcnow().isoformat(),
        expires_in=3600
    )