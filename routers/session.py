from fastapi import APIRouter, Depends, BackgroundTasks, Request
from uuid import uuid4
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, Any
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session, Session
import config
from services.azure_search_service import AzureSearchService
from clients import get_model_client
from logging_config import logger

class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    expires_in: int


router = APIRouter()

async def initialize_session_services(session_id: str, azure_client: Any):
    # Get the current model deployment name
    azure_deployment = getattr(azure_client, "azure_deployment", "")
    
    # Only initialize Azure search if this is the DeepSeek-R1 model
    if azure_deployment == "DeepSeek-R1":
        logger.info(f"Initializing Azure Search for DeepSeek-R1 session {session_id}")
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
    
    if not azure_client:
        # Log an error indicating that no Azure client was provided, which can cause a 500
        logger.error(f"[create_session] No Azure client resolved for session ID {session_id}.")
    else:
        background_tasks.add_task(initialize_session_services, session_id, azure_client)
    
    return SessionResponse(
        session_id=session_id,
        created_at=datetime.utcnow().isoformat(),
        expires_in=config.SESSION_TIMEOUT_MINUTES * 60
    )

# Provide a simple GET /api/session endpoint so that references to fetch('/api/session')
# don't 404. Here we simply return a minimal response indicating no active session
# unless the project chooses to link it to a user's cookie or other param in the future.

@router.get("", response_model=dict)
async def get_current_session(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session)
):
    # Try to get session ID from request cookies
    from typing import Optional
    
    async def get_session_from_request(request: Request, db_session: AsyncSession):
        # Try to get session ID from cookie
        session_id = request.cookies.get("session_id")
        
        # If no cookie, check for session ID in headers
        if not session_id:
            session_id = request.headers.get("X-Session-ID")
        
        # If still no session ID, return None
        if not session_id:
            return None
            
        # Validate UUID format
        from uuid import UUID
        try:
            UUID(session_id, version=4)
        except (ValueError, TypeError):
            logger.warning(f"Invalid session ID format: {session_id}")
            return None
            
        # Validate session in database
        from sqlalchemy import select
        from models import Session
        
        stmt = select(Session).where(Session.id == session_id)
        result = await db_session.execute(stmt)
        session = result.scalar_one_or_none()
        
        # Check if session exists and is not expired
        if session and (not session.expires_at or session.expires_at > datetime.utcnow()):
            return session
            
        return None
    
    # Try to get session from request
    session = None
    try:
        session = await get_session_from_request(request, db_session)
    except Exception as e:
        logger.error(f"Error getting session from request: {str(e)}")
    
    # If session found, return session info
    if session:
        return {
            "id": str(session.id),
            "last_model": session.last_model,
            "expires_at": session.expires_at.isoformat() if session.expires_at else None
        }
    
    # If no session found, return placeholder
    return {"id": None, "last_model": None, "message": "No active session. Call '/api/session/create' to generate a new session."}

# Also support POST method
router.post("/create", response_model=SessionResponse)(create_session)
