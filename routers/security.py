from fastapi.security import APIKeyHeader, HTTPBearer
import config
from fastapi import Depends, HTTPException
from typing import Optional
from errors import create_error_response

security = HTTPBearer()
api_key_header = APIKeyHeader(name="api-key")

# async def validate_auth(api_key: Optional[str] = Depends(api_key_header), token: Optional[str] = Depends(security)):
#     pass  # Removed for pure JWT-based auth in chat endpoints

import config
import jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from models import User
from database import get_db_session
from fastapi import HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

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
        
        if not user or not user.is_active:
            return None

        return user
    except (jwt.DecodeError, jwt.ExpiredSignatureError):
        # Return None instead of raising an exception
        return None
