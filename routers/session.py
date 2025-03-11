from fastapi import APIRouter, Depends, BackgroundTasks, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic_models import SessionResponse, SessionInfoResponse
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from services.azure_search_service import AzureSearchService
from clients import get_model_client_dependency
from logging_config import logger
from typing import Optional, Any
from datetime import datetime, timedelta
import config
import uuid
from services.tracing_utils import trace_function, profile_block

# Import the SessionService for unified session management
from services.session_service import SessionService

router = APIRouter()


async def initialize_session_services(session_id: str, azure_client: Any):
    """Initialize Azure services for a new session"""
    try:
        # Get the current model deployment name
        azure_deployment = getattr(azure_client, "azure_deployment", "")

        # Only initialize Azure search if this is the DeepSeek-R1 model
        if azure_deployment == "DeepSeek-R1":
            logger.info(f"Initializing Azure Search for DeepSeek-R1 session {session_id}")
            search_service = AzureSearchService(azure_client)
            await search_service.create_search_index(session_id)
            
    except Exception as e:
        logger.error(f"Error initializing Azure services for session {session_id}: {str(e)}")
        # Don't rethrow - we don't want background task errors to affect the response


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

            # If no explicit session_id or not found, try to extract session_id manually
            try:
                # Extract session_id from various sources manually
                extracted_session_id = None
                
                # 1. Check cookie
                cookie_session_id = request.cookies.get("session_id")
                if cookie_session_id:
                    extracted_session_id = cookie_session_id
                    logger.debug(f"Got session_id from cookie: {extracted_session_id}")
                
                # 2. Check query parameters
                if not extracted_session_id:
                    query_params = request.query_params
                    if "session_id" in query_params:
                        extracted_session_id = query_params["session_id"]
                        logger.debug(f"Got session_id from query params: {extracted_session_id}")
                
                # 3. Check headers
                if not extracted_session_id:
                    header_session_id = request.headers.get("X-Session-ID")
                    if header_session_id:
                        extracted_session_id = header_session_id
                        logger.debug(f"Got session_id from header: {extracted_session_id}")
                
                # If no session_id found
                if not extracted_session_id:
                    return {
                        "id": None,
                        "message": "No active session. Call '/api/session/create' to generate a new session.",
                    }
                
                # Validate the extracted session ID
                try:
                    session_uuid = uuid.UUID(extracted_session_id)
                    
                    # Query for the session directly
                    from sqlalchemy import select
                    from models import Session
                    
                    stmt = select(Session).where(Session.id == session_uuid)
                    result = await db_session.execute(stmt)
                    session_obj = result.scalar_one_or_none()
                    
                    if not session_obj:
                        return {
                            "id": None,
                            "message": "Session not found or expired. Create a new session.",
                        }
                    
                    # Check if session is expired
                    if session_obj.expires_at:
                        expires_at_naive = session_obj.expires_at.replace(tzinfo=None)
                        now = datetime.utcnow()
                        if expires_at_naive < now:
                            return {
                                "id": None,
                                "message": "Session expired. Create a new session.",
                            }
                    
                    # Update last activity using SQLAlchemy update
                    from sqlalchemy import update
                    
                    await db_session.execute(
                        update(Session)
                        .where(Session.id == session_uuid)
                        .values(last_activity=datetime.utcnow())
                    )
                    await db_session.commit()
                    
                    # Return formatted session info
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
                    
                except ValueError:
                    return {
                        "id": None,
                        "message": f"Invalid session ID format: {extracted_session_id}",
                    }
            except Exception as e:
                logger.exception(f"Error in get_session_from_request: {str(e)}")
                return {
                    "id": None,
                    "error": str(e),
                    "message": "Error retrieving session from request",
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
            # Extract client from the wrapper
            azure_client = client_wrapper.get("client") if client_wrapper else None
            span.set_data("has_azure_client", azure_client is not None)

            # Create a new session using the SessionService
            try:
                # Generate a UUID for the new session first
                session_id = uuid.uuid4()
                logger.info(f"Creating new session with ID: {session_id}")
                
                # Create a basic session record
                from models import Session
                
                # Calculate expiration time
                session_timeout = config.SESSION_TIMEOUT_MINUTES
                expires_at = datetime.utcnow() + timedelta(minutes=session_timeout)
                
                # Create session directly
                new_session = Session(
                    id=session_id,
                    created_at=datetime.utcnow(),
                    last_activity=datetime.utcnow(),
                    expires_at=expires_at,
                    request_count=0
                )
                
                # Add to database and commit
                db_session.add(new_session)
                await db_session.commit()
                await db_session.refresh(new_session)
                
                # Log success
                span.set_data("session_id", str(session_id))
                logger.info(f"Successfully created session: {session_id}")
                
                # Initialize session services in background
                if azure_client:
                    with profile_block(description="Initialize Services", op="session.init_services") as init_span:
                        init_span.set_data("azure_deployment", getattr(azure_client, "azure_deployment", "unknown"))
                        background_tasks.add_task(
                            initialize_session_services, str(session_id), azure_client
                        )
                
                # Create the response
                response = JSONResponse(
                    {
                        "session_id": str(session_id),
                        "created_at": new_session.created_at.isoformat(),
                        "expires_in": session_timeout * 60,
                        "expires_at": expires_at.isoformat(),
                    },
                    status_code=201,
                )
                
                # Set session cookie
                response.set_cookie(
                    key="session_id",
                    value=str(session_id),
                    httponly=True,
                    secure=True,
                    samesite="none",
                )
                
                span.set_data("success", True)
                return response
            except Exception as e:
                logger.error(f"Unexpected error in create_session: {str(e)}")
                # Capture detailed error information
                logger.exception("Full exception details:")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create session: {str(e)}"
                )

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
            # Extract session ID from cookie, header, or query params
            session_id = None
            session_id = request.cookies.get("session_id")
            if not session_id:
                session_id = request.headers.get("X-Session-ID")
            
            if not session_id:
                # Check query params
                try:
                    if "session_id" in request.query_params:
                        session_id = request.query_params["session_id"]
                except Exception:
                    pass
            
            # If still no session ID, cannot continue
            if not session_id:
                raise HTTPException(
                    status_code=400,
                    detail="No session ID provided. Set a session_id cookie or X-Session-ID header."
                )
            
            # Validate session ID format
            try:
                session_uuid = uuid.UUID(session_id)
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid session ID format: {session_id}"
                )
            
            # Get session from database
            from sqlalchemy import select
            from models import Session
            
            stmt = select(Session).where(Session.id == session_uuid)
            result = await db_session.execute(stmt)
            session_obj = result.scalar_one_or_none()
            
            if not session_obj:
                raise HTTPException(
                    status_code=404,
                    detail="Session not found"
                )
            
            # Check expiration
            if session_obj.expires_at and session_obj.expires_at.replace(tzinfo=None) < datetime.utcnow():
                raise HTTPException(
                    status_code=401,
                    detail="Session has expired"
                )
            
            # Extend expiration
            session_timeout = config.SESSION_TIMEOUT_MINUTES
            new_expires_at = datetime.utcnow() + timedelta(minutes=session_timeout)
            
            # Update session in database
            from sqlalchemy import update
            
            await db_session.execute(
                update(Session)
                .where(Session.id == session_uuid)
                .values(
                    last_activity=datetime.utcnow(),
                    expires_at=new_expires_at
                )
            )
            await db_session.commit()
            
            # Refresh session object
            await db_session.refresh(session_obj)
            
            # Create response
            try:
                session_response = session_to_response(session_obj)
                response = JSONResponse(session_response)
                response.set_cookie(
                    key="session_id",
                    value=str(session_obj.id),
                    httponly=True,
                    secure=True,
                    samesite="none",
                )
                return response
            except Exception as resp_error:
                logger.exception(f"Error creating session response: {str(resp_error)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Error processing session data: {str(resp_error)}"
                )

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
            # Get session ID from various sources
            session_id = None
            session_id = request.cookies.get("session_id")
            if not session_id:
                session_id = request.headers.get("X-Session-ID")
            
            if not session_id:
                raise HTTPException(
                    status_code=401,
                    detail="No session ID provided. Set a session_id cookie or X-Session-ID header."
                )
            
            # Validate session ID format
            try:
                session_uuid = uuid.UUID(session_id)
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid session ID format: {session_id}"
                )
            
            # Get session from database
            from sqlalchemy import select
            from models import Session
            
            stmt = select(Session).where(Session.id == session_uuid)
            result = await db_session.execute(stmt)
            session_obj = result.scalar_one_or_none()
            
            if not session_obj:
                raise HTTPException(
                    status_code=404,
                    detail="Session not found"
                )
            
            # Check if expired
            if session_obj.expires_at and session_obj.expires_at.replace(tzinfo=None) < datetime.utcnow():
                raise HTTPException(
                    status_code=401,
                    detail="Session has expired"
                )
            
            # Get model from request body
            try:
                body = await request.json()
                model = body.get("model")
            except Exception as json_error:
                logger.error(f"Error parsing request body: {str(json_error)}")
                raise HTTPException(status_code=400, detail="Invalid request body")

            if not model:
                return {"status": "error", "message": "Model name is required"}

            # Update session model directly in the database
            from sqlalchemy import update
            
            try:
                # Update the model and last activity
                await db_session.execute(
                    update(Session)
                    .where(Session.id == session_uuid)
                    .values(
                        last_model=model,
                        last_activity=datetime.utcnow()
                    )
                )
                await db_session.commit()
                
                # Refresh session object to get updated data
                await db_session.refresh(session_obj)
                
                # Return formatted response
                return session_to_response(session_obj)
            except Exception as update_error:
                logger.exception(f"Error updating session model: {str(update_error)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to update session model: {str(update_error)}"
                )

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
