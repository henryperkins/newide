# errors.py
import json
from pydantic import BaseModel
from typing import Optional, List
from fastapi import HTTPException

class ErrorBase(BaseModel):
    code: str
    message: str

class Error(ErrorBase):
    param: Optional[str] = None
    type: Optional[str] = None
    inner_error: Optional[dict] = None

class ErrorDetails(BaseModel):
    code: str
    message: str
    target: Optional[str] = None
    details: Optional[List["ErrorDetails"]] = None

class ErrorResponse(BaseModel):
    error: ErrorDetails

def create_error_response(
    status_code: int,
    code: str,
    message: str,
    param: Optional[str] = None,
    error_type: Optional[str] = None,
    inner_error: Optional[dict] = None,
) -> HTTPException:
    error_detail = ErrorDetails(
        code=code,
        message=message,
        target=param,
        details=[ErrorDetails(**inner_error)] if inner_error else None
    )
    
    return HTTPException(
        status_code=status_code,
        detail=ErrorResponse(error=error_detail).model_dump(),
        headers={
            "x-ms-error-code": code.upper().replace("_", "-"),
            "x-ms-error-message": message,
            "x-ms-error-details": json.dumps(inner_error) if inner_error else None
        }
    )
