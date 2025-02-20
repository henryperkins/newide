# errors.py
from pydantic import BaseModel
from typing import Optional
from fastapi import HTTPException

class ErrorBase(BaseModel):
    code: str
    message: str

class Error(ErrorBase):
    param: Optional[str] = None
    type: Optional[str] = None
    inner_error: Optional[dict] = None

class ErrorResponse(BaseModel):
    error: Error

def create_error_response(
    status_code: int,
    code: str,
    message: str,
    param: Optional[str] = None,
    error_type: Optional[str] = None,
    inner_error: Optional[dict] = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=ErrorResponse(
            error=Error(
                code=code,
                message=message,
                param=param,
                type=error_type,
                inner_error=inner_error,
            )
        ).dict(),
    )