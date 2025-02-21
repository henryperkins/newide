from fastapi.security import APIKeyHeader, HTTPBearer
import config
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
    # Handle Entra ID validation
    valid_entra = False
    if config.AZURE_AUTH_METHOD == "entra":
        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential()
        entra_token = credential.get_token("https://cognitiveservices.azure.com/.default").token
        valid_entra = entra_token == token.credentials if token else False
    
    if not valid_api_key and not valid_entra:
        raise create_error_response(
            status_code=401,
            code="unauthorized",
            message="Missing or invalid authentication credentials",
            error_type="authentication_error"
        )
