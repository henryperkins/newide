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
import json
import config
import uuid
import asyncio
import sentry_sdk
from services.tracing_utils import trace_function, profile_block
from services.session_service import SessionService
from sqlalchemy import select, update
from models import Session  # Ensure Session is imported at the top level

"""
Refactors to reduce flake8 complexity warnings, including 'update_session_model' 
by splitting it into smaller helper functions.
"""


def serialize_datetime_objects(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


router = APIRouter()


def extract_session_id_from_request(request: Request, explicit_session_id: Optional[str] = None) -> Optional[str]:
    """
    Extracts the session_id from one of:
      1. The explicit session_id parameter (if provided)
      2. A cookie
      3. Query parameters
      4. The X-Session-ID header
    Returns None if no valid session ID is found.
    """
    if explicit_session_id:
        return explicit_session_id

    # 1. Check cookie
    cookie_session_id = request.cookies.get("session_id")
    if cookie_session_id:
        logger.debug(f"Got session_id from cookie: {cookie_session_id}")
        return cookie_session_id

    # 2. Check query parameters
    if "session_id" in request.query_params:
        query_session_id = request.query_params["session_id"]
        logger.debug(f"Got session_id from query params: {query_session_id}")
        return query_session_id

    # 3. Check headers
    header_session_id = request.headers.get("X-Session-ID")
    if header_session_id:
        logger.debug(f"Got session_id from header: {header_session_id}")
        return header_session_id

    return None


def fetch_and_validate_session_id(raw_session_id: str) -> uuid.UUID:
    """
    Validate the session ID format and convert to UUID; raise HTTPException if invalid.
    """
    try:
        return uuid.UUID(raw_session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid session ID format: {raw_session_id}"
        )


def is_session_expired(session_obj: Session) -> bool:
    """
    Check if the given session has expired.
    """
    expires_val = session_obj.expires_at
    if expires_val is not None:
        expires_at_naive = expires_val.replace(tzinfo=None)
        now = datetime.utcnow()
        return expires_at_naive < now
    return False


async def parse_model_from_request(request: Request) -> str:
    """
    Parse the 'model' field from the JSON request body.
    """
    try:
        body = await request.json()
        model = body.get("model")
        if not model:
            raise HTTPException(
                status_code=400,
                detail="No 'model' field provided in request body."
            )
        return model
    except Exception as json_error:
        logger.error(f"Error parsing request body: {str(json_error)}")
        raise HTTPException(status_code=400, detail="Invalid request body")


async def retrieve_and_validate_session(db_session: AsyncSession, session_uuid: uuid.UUID) -> Session:
    """
    Fetch the session from the database, ensure it exists and is not expired.
    """
    stmt = select(Session).where(Session.id == session_uuid)
    result = await db_session.execute(stmt)
    session_obj = result.scalar_one_or_none()

    if not session_obj:
        raise HTTPException(
            status_code=404,
            detail="Session not found."
        )

    if is_session_expired(session_obj):
        raise HTTPException(
            status_code=401,
            detail="Session has expired"
        )
    return session_obj


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


def initialize_session_services_sync(session_id: str, azure_client: Any):
    """Synchronous wrapper for the async initialize_session_services function"""
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(initialize_session_services(session_id, azure_client))
    except Exception as e:
        logger.error(f"Error initializing session services: {str(e)}")
        sentry_sdk.capture_exception(e)
    finally:
        loop.close()


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
            extracted_session_id = extract_session_id_from_request(request, session_id)
            if not extracted_session_id:
                return {
                    "id": None,
                    "message": "No active session. Call '/api/session/create' to generate a new session.",
                }

            session_uuid = fetch_and_validate_session_id(extracted_session_id)

            session_obj = await retrieve_and_validate_session(db_session, session_uuid)

            # Update last_activity
            await db_session.execute(
                update(Session)
                .where(Session.id == session_uuid)
                .values(last_activity=datetime.utcnow())
            )
            await db_session.commit()

            return {
                "id": str(session_obj.id),
                "created_at": session_obj.created_at.isoformat() if isinstance(session_obj.created_at, datetime) else None,
                "last_activity": session_obj.last_activity.isoformat() if isinstance(session_obj.last_activity, datetime) else None,
                "expires_at": session_obj.expires_at.isoformat() if isinstance(session_obj.expires_at, datetime) else None,
                "last_model": session_obj.last_model,
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
            azure_client = client_wrapper.get("client") if client_wrapper else None
            span.set_data("has_azure_client", azure_client is not None)

            try:
                new_session = await SessionService.create_session(db_session=db_session)
                session_id = new_session.id

                span.set_data("session_id", str(session_id))
                logger.info(f"Successfully created session: {session_id}")

                if azure_client:
                    with profile_block(description="Initialize Services", op="session.init_services") as init_span:
                        init_span.set_data("azure_deployment", getattr(azure_client, "azure_deployment", "unknown"))
                        background_tasks.add_task(
                            initialize_session_services_sync, str(session_id), azure_client
                        )

                session_timeout = config.SESSION_TIMEOUT_MINUTES

                response = JSONResponse(
                    {
                        "session_id": str(session_id),
                        "created_at": new_session.created_at.isoformat(),
                        "expires_in": session_timeout * 60,
                        "expires_at": new_session.expires_at.isoformat(),
                    },
                    status_code=201,
                )

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
            extracted_session_id = extract_session_id_from_request(request)
            if not extracted_session_id:
                raise HTTPException(
                    status_code=400,
                    detail="No session ID provided. Set a session_id cookie or X-Session-ID header."
                )

            session_uuid = fetch_and_validate_session_id(extracted_session_id)

            session_obj = await retrieve_and_validate_session(db_session, session_uuid)

            session_timeout = config.SESSION_TIMEOUT_MINUTES
            new_expires_at = datetime.utcnow() + timedelta(minutes=session_timeout)

            await db_session.execute(
                update(Session)
                .where(Session.id == session_uuid)
                .values(
                    last_activity=datetime.utcnow(),
                    expires_at=new_expires_at
                )
            )
            await db_session.commit()

            await db_session.refresh(session_obj)

            try:
                session_response = session_to_response(session_obj)
                session_dict = (
                    session_response.dict()
                    if hasattr(session_response, "dict")
                    else session_response.model_dump()
                )

                # Add explicit session_id field for client validation
                session_dict["session_id"] = str(session_obj.id)

                # Use json.dumps with custom serializer to handle datetime objects
                json_data = json.dumps(session_dict, default=serialize_datetime_objects)
                
                # Create response from pre-serialized JSON data
                response = JSONResponse(content=json.loads(json_data))
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

    except HTTPException:
        raise
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
    with profile_block(description="Update Session Model", op="session.update_model"):
        try:
            # Extract or validate session ID
            extracted_session_id = extract_session_id_from_request(request)
            if not extracted_session_id:
                raise HTTPException(
                    status_code=401,
                    detail="No session ID provided. Set a session_id cookie or X-Session-ID header."
                )

            session_uuid = fetch_and_validate_session_id(extracted_session_id)

            # Retrieve session and ensure it's valid
            session_obj = await retrieve_and_validate_session(db_session, session_uuid)

            # Parse model from request
            model = await parse_model_from_request(request)

            # Update the session model
            await db_session.execute(
                update(Session)
                .where(Session.id == session_uuid)
                .values(
                    last_model=model,
                    last_activity=datetime.utcnow()
                )
            )
            await db_session.commit()

            await db_session.refresh(session_obj)

            return session_to_response(session_obj)

        except HTTPException:
            raise
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
