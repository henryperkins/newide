import time
import uuid
from typing import Optional, Union, Tuple
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
import sentry_sdk

from models import Session
import config
from logging_config import get_logger
from services.tracing_utils import trace_function, trace_block, add_breadcrumb

# Set up enhanced logger
logger = get_logger(__name__)

class SessionService:
    """
    Unified service for session management.
    
    This service centralizes all session-related operations including:
    - Creation and validation
    - Session expiration management
    - User ownership enforcement
    - Model association
    - Rate limiting
    """

    @staticmethod
    async def create_session(
        db_session: AsyncSession,
        user_id: Optional[str] = None
    ) -> Session:
        """
        Create a new session with optional user ownership.

        Args:
            db_session: Database session
            user_id: Optional ID of the user who will own this session

        Returns:
            Newly created Session object

        Raises:
            HTTPException: If rate limit is exceeded or other errors occur
        """
        # Create a transaction for session creation
        transaction = sentry_sdk.start_transaction(
            name="create_session",
            op="session.create"
        )
        start_time = time.time()

        try:
            # Log the beginning of the operation
            logger.info("Starting session creation")

            # Add breadcrumb for session creation start
            sentry_sdk.add_breadcrumb(
                category="session",
                message="Starting session creation",
                level="info"
            )

            # Check for rate limiting at IP level
            with transaction.start_child(op="session.rate_limit_check", description="Check Rate Limits") as rate_span:
                rate_start = time.time()

                # Get count of sessions created in the last minute
                one_minute_ago = datetime.utcnow() - timedelta(minutes=1)
                stmt = select(func.count()).select_from(Session).where(Session.created_at >= one_minute_ago)
                result = await db_session.execute(stmt)
                recent_sessions_count = result.scalar_one()

                rate_span.set_data("recent_sessions_count", recent_sessions_count)
                logger.info(f"Recent session count: {recent_sessions_count}")

                # Rate limit: max 20 sessions per minute globally
                if recent_sessions_count >= 20:
                    rate_span.set_data("rate_limited", True)
                    transaction.set_data("result", "error.rate_limited")
                    transaction.set_data("error_code", 429)

                    logger.warning("Rate limit exceeded for session creation")

                    sentry_sdk.add_breadcrumb(
                        category="session",
                        message="Rate limit exceeded for session creation",
                        level="warning",
                        data={"recent_sessions_count": recent_sessions_count}
                    )

                    # Finish spans and transaction before raising
                    rate_span.set_data("duration_seconds", time.time() - rate_start)
                    transaction.set_data("duration_seconds", time.time() - start_time)
                    transaction.finish()

                    raise HTTPException(
                        status_code=429,
                        detail={
                            "error": "rate_limit_exceeded",
                            "message": "Too many sessions created. Please try again later.",
                        },
                        headers={"Retry-After": "60"}
                    )

                rate_span.set_data("rate_limited", False)
                rate_span.set_data("duration_seconds", time.time() - rate_start)

            # Configure session parameters
            with sentry_sdk.start_span(op="session.configure", description="Configure Session") as config_span:
                # Get session timeout value
                session_timeout = getattr(config.settings, "SESSION_TIMEOUT_MINUTES", 30)  # Default to 30 if not found
                config_span.set_data("session_timeout_minutes", session_timeout)

                logger.info(f"Using SESSION_TIMEOUT_MINUTES: {session_timeout}")

                # Generate new session ID
                session_id = uuid.uuid4()
                config_span.set_data("session_id", str(session_id))

                # Calculate expiration time
                expires_at = datetime.now(timezone.utc) + timedelta(minutes=session_timeout)
                config_span.set_data("expires_at", expires_at.isoformat())

                logger.info(f"Created new session ID: {session_id}")
                logger.info(f"Setting expires_at to: {expires_at}")

            # Create and persist the session
            with sentry_sdk.start_span(op="session.persist", description="Persist Session") as persist_span:
                persist_start = time.time()

                # Create session object with optional owner
                new_session = Session(
                    id=session_id,
                    created_at=datetime.utcnow(),
                    last_activity=datetime.utcnow(),
                    expires_at=expires_at,
                    request_count=0
                )
                # First add the session to the database
                db_session.add(new_session)
                await db_session.commit()
                await db_session.refresh(new_session)

                # If user_id is provided, initialize session_metadata or update existing
                if user_id:
                    try:
                        # Create metadata dictionary
                        metadata = {}
                        metadata["owner_id"] = str(user_id)

                        # Use SQLAlchemy update to set metadata
                        await db_session.execute(
                            update(Session)
                            .where(Session.id == session_id)
                            .values(session_metadata=metadata)
                        )
                        await db_session.commit()
                        await db_session.refresh(new_session)

                        persist_span.set_data("owner_id", str(user_id))
                        logger.info(f"Associating session with user: {user_id}")
                    except Exception as e:
                        logger.warning(f"Error setting session metadata: {str(e)}")
                        # Continue anyway - this is optional metadata

                await db_session.refresh(new_session)

                persist_span.set_data("duration_seconds", time.time() - persist_start)
                logger.info(f"Session {session_id} committed to database successfully")

            # Set transaction data for success
            transaction.set_data("result", "success")
            transaction.set_data("session_id", str(session_id))
            transaction.set_data("expires_at", expires_at.isoformat())
            transaction.set_data("duration_seconds", time.time() - start_time)

            # Add success breadcrumb
            sentry_sdk.add_breadcrumb(
                category="session",
                message="Session created successfully",
                level="info",
                data={"session_id": str(session_id)}
            )

            # Set session ID in Sentry scope
            sentry_sdk.set_tag("session_id", str(session_id))

            return new_session

        except Exception as e:
            # Set error information in span
            if 'transaction' in locals():
                transaction.set_data("result", "error")
                transaction.set_data("error.type", e.__class__.__name__)
                transaction.set_data("error.message", str(e))

            # Log error
            logger.error(f"Error in create_session: {str(e)}")
            logger.exception("Full exception details:")

            # Capture exception in Sentry
            sentry_sdk.capture_exception(e)

            # Add failure breadcrumb
            sentry_sdk.add_breadcrumb(
                category="session",
                message="Session creation failed",
                level="error",
                data={"error": str(e)}
            )

            # Re-raise the exception to be handled by the caller
            raise

    @classmethod
    async def delete_session(cls, session_id: str, db_session: AsyncSession) -> None:
        """Delete a session and all its related data"""
        from models import Session
        from sqlalchemy import delete

        await db_session.execute(
            delete(Session)
            .where(Session.id == uuid.UUID(session_id))
        )
        await db_session.commit()

    @staticmethod
    async def validate_session(
        session_id: Union[str, uuid.UUID],
        db_session: AsyncSession,
        user_id: Optional[str] = None,
        require_valid: bool = False
    ) -> Optional[Session]:
        """
        Validate a session by ID, decomposing into smaller helper methods to reduce complexity.
        """
        with sentry_sdk.start_span(op="session.validate", description="Validate Session") as span:
            start_time = time.time()
            span.set_data("require_valid", require_valid)

            session_uuid = SessionService.parse_session_id(session_id, require_valid, span)
            if not session_uuid:
                return None

            session_obj = await SessionService.get_session_record(
                session_uuid, db_session, require_valid, span
            )
            if not session_obj:
                return None

            if not SessionService.check_expiry(session_obj, require_valid, span):
                return None

            if not await SessionService.check_rate_limit(session_obj, require_valid, span):
                return None

            if not SessionService.check_ownership(session_obj, user_id, require_valid, span):
                return None

            await SessionService.update_last_activity(session_uuid, db_session, span)

            # Mark session valid
            span.set_data("result", "valid")
            span.set_data("session_id", str(session_obj.id))
            span.set_data("request_count", session_obj.request_count)
            if session_obj.created_at is not None:
                span.set_data("created_at", session_obj.created_at.isoformat())
            span.set_data("duration_seconds", time.time() - start_time)

            # Add a breadcrumb for success
            add_breadcrumb(
                category="session",
                message="Session validated successfully",
                level="info",
                data={"session_id": str(session_obj.id)}
            )

            # Tag in Sentry
            sentry_sdk.set_tag("session_id", str(session_obj.id))
            if session_obj.session_metadata and 'owner_id' in session_obj.session_metadata:
                owner_id = session_obj.session_metadata.get('owner_id')
                sentry_sdk.set_user({"id": owner_id})
                span.set_data("owner_id", owner_id)

            return session_obj

    @staticmethod
    def parse_session_id(
        session_id: Union[str, uuid.UUID],
        require_valid: bool,
        span
    ) -> Optional[uuid.UUID]:
        """Parse and convert session_id to UUID, handle errors to reduce complexity in main method."""
        try:
            if isinstance(session_id, uuid.UUID):
                parsed_id = session_id
            else:
                parsed_id = uuid.UUID(session_id, version=4)
            span.set_data("session_id", str(parsed_id))
            return parsed_id
        except (ValueError, TypeError) as err:
            span.set_data("error.message", str(err))
            if require_valid:
                span.set_data("result", "error.invalid_format")
                span.set_data("error_code", 422)
                add_breadcrumb(
                    category="session",
                    message="Invalid session ID format",
                    level="warning",
                    data={"session_id": str(session_id)}
                )
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "invalid_session_id",
                        "message": "Invalid session ID format: must be a valid UUID",
                        "session_id": str(session_id)
                    }
                )
            span.set_data("result", "invalid_format")
            return None

    @staticmethod
    async def get_session_record(
        session_uuid: uuid.UUID,
        db_session: AsyncSession,
        require_valid: bool,
        span
    ) -> Optional[Session]:
        """Retrieve the session record from the database, handle not found logic."""
        with sentry_sdk.start_span(op="session.db_lookup", description="Session DB Lookup") as db_span:
            db_start = time.time()
            stmt = select(Session).where(Session.id == session_uuid)
            result = await db_session.execute(stmt)
            session_obj = result.scalar_one_or_none()

            db_span.set_data("session_found", session_obj is not None)
            db_span.set_data("duration_seconds", time.time() - db_start)

            if not session_obj:
                if require_valid:
                    span.set_data("result", "error.not_found")
                    span.set_data("error_code", 404)
                    add_breadcrumb(
                        category="session",
                        message="Session not found",
                        level="warning",
                        data={"session_id": str(session_uuid)}
                    )
                    raise HTTPException(
                        status_code=404,
                        detail="Session not found"
                    )
                span.set_data("result", "not_found")
                return None

            return session_obj

    @staticmethod
    def check_expiry(
        session_obj: Session,
        require_valid: bool,
        span
    ) -> bool:
        """Check if the session is expired and handle the logic."""
        with sentry_sdk.start_span(op="session.check_expiry", description="Check Session Expiry") as expiry_span:
            is_expired = False
            if session_obj.expires_at is not None:
                expires_at_naive = session_obj.expires_at.replace(tzinfo=None)
                now = datetime.utcnow()
                is_expired = expires_at_naive < now
                expiry_span.set_data("has_expiry", True)
                expiry_span.set_data("is_expired", is_expired)
                if is_expired:
                    expiry_span.set_data("expired_seconds_ago", (now - expires_at_naive).total_seconds())
            else:
                expiry_span.set_data("has_expiry", False)

            if is_expired:
                if require_valid:
                    span.set_data("result", "error.expired")
                    span.set_data("error_code", 401)
                    add_breadcrumb(
                        category="session",
                        message="Session expired",
                        level="warning",
                        data={"session_id": str(session_obj.id)}
                    )
                    raise HTTPException(
                        status_code=401,
                        detail="Session expired"
                    )
                span.set_data("result", "expired")
                return False
        return True

    @staticmethod
    async def check_rate_limit(
        session_obj: Session,
        require_valid: bool,
        span
    ) -> bool:
        """Check rate limits on the session, handle any exceptions."""
        with sentry_sdk.start_span(op="session.check_rate_limit", description="Check Rate Limits") as rate_span:
            try:
                session_obj.check_rate_limit()
                rate_span.set_data("rate_limited", False)
            except HTTPException as rate_error:
                rate_span.set_data("rate_limited", True)
                rate_span.set_data("error_code", rate_error.status_code)
                add_breadcrumb(
                    category="session",
                    message="Session rate limited",
                    level="warning",
                    data={"session_id": str(session_obj.id)}
                )
                span.set_data("result", "error.rate_limited")
                span.set_data("error_code", rate_error.status_code)
                if require_valid:
                    raise rate_error
                return False
        return True

    @staticmethod
    def check_ownership(
        session_obj: Session,
        user_id: Optional[str],
        require_valid: bool,
        span
    ) -> bool:
        """Check if the session belongs to the given user if user_id is provided."""
        if user_id and session_obj.session_metadata and 'owner_id' in session_obj.session_metadata:
            owner_id = session_obj.session_metadata.get('owner_id')
            if owner_id != str(user_id):
                if require_valid:
                    span.set_data("result", "error.unauthorized")
                    span.set_data("error_code", 403)
                    add_breadcrumb(
                        category="session",
                        message="Session ownership validation failed",
                        level="warning",
                        data={"session_id": str(session_obj.id), "expected_user": str(user_id), "actual_user": owner_id}
                    )
                    raise HTTPException(
                        status_code=403,
                        detail="You don't have permission to access this session"
                    )
                span.set_data("result", "unauthorized")
                return False
        return True

    @staticmethod
    async def update_last_activity(
        session_uuid: uuid.UUID,
        db_session: AsyncSession,
        span
    ) -> None:
        """Update the session's last_activity, separated from main logic."""
        with sentry_sdk.start_span(op="session.update_activity", description="Update Last Activity") as update_span:
            update_start = time.time()
            await db_session.execute(
                update(Session)
                .where(Session.id == session_uuid)
                .values(last_activity=datetime.utcnow())
            )
            await db_session.commit()
            update_span.set_data("duration_seconds", time.time() - update_start)

    @staticmethod
    @trace_function(op="session.extend", name="extend_session")
    async def extend_session(
        session_id: Union[str, uuid.UUID],
        db_session: AsyncSession
    ) -> bool:
        """
        Extend the expiration time of a session
        
        Args:
            session_id: The session ID to extend
            db_session: Database session
            
        Returns:
            True if session was extended successfully, False otherwise
        """
        # Create a span for session extension
        with sentry_sdk.start_span(op="session.extend", description="Extend Session") as span:
            start_time = time.time()

            try:
                # Convert string to UUID if needed
                if isinstance(session_id, str):
                    try:
                        session_id = uuid.UUID(session_id)
                        span.set_data("session_id", str(session_id))
                    except ValueError as e:
                        # If the session_id is not a valid UUID
                        span.set_data("result", "error.invalid_uuid")
                        span.set_data("error.message", str(e))

                        logger.warning(
                            f"Invalid session ID format in extend_session: {session_id}",
                            extra={"session_id": session_id, "error": str(e)}
                        )

                        add_breadcrumb(
                            category="session",
                            message="Invalid session ID format",
                            level="warning",
                            data={"session_id": session_id}
                        )

                        return False
                else:
                    # Already a UUID
                    span.set_data("session_id", str(session_id))

                # Check if session exists
                with trace_block("Check Session Exists", op="db.query") as check_span:
                    stmt = select(Session).where(Session.id == session_id)
                    result = await db_session.execute(stmt)
                    session = result.scalar_one_or_none()

                    check_span.set_data("session_exists", session is not None)

                    if not session:
                        span.set_data("result", "error.not_found")

                        logger.warning(
                            f"Session not found in extend_session: {session_id}",
                            extra={"session_id": str(session_id)}
                        )

                        add_breadcrumb(
                            category="session",
                            message="Session not found for extension",
                            level="warning",
                            data={"session_id": str(session_id)}
                        )

                        return False

                # Calculate new expiration time
                with trace_block("Update Expiration", op="session.update_expiry") as update_span:
                    # Get session timeout setting
                    session_timeout = getattr(config.settings, "SESSION_TIMEOUT_MINUTES", 30)  # Default to 30 if not found
                    update_span.set_data("session_timeout_minutes", session_timeout)

                    # Calculate new expiration time
                    expires_at = datetime.utcnow() + timedelta(minutes=session_timeout)
                    update_span.set_data("new_expires_at", expires_at.isoformat())

                    # Update the session
                    update_start = time.time()
                    await db_session.execute(
                        update(Session)
                        .where(Session.id == session_id)
                        .values(
                            last_activity=datetime.utcnow(),
                            expires_at=expires_at
                        )
                    )
                    await db_session.commit()

                    update_span.set_data("duration_seconds", time.time() - update_start)

                # Record success
                span.set_data("result", "success")
                span.set_data("duration_seconds", time.time() - start_time)

                logger.info(
                    f"Session extended successfully: {session_id}",
                    extra={
                        "session_id": str(session_id),
                        "new_expires_at": expires_at.isoformat()
                    }
                )

                add_breadcrumb(
                    category="session",
                    message="Session extended successfully",
                    level="info",
                    data={"session_id": str(session_id)}
                )

                return True

            except Exception as e:
                # Record error
                span.set_data("result", "error")
                span.set_data("error.type", e.__class__.__name__)
                span.set_data("error.message", str(e))

                # Log error
                logger.error(
                    f"Error extending session {session_id}: {str(e)}",
                    extra={"session_id": str(session_id), "error": str(e)}
                )

                # Add failure breadcrumb
                add_breadcrumb(
                    category="session",
                    message="Session extension failed",
                    level="error",
                    data={"session_id": str(session_id), "error": str(e)}
                )

                # Capture in Sentry
                sentry_sdk.capture_exception(e)

                return False

    @staticmethod
    @trace_function(op="session.switch_model", name="switch_model")
    async def switch_model(
        session_id: Union[str, uuid.UUID],
        new_model: str,
        db_session: AsyncSession,
        user_id: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Switch the model associated with a session
        
        Args:
            session_id: The session ID to update
            new_model: The new model name to associate with the session
            db_session: Database session
            user_id: Optional user ID to verify ownership
            
        Returns:
            Tuple of (success, error_message)
        """
        with sentry_sdk.start_span(op="session.switch_model", description="Switch Model") as span:
            start_time = time.time()
            span.set_data("new_model", new_model)

            try:
                # First validate the session
                session = await SessionService.validate_session(
                    session_id=session_id,
                    db_session=db_session,
                    user_id=user_id,
                    require_valid=True
                )

                if not session:
                    # If validation doesn't raise an exception (require_valid=False),
                    # we need to handle the error case manually
                    span.set_data("result", "error.session_invalid")
                    return False, "Invalid session"

                # Get the current model for logging
                current_model = session.last_model
                span.set_data("current_model", current_model)

                # Update the session model
                await db_session.execute(
                    update(Session)
                    .where(Session.id == session.id)
                    .values(last_model=new_model)
                )
                await db_session.commit()

                # Log the model switch
                logger.info(
                    f"Switched model for session {session_id}: {current_model} -> {new_model}",
                    extra={
                        "session_id": str(session_id),
                        "from_model": current_model,
                        "to_model": new_model
                    }
                )

                span.set_data("result", "success")
                span.set_data("duration_seconds", time.time() - start_time)

                add_breadcrumb(
                    category="session",
                    message="Switched model successfully",
                    level="info",
                    data={
                        "session_id": str(session_id),
                        "from_model": current_model,
                        "to_model": new_model
                    }
                )

                return True, None

            except HTTPException as http_err:
                # If validate_session raised an HTTPException, pass it along
                span.set_data("result", f"error.http.{http_err.status_code}")
                span.set_data("error_code", http_err.status_code)
                span.set_data("error_message", str(http_err.detail))
                span.set_data("duration_seconds", time.time() - start_time)

                logger.warning(
                    f"HTTP error in switch_model: {http_err.status_code} - {http_err.detail}",
                    extra={"session_id": str(session_id), "new_model": new_model}
                )

                return False, str(http_err.detail)

            except Exception as e:
                # For other exceptions, log and return error
                span.set_data("result", "error")
                span.set_data("error.type", e.__class__.__name__)
                span.set_data("error.message", str(e))
                span.set_data("duration_seconds", time.time() - start_time)

                logger.error(
                    f"Error in switch_model for {session_id}: {str(e)}",
                    extra={"session_id": str(session_id), "new_model": new_model, "error": str(e)}
                )

                add_breadcrumb(
                    category="session",
                    message="Model switch failed",
                    level="error",
                    data={"session_id": str(session_id), "new_model": new_model, "error": str(e)}
                )

                sentry_sdk.capture_exception(e)

                return False, str(e)

    @staticmethod
    @trace_function(op="session.get_model", name="get_current_model")
    async def get_current_model(
        session_id: Union[str, uuid.UUID],
        db_session: AsyncSession,
        default_model: Optional[str] = None
    ) -> Optional[str]:
        """
        Get the current model associated with a session
        
        Args:
            session_id: The session ID to query
            db_session: Database session
            default_model: Optional default model to return if session has no model
            
        Returns:
            Current model name or default_model if not set
        """
        with sentry_sdk.start_span(op="session.get_model", description="Get Current Model") as span:
            span.set_data("session_id", str(session_id))
            span.set_data("default_model", default_model)

            try:
                # Convert string to UUID if needed
                session_uuid = session_id if isinstance(session_id, uuid.UUID) else uuid.UUID(session_id)

                # Query for just the last_model field
                stmt = select(Session.last_model).where(Session.id == session_uuid)
                result = await db_session.execute(stmt)
                model = result.scalar_one_or_none()

                span.set_data("model_found", model is not None)

                if model:
                    span.set_data("current_model", model)
                    return model

                span.set_data("using_default", True)
                return default_model

            except Exception as e:
                span.set_data("result", "error")
                span.set_data("error.type", e.__class__.__name__)
                span.set_data("error.message", str(e))

                logger.error(
                    f"Error getting current model for session {session_id}: {str(e)}",
                    extra={"session_id": str(session_id), "error": str(e)}
                )

                add_breadcrumb(
                    category="session",
                    message="Failed to get current model",
                    level="error",
                    data={"session_id": str(session_id), "error": str(e)}
                )

                return default_model

    @staticmethod
    async def get_session_from_request(request, db_session: AsyncSession, require_valid: bool = False):
        """
        Extract and validate session from request.
        
        Args:
            request: The FastAPI request object
            db_session: Database session
            require_valid: If True, raise HTTPException for invalid session
            
        Returns:
            Session object if valid, None otherwise
            
        Raises:
            HTTPException: If require_valid is True and session is invalid
        """
        with sentry_sdk.start_span(op="session.extract", description="Extract Session ID") as extract_span:
            # Try to get session ID from multiple sources
            session_id = None
            session_source = None

            # 1. Check cookie
            session_id = request.cookies.get("session_id")
            if session_id:
                session_source = "cookie"
                extract_span.set_data("source", "cookie")

            # 2. Check query parameters
            if not session_id:
                try:
                    query_params = request.query_params
                    if "session_id" in query_params:
                        session_id = query_params["session_id"]
                        session_source = "query_param"
                        extract_span.set_data("source", "query_param")
                except Exception as e:
                    extract_span.set_data("query_param_error", str(e))

            # 3. Check headers
            if not session_id:
                session_id = request.headers.get("X-Session-ID")
                if session_id:
                    session_source = "header"
                    extract_span.set_data("source", "header")

            # 4. Check JSON body for POST requests
            if not session_id and request.method == "POST":
                try:
                    body = await request.json()
                    if isinstance(body, dict) and "session_id" in body:
                        session_id = body["session_id"]
                        session_source = "body"
                        extract_span.set_data("source", "body")
                except Exception as e:
                    # Failed to parse body as JSON, that's fine
                    extract_span.set_data("body_parse_error", str(e))

            # Record extraction result
            extract_span.set_data("session_id_found", session_id is not None)
            extract_span.set_data("session_source", session_source)

            # If no session ID found, return None or raise exception
            if not session_id:
                if require_valid:
                    add_breadcrumb(
                        category="session",
                        message="No valid session ID found",
                        level="warning"
                    )

                    raise HTTPException(
                        status_code=401,
                        detail="No valid session ID found"
                    )

                return None

        # Validate the session and return the result
        result = await SessionService.validate_session(
            session_id=session_id,
            db_session=db_session,
            require_valid=require_valid
        )

        return result
