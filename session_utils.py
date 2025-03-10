# session_utils.py - Session management utilities

import uuid
import time
from typing import Optional, Dict, Any, Union
from datetime import datetime, timedelta, timezone
from fastapi import Request, Cookie, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, text, func
import sentry_sdk

from database import get_db_session
from models import Session
import config
from logging_config import get_logger
from services.tracing_utils import trace_function, trace_block, add_breadcrumb

# Set up enhanced logger
logger = get_logger(__name__)

class SessionManager:
    """Centralized session management logic"""
    
    @staticmethod
    async def get_session_from_request(
        request: Request,
        db_session: AsyncSession,
        require_valid: bool = False
    ) -> Optional[Session]:
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
        # Create a span for session validation
        with sentry_sdk.start_span(op="session.validate", description="Validate Session") as span:
            span_start = time.time()
            
            # Capture request info
            client_ip = request.client.host if request.client else "unknown"
            user_agent = request.headers.get("user-agent", "unknown")
            method = request.method
            path = request.url.path
            
            span.set_data("client.ip", client_ip)
            span.set_data("client.user_agent", user_agent)
            span.set_data("request.method", method)
            span.set_data("request.path", path)
            span.set_data("require_valid", require_valid)
            
            # Try to get session ID from multiple sources
            session_id = None
            session_source = None
            
            # 1. Check cookie
            with sentry_sdk.start_span(op="session.extract", description="Extract Session ID") as extract_span:
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
            
            # Set session info in main span
            span.set_data("session_id_found", session_id is not None)
            
            # If no session ID found, return None or raise exception
            if not session_id:
                if require_valid:
                    span.set_data("result", "error.no_session_id")
                    span.set_data("error_code", 401)
                    
                    logger.warning(
                        "No valid session ID found",
                        extra={"ip": client_ip, "path": path, "method": method}
                    )
                    
                    sentry_sdk.add_breadcrumb(
                        category="session",
                        message="No valid session ID found",
                        level="warning"
                    )
                    
                    raise HTTPException(
                        status_code=401, 
                        detail="No valid session ID found"
                    )
                
                span.set_data("result", "no_session_id")
                span.set_data("duration_seconds", time.time() - span_start)
                return None
                
            # Validate UUID format
            with sentry_sdk.start_span(op="session.validate_format", description="Validate Session Format") as format_span:
                try:
                    session_uuid = uuid.UUID(session_id, version=4)
                    format_span.set_data("valid_format", True)
                except (ValueError, TypeError) as e:
                    format_span.set_data("valid_format", False)
                    format_span.set_data("error", str(e))
                    
                    logger.warning(
                        f"Invalid session ID format: {session_id}",
                        extra={"session_id": session_id, "ip": client_ip, "error": str(e)}
                    )
                    
                    if require_valid:
                        span.set_data("result", "error.invalid_format")
                        span.set_data("error_code", 422)
                        
                        sentry_sdk.add_breadcrumb(
                            category="session",
                            message="Invalid session ID format",
                            level="warning",
                            data={"session_id": session_id}
                        )
                        
                        raise HTTPException(
                            status_code=422, 
                            detail={
                                "error": "invalid_session_id",
                                "message": "Invalid session ID format: must be a valid UUID",
                                "session_id": session_id
                            }
                        )
                        
                    span.set_data("result", "invalid_format")
                    span.set_data("duration_seconds", time.time() - span_start)
                    return None
            
            # Query database for session
            with sentry_sdk.start_span(op="session.db_lookup", description="Session DB Lookup") as db_span:
                db_start = time.time()
                
                stmt = select(Session).where(Session.id == session_uuid)
                result = await db_session.execute(stmt)
                session = result.scalar_one_or_none()
                
                db_span.set_data("session_found", session is not None)
                db_span.set_data("duration_seconds", time.time() - db_start)
                
                # Check if session exists
                if not session:
                    if require_valid:
                        span.set_data("result", "error.not_found")
                        span.set_data("error_code", 404)
                        
                        logger.warning(
                            f"Session not found: {session_id}",
                            extra={"session_id": session_id, "ip": client_ip}
                        )
                        
                        sentry_sdk.add_breadcrumb(
                            category="session",
                            message="Session not found",
                            level="warning",
                            data={"session_id": session_id}
                        )
                        
                        raise HTTPException(
                            status_code=404, 
                            detail="Session not found"
                        )
                        
                    span.set_data("result", "not_found")
                    span.set_data("duration_seconds", time.time() - span_start)
                    return None
            
            # Check if session is expired
            with sentry_sdk.start_span(op="session.check_expiry", description="Check Session Expiry") as expiry_span:
                is_expired = False
                
                if session.expires_at is not None:
                    expires_at_naive = session.expires_at.replace(tzinfo=None)
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
                        
                        logger.warning(
                            f"Session expired: {session_id}",
                            extra={"session_id": session_id, "ip": client_ip}
                        )
                        
                        sentry_sdk.add_breadcrumb(
                            category="session",
                            message="Session expired",
                            level="warning",
                            data={"session_id": session_id}
                        )
                        
                        raise HTTPException(
                            status_code=401,
                            detail="Session expired"
                        )
                        
                    span.set_data("result", "expired")
                    span.set_data("duration_seconds", time.time() - span_start)
                    return None
            
            # Check rate limits
            with sentry_sdk.start_span(op="session.check_rate_limit", description="Check Rate Limits") as rate_span:
                try:
                    session.check_rate_limit()
                    rate_span.set_data("rate_limited", False)
                except HTTPException as rate_error:
                    rate_span.set_data("rate_limited", True)
                    rate_span.set_data("error_code", rate_error.status_code)
                    
                    logger.warning(
                        f"Session rate limited: {session_id}",
                        extra={"session_id": session_id, "ip": client_ip}
                    )
                    
                    sentry_sdk.add_breadcrumb(
                        category="session",
                        message="Session rate limited",
                        level="warning",
                        data={"session_id": session_id}
                    )
                    
                    span.set_data("result", "error.rate_limited")
                    span.set_data("error_code", rate_error.status_code)
                    span.set_data("duration_seconds", time.time() - span_start)
                    
                    # Re-raise rate limit exception
                    raise rate_error
            
            # Update last activity
            with sentry_sdk.start_span(op="session.update_activity", description="Update Last Activity") as update_span:
                update_start = time.time()
                
                await db_session.execute(
                    update(Session)
                    .where(Session.id == session_uuid)
                    .values(last_activity=datetime.utcnow())
                )
                await db_session.commit()
                
                update_span.set_data("duration_seconds", time.time() - update_start)
            
            # Session is valid
            span.set_data("result", "valid")
            span.set_data("session_id", str(session.id))
            span.set_data("request_count", session.request_count)
            span.set_data("created_at", session.created_at.isoformat() if session.created_at is not None else None)
            span.set_data("duration_seconds", time.time() - span_start)
            
            # Add a breadcrumb for successful validation
            sentry_sdk.add_breadcrumb(
                category="session",
                message="Session validated successfully",
                level="info",
                data={"session_id": str(session.id)}
            )
            
            # Set session ID in Sentry scope
            sentry_sdk.set_tag("session_id", str(session.id))
            
            # Associate user ID with session if available
            if hasattr(session, 'user_id') and session.user_id:
                sentry_sdk.set_user({"id": str(session.user_id)})
                span.set_data("user_id", str(session.user_id))
            
            return session
    
    @staticmethod
    async def get_session(
        session_id: Union[str, uuid.UUID],
        db_session: AsyncSession
    ) -> Optional[Session]:
        """Get a session by ID"""
        try:
            # Convert string to UUID if needed
            if isinstance(session_id, str):
                session_id = uuid.UUID(session_id)
                
            stmt = select(Session).where(Session.id == session_id)
            result = await db_session.execute(stmt)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error retrieving session {session_id}: {str(e)}")
            return None
            
    @staticmethod
    async def create_session(db_session: AsyncSession) -> Session:
        """Create a new session"""
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
            with sentry_sdk.start_span(op="session.rate_limit_check", description="Check Rate Limits") as rate_span:
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
                
                # Create session object
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
            # Set error information in transaction
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
            
            raise
            
        finally:
            # Make sure the transaction is finished
            transaction.finish()
    
    @staticmethod
    @trace_function(op="session.extend", name="extend_session")
    async def extend_session(
        session_id: Union[str, uuid.UUID], 
        db_session: AsyncSession
    ) -> bool:
        """Extend the expiration time of a session"""
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
    async def update_session_model(
        session_id: Union[str, uuid.UUID],
        model_name: str,
        db_session: AsyncSession
    ) -> bool:
        """Update the model associated with a session"""
        try:
            # Convert string to UUID if needed
            if isinstance(session_id, str):
                session_id = uuid.UUID(session_id)
                
            await db_session.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(last_model=model_name)
            )
            await db_session.commit()
            return True
        except Exception as e:
            logger.error(f"Error updating session model for {session_id}: {str(e)}")
            return False
