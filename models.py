from pydantic import BaseModel, validator
from typing import Optional, List
from enum import Enum
class ClearConversationResponse(BaseModel):
    message: str
    cleared_at: str
    # Number of messages that were cleared in this operation
    cleared_message_count: int

    @validator("cleared_message_count")
    def validate_message_count(cls, value):
        if value < 0:
            raise ValueError("cleared_message_count cannot be negative")
        return value
class DeleteFileResponse(BaseModel):

    id: str
    message: str
    deleted_at: str

class ReasoningEffort(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"

class ChatMessage(BaseModel):
    message: str
    session_id: str
    developer_config: Optional[str] = None
    reasoning_effort: Optional[ReasoningEffort] = None
    response_format: Optional[str] = None
    include_usage_metrics: Optional[bool] = False

    @validator("session_id")
    def validate_session_id(cls, value):
        try:
            from uuid import UUID as PyUUID
            PyUUID(value)
            return value
        except ValueError:
            raise ValueError("Invalid session ID format (must be a valid UUID)")

    @validator("response_format")
    def validate_response_format(cls, value):
        if value and value not in ["text", "json_object"]:
            raise ValueError("response_format must be either 'text' or 'json_object'")
        return value

class FileResponseModel(BaseModel):
    id: str
    filename: str
    size: int
    upload_time: str
    char_count: int
    token_count: int

class FileListResponse(BaseModel):
    files: List[FileResponseModel]
    total_count: int
    total_size: int

class ConversationMessage(BaseModel):
    role: str
    content: str
    timestamp: str

class ConversationResponse(BaseModel):
    conversation: List[ConversationMessage]
    total_messages: int