# errors.py
from pydantic import BaseModel
from typing import Any, Dict, Optional
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
    content_filter_results: Optional[Dict[str, Dict]] = None,
    inner_error: Optional[Dict[str, Any]] = None
) -> HTTPException:
    # Convert content filter results to proper format
    constructed_inner_error = None
    filter_results: Optional[Dict[str, ContentFilterResult]] = None
    if content_filter_results:
        filter_results = {
            key: ContentFilterResult(**value)
            for key, value in content_filter_results.items()
        }
        constructed_inner_error = InnerError(
            code="content_filter",
            content_filter_results=filter_results
        )
    error = Error(
        code=code,
        message=message,
        param=param,
        type=error_type or "invalid_request_error",
        inner_error=InnerError(
            code="content_filter" if content_filter_results else code,
            content_filter_results=filter_results if content_filter_results else None,
            **(constructed_inner_error.__dict__ if isinstance(constructed_inner_error, InnerError) else constructed_inner_error or {})
        ) if content_filter_results or constructed_inner_error else None
    )
    
    headers_dict = {
        "x-ms-error-code": code.upper().replace("_", "-"),
        "x-ms-error-message": message
    }
    if content_filter_results:
        headers_dict["x-ms-error-details"] = json.dumps(content_filter_results)
    return HTTPException(
        status_code=status_code,
        detail=APIErrorResponse(error=error).model_dump(),
        headers=headers_dict
    )
