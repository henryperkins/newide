from fastapi import APIRouter, Depends, BackgroundTasks, Request, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic_models import SessionResponse, SessionInfoResponse
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from services.azure_search_service import AzureSearchService
from clients import get_model_client_dependency
from logging_config import logger
from typing import Optional, Any
import config
import uuid
from services.tracing_utils import trace_function, profile_block

# Import the SessionManager
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


@router.get("")
@trace_function(op="session.get", name="get_current_session")
async def get_current_session(
    request: Request,
    session_id: Optional[str] = None,
    db_session: AsyncSession = Depends(get_db_session),
):
    """Get current session information"""
    try:
        with profile_block(description="Get Current Session", op="session.retrieve"):
            # Use explicit session_id if provided
            if session_id:
                # Validate UUID format
                try:
                    session_uuid = uuid.UUID(session_id)
                    from sqlalchemy import select
                    from models import Session

                    stmt = select(Session).where(Session.id == session_uuid)
                    result = await db_session.execute(stmt)
                    session_obj = result.scalar_one_or_none()

                    if session_obj:
                        return {
                            "id": str(session_obj.id),
                            "created_at": (
                                session_obj.created_at.isoformat()
                                if session_obj.created_at
                                else None
                            ),
                            "last_activity": (
                                session_obj.last_activity.isoformat()
                                if session_obj.last_activity
                                else None
                            ),
                            "expires_at": (
                                session_obj.expires_at.isoformat()
                                if session_obj.expires_at
                                else None
                            ),
                            "last_model": session_obj.last_model,
                        }

                except (ValueError, TypeError) as e:
                    return {"id": None, "message": f"Invalid session ID format: {str(e)}"}

            # If no explicit session_id or not found, try SessionManager
            session_obj = await SessionManager.get_session_from_request(request, db_session)

            if session_obj:
                return {
                    "id": str(session_obj.id),
                    "created_at": (
                        session_obj.created_at.isoformat() if session_obj.created_at else None
                    ),
                    "last_activity": (
                        session_obj.last_activity.isoformat() if session_obj.last_activity else None
                    ),
                    "expires_at": (
                        session_obj.expires_at.isoformat() if session_obj.expires_at else None
                    ),
                    "last_model": session_obj.last_model,
                }

            return {
                "id": None,
                "message": "No active session. Call '/api/session/create' to generate a new session.",
            }

    except Exception as e:
        logger.exception(f"Error in get_current_session: {str(e)}")
        return {
            "id": None,
            "error": str(e),
            "message": "Error retrieving session information",
        }


@router.post("/create")
@trace_function(op="session.create", name="create_session")
async def create_session(
    background_tasks: BackgroundTasks,
    db_session: AsyncSession = Depends(get_db_session),
    client_wrapper: dict = Depends(get_model_client_dependency),
):
    """Create a new session"""
    try:
        with profile_block(description="Create New Session", op="session.create") as span:
            from session_utils import SessionManager

            # Extract client from the wrapper
            azure_client = client_wrapper.get("client") if client_wrapper else None
            span.set_data("has_azure_client", azure_client is not None)

            # Create a new session
            new_session = await SessionManager.create_session(db_session)
            span.set_data("session_id", str(new_session.id))

            # Initialize session services in background
            if azure_client:
                with profile_block(description="Initialize Services", op="session.init_services") as init_span:
                    init_span.set_data("azure_deployment", getattr(azure_client, "azure_deployment", "unknown"))
                    background_tasks.add_task(
                        initialize_session_services, str(new_session.id), azure_client
                    )

            response = JSONResponse(
                {
                    "session_id": str(new_session.id),
                    "created_at": new_session.created_at.isoformat(),
                    "expires_in": config.SESSION_TIMEOUT_MINUTES * 60,
                    "expires_at": new_session.expires_at.isoformat(),
                },
                status_code=201,
            )
            response.set_cookie(
                key="session_id",
                value=str(new_session.id),
                httponly=True,
                secure=True,
                samesite="None",
            )
            
            span.set_data("success", True)
            return response

    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        if "rate limit" in str(e).lower():
            raise HTTPException(
                status_code=429,
                detail="Too many session creation requests. Please try again later.",
                headers={"Retry-After": "60"},
            )
        raise HTTPException(
            status_code=500, detail=f"Failed to create session: {str(e)}"
        )

@router.post("/refresh", response_model=SessionResponse) 
@trace_function(op="session.refresh", name="refresh_session")
async def refresh_session(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session)
):
    """Refresh session expiration time"""
    try:
        with profile_block(description="Refresh Session", op="session.refresh"):
            session_obj = await SessionManager.get_session_from_request(
                request, db_session, require_valid=True
            )

            if session_obj:
                success = await SessionManager.extend_session(session_obj.id, db_session)
                if success:
                    response = JSONResponse(session_to_response(session_obj))
                    response.set_cookie(
                        key="session_id",
                        value=str(session_obj.id),
                        httponly=True,
                        secure=True, 
                        samesite="None",
                    )
                    return response

            raise HTTPException(status_code=400, detail="Failed to refresh session")

    except Exception as e:
        logger.exception(f"Error refreshing session: {str(e)}")
        raise HTTPException(status_code=500, detail="Error refreshing session")

@router.post("/model", response_model=SessionInfoResponse)
@trace_function(op="session.update_model", name="update_session_model") 
async def update_session_model(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session)
):
    """Update the model associated with a session"""
    try:
        with profile_block(description="Update Session Model", op="session.update_model"):
            session_obj = await SessionManager.get_session_from_request(
                request, db_session, require_valid=True
            )

            # Get model from request body
            body = await request.json()
            model = body.get("model")

            if not model:
                return {"status": "error", "message": "Model name is required"}

            # Update session model
            success = await SessionManager.update_session_model(session_obj.id, model, db_session)
            if success:
                return session_to_response(session_obj)

            raise HTTPException(status_code=400, detail="Failed to update session model")

    except Exception as e:
        logger.exception(f"Error updating session model: {str(e)}")
        raise HTTPException(status_code=500, detail="Error updating session model")
    
def session_to_response(session) -> SessionResponse:
    """Convert a Session model to a SessionResponse model"""
    if not session:
        raise ValueError("Session cannot be None")

    return SessionResponse(
        id=str(session.id),
        created_at=session.created_at,
        expires_at=session.expires_at,
        last_activity=session.last_activity,
        last_model=session.last_model,
    )