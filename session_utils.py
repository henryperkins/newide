# session_utils.py (new file)

import uuid
from typing import Optional, Dict, Any, Union
from datetime import datetime, timedelta
from fastapi import Request, Cookie, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, text

from database import get_db_session
from models import Session
import config
from logging_config import logger

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
        # Try to get session ID from multiple sources
        session_id = None
        
        # 1. Check cookie
        session_id = request.cookies.get("session_id")
        
        # 2. Check query parameters
        if not session_id:
            try:
                query_params = request.query_params
                if "session_id" in query_params:
                    session_id = query_params["session_id"]
            except Exception:
                pass
        
        # 3. Check headers
        if not session_id:
            session_id = request.headers.get("X-Session-ID")
            
        # 4. Check JSON body for POST requests
        if not session_id and request.method == "POST":
            try:
                body = await request.json()
                if isinstance(body, dict) and "session_id" in body:
                    session_id = body["session_id"]
            except Exception:
                # Failed to parse body as JSON, that's fine
                pass
                
        # If no session ID found, return None or raise exception
        if not session_id:
            if require_valid:
                raise HTTPException(
                    status_code=401, 
                    detail="No valid session ID found"
                )
            return None
            
        # Validate UUID format
        try:
            session_uuid = uuid.UUID(session_id, version=4)
        except (ValueError, TypeError):
            logger.warning(f"Invalid session ID format: {session_id}")
            if require_valid:
                raise HTTPException(
                    status_code=400, 
                    detail="Invalid session ID format"
                )
            return None
            
        # Query database for session
        stmt = select(Session).where(Session.id == session_uuid)
        result = await db_session.execute(stmt)
        session = result.scalar_one_or_none()
        
        # Check if session exists and is not expired
        if not session:
            if require_valid:
                raise HTTPException(
                    status_code=404, 
                    detail="Session not found"
                )
            return None
            
        if session.expires_at and session.expires_at < datetime.utcnow():
            if require_valid:
                raise HTTPException(
                    status_code=401, 
                    detail="Session expired"
                )
            return None
            
        # Update last activity
        await db_session.execute(
            update(Session)
            .where(Session.id == session_uuid)
            .values(last_activity=datetime.utcnow())
        )
        await db_session.commit()
            
        return session
    
    @staticmethod
    async def create_session(db_session: AsyncSession) -> Session:
        """Create a new session"""
        session_id = uuid.uuid4()
        
        # Create session with expiration time
        expires_at = datetime.utcnow() + timedelta(minutes=config.SESSION_TIMEOUT_MINUTES)
        new_session = Session(
            id=session_id,
            created_at=datetime.utcnow(),
            last_activity=datetime.utcnow(),
            expires_at=expires_at
        )
        
        db_session.add(new_session)
        await db_session.commit()
        
        return new_session
    
    @staticmethod
    async def extend_session(
        session_id: Union[str, uuid.UUID], 
        db_session: AsyncSession
    ) -> bool:
        """Extend the expiration time of a session"""
        try:
            # Convert string to UUID if needed
            if isinstance(session_id, str):
                session_id = uuid.UUID(session_id)
                
            # Update expiration time
            expires_at = datetime.utcnow() + timedelta(minutes=config.SESSION_TIMEOUT_MINUTES)
            await db_session.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(
                    last_activity=datetime.utcnow(),
                    expires_at=expires_at
                )
            )
            await db_session.commit()
            return True
        except Exception as e:
            logger.error(f"Error extending session {session_id}: {str(e)}")
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

