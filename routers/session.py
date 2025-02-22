from fastapi import APIRouter, Depends, BackgroundTasks
from uuid import uuid4
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, Any
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session, Session
import config
from services.azure_search_service import AzureSearchService
from clients import get_model_client

class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    expires_in: int

router = APIRouter()

async def initialize_session_services(session_id: str, azure_client: Any):
    search_service = AzureSearchService(azure_client)
    await search_service.create_search_index(session_id)

@router.get("/create", response_model=SessionResponse)
async def create_session(background_tasks: BackgroundTasks, db_session: AsyncSession = Depends(get_db_session), azure_client: Optional[Any] = Depends(get_model_client)):
    session_id = str(uuid4())
    
    # Create session in database
    new_session = Session(
        id=session_id,
        expires_at=datetime.utcnow() + timedelta(minutes=config.SESSION_TIMEOUT_MINUTES)
    )
    db_session.add(new_session)
    await db_session.commit()
    
    # Initialize Azure services in background
    if azure_client:
        background_tasks.add_task(initialize_session_services, session_id, azure_client)
    
    return SessionResponse(
        session_id=session_id,
        created_at=datetime.utcnow().isoformat(),
        expires_in=config.SESSION_TIMEOUT_MINUTES * 60
    )

# Also support POST method
router.post("/create", response_model=SessionResponse)(create_session)
