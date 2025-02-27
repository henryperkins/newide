# routers/session.py
from fastapi import APIRouter, Depends, BackgroundTasks, Request, HTTPException
from pydantic_models import SessionResponse, SessionInfoResponse, ErrorResponse
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from services.azure_search_service import AzureSearchService
from clients import get_model_client_dependency
from logging_config import logger
from typing import Optional, Any
import config

# Import the SessionManager - using explicit import to avoid circular imports
from session_utils import SessionManager

router = APIRouter()

async def initialize_session_services(session_id: str, azure_client: Any):
    """Initialize Azure services for a new session"""
    # Get the current model deployment name
    azure_deployment = getattr(azure_client, "azure_deployment", "")
    
    # Only initialize Azure search if this is the DeepSeek-R1 model
    if azure_deployment == "DeepSeek-R1":
        logger.info(f"Initializing Azure Search for DeepSeek-R1 session {session_id}")
        search_service = AzureSearchService(azure_client)
        await search_service.create_search_index(session_id)

# Then in routers/session.py, replace the existing session handling with:

@router.get("")
async def get_current_session(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session)
):
    """Get current session information"""
    from session_utils import SessionManager
    
    session = await SessionManager.get_session_from_request(request, db_session)
    
    if session:
        return {
            "id": str(session.id),
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "last_activity": session.last_activity.isoformat() if session.last_activity else None,
            "expires_at": session.expires_at.isoformat() if session.expires_at else None,
            "last_model": session.last_model,
        }
    
    return {
        "id": None,
        "message": "No active session. Call '/api/session/create' to generate a new session."
    }

@router.post("/create")
async def create_session(
    background_tasks: BackgroundTasks,
    db_session: AsyncSession = Depends(get_db_session)
):
    """Create a new session"""
    from session_utils import SessionManager
    
    # Create a new session
    new_session = await SessionManager.create_session(db_session)
    
    # Initialize session services in background
    if azure_client:
        background_tasks.add_task(
            initialize_session_services, 
            str(new_session.id), 
            azure_client
        )
    
    return {
        "session_id": str(new_session.id),
        "created_at": new_session.created_at.isoformat(),
        "expires_in": config.SESSION_TIMEOUT_MINUTES * 60
    }

@router.post("/refresh", response_model=SessionResponse)
async def refresh_session(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session)
):
    """Refresh session expiration time"""
    session = await SessionManager.get_session_from_request(
        request, db_session, require_valid=True
    )
    
    # Extend session if found
    if session:
        success = await SessionManager.extend_session(session.id, db_session)
        if success:
            return session_to_response(session)
    
    raise HTTPException(status_code=400, detail="Failed to refresh session")

@router.post("/model", response_model=SessionInfoResponse)
async def update_session_model(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session)
):
    """Update the model associated with a session"""
    session = await SessionManager.get_session_from_request(
        request, db_session, require_valid=True
    )
    
    # Get model from request body
    body = await request.json()
    model = body.get("model")
    
    if not model:
        return {"status": "error", "message": "Model name is required"}
    
    # Update session model
    success = await SessionManager.update_session_model(
        session.id, model, db_session
    )
    
    if success:
        return session_to_response(session)
    
    raise HTTPException(status_code=400, detail="Failed to update session model")

# Remove duplicate route - we already defined a POST route above
