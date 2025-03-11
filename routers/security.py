from fastapi.security import APIKeyHeader, HTTPBearer
import config
from fastapi import Depends, HTTPException, Request
from typing import Optional, Tuple
import uuid
import logging
from errors import create_error_response
from services.session_service import SessionService
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from models import User, Session

logger = logging.getLogger(__name__)

security = HTTPBearer()
api_key_header = APIKeyHeader(name="api-key")

# async def validate_auth(api_key: Optional[str] = Depends(api_key_header), token: Optional[str] = Depends(security)):
#     pass  # Removed for pure JWT-based auth in chat endpoints

# removing repeated import config
from jose import jwt
from jose.exceptions import JWTError, ExpiredSignatureError
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from models import User
from database import get_db_session
from fastapi import HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

async def validate_session_ownership(
    session_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    db_session: AsyncSession = Depends(get_db_session)
) -> Tuple[bool, Optional[Session]]:
    """
    Validates that a session exists and is owned by the specified user (if user_id is provided).
    
    Args:
        session_id: The UUID of the session to validate
        user_id: Optional UUID of the user to check ownership against
        db_session: Database session
        
    Returns:
        Tuple of (is_valid, session_object)
    """
    try:
        # Use SessionService to validate the session
        session = await SessionService.validate_session(
            session_id=session_id,
            db_session=db_session,
            user_id=str(user_id) if user_id else None,
            require_valid=False
        )
        
        if not session:
            return False, None
            
        # If no user_id is provided, don't check ownership
        if not user_id:
            return True, session
            
        # Check if the session has an owner
        if not session.session_metadata or 'owner_id' not in session.session_metadata:
            # Session has no owner, so it's publicly accessible
            return True, session
            
        # Check if the owner matches the user_id
        if session.session_metadata['owner_id'] == str(user_id):
            return True, session
            
        # User does not own this session
        return False, session
        
    except Exception as e:
        logger.error(f"Error validating session ownership: {str(e)}")
        return False, None

async def get_current_user(
    db: AsyncSession = Depends(get_db_session),
    creds: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))
):
    # If no credentials provided, return None (anonymous user)
    if not creds:
        return None
    
    try:
        payload = jwt.decode(creds.credentials, config.settings.JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        if not user_id:
            return None

        # Validate UUID format
        try:
            user_uuid = uuid.UUID(user_id)
        except (ValueError, TypeError):
            logger.warning(f"Invalid user ID format in JWT: {user_id}")
            return None

        # Use proper query instead of db.get
        stmt = select(User).where(User.id == user_uuid)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if not user or not bool(user.is_active):
            return None

        return user
    except (JWTError, ExpiredSignatureError):
        # Return None instead of raising an exception
        return None
