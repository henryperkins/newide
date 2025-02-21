from fastapi.security import APIKeyHeader, HTTPBearer
from fastapi import Depends, HTTPException
from typing import Optional
from errors import create_error_response

security = HTTPBearer()
api_key_header = APIKeyHeader(name="api-key")

async def validate_auth(
    api_key: Optional[str] = Depends(api_key_header),
    token: Optional[str] = Depends(security)
):
    # Check if either authentication method is valid
    valid_api_key = api_key and api_key == config.AZURE_OPENAI_API_KEY
    valid_token = token and token.credentials == config.AZURE_OPENAI_API_KEY
    
    if not valid_api_key and not valid_token:
        raise create_error_response(
            status_code=401,
            code="unauthorized",
            message="Missing or invalid authentication credentials",
            error_type="authentication_error"
        )
