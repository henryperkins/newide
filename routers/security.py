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
    creds: HTTPAuthorizationCredentials = Depends(HTTPBearer())
):
    try:
        payload = jwt.decode(creds.credentials, config.settings.JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        user = await db.get(User, user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Inactive user")

        return user
    except jwt.DecodeError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
