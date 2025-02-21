# errors.py
from pydantic import BaseModel
from typing import Dict, List, Optional
from fastapi import HTTPException
import json

class ContentFilterResult(BaseModel):
    filtered: bool
    severity: Optional[str] = None

class InnerError(BaseModel):
    code: str
    content_filter_results: Optional[Dict[str, ContentFilterResult]] = None

class Error(BaseModel):
    code: str
    message: str
    param: Optional[str] = None
    type: Optional[str] = None
    inner_error: Optional[InnerError] = None

class APIErrorResponse(BaseModel):
    error: Error

def create_error_response(
    status_code: int,
    code: str,
    message: str,
    param: Optional[str] = None,
    error_type: Optional[str] = None,
    content_filter_results: Optional[Dict[str, Dict]] = None
) -> HTTPException:
    # Convert content filter results to proper format
    inner_error = None
    if content_filter_results:
        filter_results = {
            key: ContentFilterResult(**value)
            for key, value in content_filter_results.items()
        }
        inner_error = InnerError(
            code="content_filter",
            content_filter_results=filter_results
        )

    error = Error(
        code=code,
        message=message,
        param=param,
        type=error_type or "server_error",
        inner_error=inner_error
    )
    
    return HTTPException(
        status_code=status_code,
        detail=APIErrorResponse(error=error).model_dump(),
        headers={
            "x-ms-error-code": code.upper().replace("_", "-"),
            "x-ms-error-message": message,
            "x-ms-error-details": json.dumps(content_filter_results) if content_filter_results else None
        }
    )
