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

logger = get_logger(__name__)

class SessionService:
	
    @staticmethod
    async def create_session(db_session: AsyncSession, user_id: Optional[str] = None) -> Session:
        transaction = sentry_sdk.start_transaction(name="create_session", op="session.create")
        start_time = time.time()

        try:
            logger.info("Starting session creation")
            sentry_sdk.add_breadcrumb(category="session", message="Starting session creation", level="info")

            # Rate limiting check
            with transaction.start_child(op="session.rate_limit_check") as rate_span:
                one_minute_ago = datetime.now(timezone.utc) - timedelta(minutes=1)
                session_count_stmt = select(func.count(Session.id)).where(Session.created_at >= one_minute_ago)
                session_count_result = await db_session.execute(session_count_stmt)
                recent_session_count = session_count_result.scalar_one()

                if recent_session_count >= 20:
                    rate_error_msg = "Too many sessions created. Please try again later."
                    transaction.set_data("result", "error.rate_limited")
                    transaction.set_data("error_code", 429)
                    transaction.finish()
                    logger.warning(rate_error_msg)
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "error": "rate_limit_exceeded",
                            "message": rate_error_msg,
                        },
                        headers={"Retry-After": "60"},
                    )

            with transaction.start_child(op="session.create_session") as create_span:
                session_id = uuid.uuid4()
                adaptive_timeout = SessionService.calculate_timeout(None)
                expires_at = datetime.now(timezone.utc) + timedelta(minutes=adaptive_timeout)

                new_session = Session(
                    id=session_id,
                    created_at=datetime.now(timezone.utc),
                    last_activity=datetime.utcnow(),
                    expires_at=expires_at,
                    request_count=0,
                    user_id=user_id
                )

                db_session.add(new_session)

            with transaction.start_child(op="session.persist") as persist_span:
                if user_id:
                    new_session.session_metadata = {"owner": user_id}
                    persist_span.set_data("owner_id", str(user_id))

                await db_session.commit()
                await db_session.refresh(new_session)

            transaction.set_status("ok")
            transaction.set_data("session_id", str(session_id))
            transaction.set_data("expires_at", expires_at.isoformat())
            sentry_sdk.add_breadcrumb(
                category="session",
                message="Session created successfully",
                level="info",
                data={"session_id": str(session_id)}
            )

            return new_session

        except HTTPException as http_exc:
            await db_session.rollback()
            transaction.set_status(f"error.http_{http_exc.status_code}")
            sentry_sdk.capture_exception(http_exc)
            raise http_exc

        except Exception as e:
            await db_session.rollback()
            transaction.set_status("internal_error")
            sentry_sdk.capture_exception(e)
            logger.error(f"Unexpected error during session creation: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal server error during session creation.")

        finally:
            duration = time.time() - start_time
            transaction.set_data("duration_seconds", duration)
            transaction.finish()

			
    @classmethod
    async def delete_session(cls, session_id: str, db_session: AsyncSession) -> None:
        """
        Delete a session and all related data in the database.
        """
        from sqlalchemy import delete
        await db_session.execute(
            delete(Session).where(Session.id == uuid.UUID(session_id))
        )
        await db_session.commit()

    @staticmethod
    @trace_function(op="session.validate", name="validate_session")
    async def validate_session(
        session_id: Union[str, uuid.UUID],
        db_session: AsyncSession,
        user_id: Optional[str] = None,
        require_valid: bool = False
    ) -> Optional[Session]:
        """
        Validate a session by ID, decomposing into smaller helper methods for clarity.
        An invalid or missing session may raise HTTPException if require_valid=True.
        Otherwise, returns None if invalid.
        """
        # parse_session_id
        session_uuid = SessionService.parse_session_id(session_id, require_valid)
        if not session_uuid:
            return None

        # get_session_record
        session_obj = await SessionService.get_session_record(
            session_uuid, db_session, require_valid
        )
        if not session_obj:
            return None

        # check_expiry
        if not SessionService.check_expiry(session_obj, require_valid):
            return None

        # check_rate_limit
        if not await SessionService.check_rate_limit(session_obj, require_valid):
            return None

        # check_ownership
        if not SessionService.check_ownership(session_obj, user_id, require_valid):
            return None

        # update_last_activity
        await SessionService.update_last_activity(session_uuid, db_session)

        add_breadcrumb(
            category="session",
            message="Session validated successfully",
            level="info",
            session_id=str(session_obj.id)
        )
        # Tag in Sentry
        sentry_sdk.set_tag("session_id", str(session_obj.id))
        
        metadata_val = session_obj.session_metadata
        if isinstance(metadata_val, dict) and 'owner_id' in metadata_val:
            owner_id = metadata_val['owner_id']
            sentry_sdk.set_user({"id": owner_id})

        return session_obj

    @staticmethod
    def parse_session_id(session_id: Union[str, uuid.UUID], require_valid: bool) -> Optional[uuid.UUID]:
        """
        Convert input session_id to a UUID if possible. 
        Raises HTTPException if invalid and require_valid=True.
        """
        try:
            if isinstance(session_id, uuid.UUID):
                return session_id
            return uuid.UUID(session_id, version=4)
        except (ValueError, TypeError) as err:
            if require_valid:
                add_breadcrumb(
                    category="session",
                    message="Invalid session ID format",
                    level="warning",
                    session_id=str(session_id)
                )
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "invalid_session_id",
                        "message": "Invalid session ID format: must be a valid UUID",
                        "session_id": str(session_id)
                    }
                )
            return None

    @staticmethod
    async def get_session_record(
        session_uuid: uuid.UUID,
        db_session: AsyncSession,
        require_valid: bool
    ) -> Optional[Session]:
        """
        Fetch a session from the DB. If require_valid=True and not found, raise 404.
        """
        with sentry_sdk.start_span(op="session.db_lookup", description="Session DB Lookup"):
            stmt = select(Session).where(Session.id == session_uuid)
            result = await db_session.execute(stmt)
            session_obj = result.scalar_one_or_none()

            if not session_obj and require_valid:
                add_breadcrumb(
                    category="session",
                    message="Session not found",
                    level="warning",
                    session_id=str(session_uuid)
                )
                raise HTTPException(
                    status_code=404,
                    detail="Session not found"
                )
            return session_obj

    @staticmethod
    def check_expiry(session_obj: Session, require_valid: bool) -> bool:
        """
        Check if the session is expired. If require_valid=True and expired, raise 401.
        """
        with sentry_sdk.start_span(op="session.check_expiry", description="Check Session Expiry"):
            if session_obj.expires_at is not None:
                now = datetime.utcnow()
                if session_obj.expires_at.replace(tzinfo=None) < now:
                    if require_valid:
                        add_breadcrumb(
                            category="session",
                            message="Session expired",
                            level="warning",
                            session_id=str(session_obj.id)
                        )
                        raise HTTPException(
                            status_code=401,
                            detail="Session expired"
                        )
                    return False
            return True

    @staticmethod
    async def check_rate_limit(session_obj: Session, require_valid: bool) -> bool:
        """
        Call session's check_rate_limit (which may raise HTTPException).
        If require_valid=True, propagate that HTTPException.
        """
        with sentry_sdk.start_span(op="session.check_rate_limit", description="Check Rate Limits"):
            try:
                session_obj.check_rate_limit()
                return True
            except HTTPException as rate_error:
                add_breadcrumb(
                    category="session",
                    message="Session rate limited",
                    level="warning",
                    session_id=str(session_obj.id)
                )
                if require_valid:
                    raise rate_error
                return False

    @staticmethod
    def check_ownership(
        session_obj: Session,
        user_id: Optional[str],
        require_valid: bool
    ) -> bool:
        """
        If user_id is provided, confirm that session_obj's owner_id matches. 
        Raise 403 if not matching and require_valid=True.
        """
        metadata_val = session_obj.session_metadata
        
        if user_id and isinstance(metadata_val, dict) and 'owner_id' in metadata_val:
            owner_id = metadata_val.get('owner_id')
            if owner_id != str(user_id):
                if require_valid:
                    add_breadcrumb(
                        category="session",
                        message="Session ownership validation failed",
                        level="warning",
                        session_id=str(session_obj.id),
                        expected_user=str(user_id),
                        actual_user=owner_id
                    )
                    raise HTTPException(
                        status_code=403,
                        detail="You don't have permission to access this session"
                    )
                return False
        return True

    @staticmethod
    async def update_last_activity(session_uuid: uuid.UUID, db_session: AsyncSession) -> None:
        """
        Update the session's last_activity timestamp in the DB.
        """
        with sentry_sdk.start_span(op="session.update_activity", description="Update Last Activity"):
            await db_session.execute(
                update(Session)
                .where(Session.id == session_uuid)
                .values(last_activity=datetime.utcnow())
            )
            await db_session.commit()

    @staticmethod
    @trace_function(op="session.extend", name="extend_session")
    async def extend_session(session_id: Union[str, uuid.UUID], db_session: AsyncSession) -> bool:
        """
        Extend the expiration time of a session

        Args:
            session_id: The session ID to extend
            db_session: Database session

        Returns:
            True if extension succeeded, False otherwise
        """
        try:
            # Convert string to UUID if needed
            if isinstance(session_id, str):
                try:
                    session_id = uuid.UUID(session_id)
                except ValueError as e:
                    logger.warning(
                        f"Invalid session ID format in extend_session: {session_id}",
                        extra={"session_id": session_id, "error": str(e)}
                    )
                    add_breadcrumb(
                        category="session",
                        message="Invalid session ID format",
                        level="warning",
                        session_id=session_id
                    )
                    return False

            with trace_block("Check Session Exists", op="db.query"):
                stmt = select(Session).where(Session.id == session_id)
                result = await db_session.execute(stmt)
                session = result.scalar_one_or_none()

                if not session:
                    logger.warning(
                        f"Session not found in extend_session: {session_id}",
                        extra={"session_id": str(session_id)}
                    )
                    add_breadcrumb(
                        category="session",
                        message="Session not found for extension",
                        level="warning",
                        session_id=str(session_id)
                    )
                    return False

            with trace_block("Update Expiration", op="session.update_expiry"):
                session_timeout = getattr(config.settings, "SESSION_TIMEOUT_MINUTES", 30)
                expires_at = datetime.utcnow() + timedelta(minutes=session_timeout)
                await db_session.execute(
                    update(Session)
                    .where(Session.id == session_id)
                    .values(last_activity=datetime.utcnow(), expires_at=expires_at)
                )
                await db_session.commit()

            logger.info(
                f"Session extended successfully: {session_id}",
                extra={"session_id": str(session_id), "new_expires_at": expires_at.isoformat()}
            )
            add_breadcrumb(
                category="session",
                message="Session extended successfully",
                level="info",
                session_id=str(session_id)
            )
            return True

        except Exception as e:
            logger.error(
                f"Error extending session {session_id}: {str(e)}",
                extra={"session_id": str(session_id), "error": str(e)}
            )
            add_breadcrumb(
                category="session",
                message="Session extension failed",
                level="error",
                session_id=str(session_id),
                error=str(e)
            )
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
            (success, error_message)
        """
        try:
            # Validate with require_valid=True so an invalid session raises HTTPException
            session = await SessionService.validate_session(
                session_id=session_id,
                db_session=db_session,
                user_id=user_id,
                require_valid=True
            )

            if not session:
                return False, "Invalid session"

            current_model = session.last_model
            await db_session.execute(
                update(Session)
                .where(Session.id == session.id)
                .values(last_model=new_model)
            )
            await db_session.commit()

            logger.info(
                f"Switched model for session {session_id}: {current_model} -> {new_model}",
                extra={"session_id": str(session_id), "from_model": current_model, "to_model": new_model}
            )
            add_breadcrumb(
                category="session",
                message="Switched model successfully",
                level="info",
                session_id=str(session_id),
                from_model=current_model,
                to_model=new_model
            )
            return True, None

        except HTTPException as http_err:
            logger.warning(
                f"HTTP error in switch_model: {http_err.status_code} - {http_err.detail}",
                extra={"session_id": str(session_id), "new_model": new_model}
            )
            return False, str(http_err.detail)
        except Exception as e:
            logger.error(
                f"Error in switch_model for {session_id}: {str(e)}",
                extra={"session_id": str(session_id), "new_model": new_model, "error": str(e)}
            )
            add_breadcrumb(
                category="session",
                message="Model switch failed",
                level="error",
                session_id=str(session_id),
                new_model=new_model,
                error=str(e)
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
        Get the current model name associated with a session

        Args:
            session_id: The session ID to query
            db_session: Database session
            default_model: Optional fallback if no model is set

        Returns:
            Current model name, or the default_model if none
        """
        try:
            session_uuid = session_id if isinstance(session_id, uuid.UUID) else uuid.UUID(session_id)
            stmt = select(Session.last_model).where(Session.id == session_uuid)
            result = await db_session.execute(stmt)
            model = result.scalar_one_or_none()
            return model if model else default_model
        except Exception as e:
            logger.error(
                f"Error getting current model for session {session_id}: {str(e)}",
                extra={"session_id": str(session_id), "error": str(e)}
            )
            add_breadcrumb(
                category="session",
                message="Failed to get current model",
                level="error",
                session_id=str(session_id),
                error=str(e)
            )
            return default_model

        @staticmethod
        def calculate_timeout(session: Session) -> int:
            """
            Adaptive timeout calculation based on model and usage.
            Returns an integer representing minutes.
            """
            base_timeout = config.settings.SESSION_TIMEOUT_MINUTES
            model_factor = 2 if session.last_model and "o1" in session.last_model else 1
            from math import log
            activity_score = log(session.request_count + 1) if session.request_count else 0
            # Cap at 240 minutes (4 hours)
            return min(240, int(base_timeout * model_factor * (1 + activity_score / 10)))

    @staticmethod
    async def get_session_from_request(request, db_session: AsyncSession, require_valid: bool = False):
        """
        Extract and validate a session from the incoming FastAPI request. 
        If require_valid=True, raises HTTPException on missing/invalid session.

        Returns:
            Session object if valid, None otherwise.
        """
        with sentry_sdk.start_span(op="session.extract", description="Extract Session ID") as extract_span:
            session_id = None
            session_source = None

            # 1. Cookie
            session_id = request.cookies.get("session_id")
            if session_id:
                session_source = "cookie"
                extract_span.set_data("source", "cookie")

            # 2. Query param
            if not session_id:
                try:
                    query_params = request.query_params
                    if "session_id" in query_params:
                        session_id = query_params["session_id"]
                        session_source = "query_param"
                        extract_span.set_data("source", "query_param")
                except Exception as e:
                    extract_span.set_data("query_param_error", str(e))

            # 3. Header
            if not session_id:
                session_id = request.headers.get("X-Session-ID")
                if session_id:
                    session_source = "header"
                    extract_span.set_data("source", "header")

            # 4. JSON body for POST
            if not session_id and request.method == "POST":
                try:
                    body = await request.json()
                    if isinstance(body, dict) and "session_id" in body:
                        session_id = body["session_id"]
                        session_source = "body"
                        extract_span.set_data("source", "body")
                except Exception as e:
                    extract_span.set_data("body_parse_error", str(e))

            extract_span.set_data("session_id_found", bool(session_id))
            extract_span.set_data("session_source", session_source)

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

        # Validate the session
        return await SessionService.validate_session(
            session_id=session_id,
            db_session=db_session,
            require_valid=require_valid
        )
