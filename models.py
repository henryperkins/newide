from pydantic import BaseModel, validator, Field
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
    developer_config: Optional[str] = Field(
        default=None,
        description="Developer instructions with 'Formatting re-enabled' prefix for markdown support"
    )
    reasoning_effort: Optional[ReasoningEffort] = Field(
        default=ReasoningEffort.medium,
        description="Default effort level for optimal performance"
    )
    response_format: Optional[str] = Field(
        default=None,
        json_schema_extra={"enum": ["text", "json_object", "xml"]},
        description="Response format: text, json_object, or xml (o1 models only)"
    )
    include_usage_metrics: Optional[bool] = Field(
        default=False,
        description="Include detailed token usage metrics"
    )
    max_completion_tokens: Optional[int] = Field(
        default=None,
        ge=100,
        le=100000,
        description="Maximum number of tokens to generate (o-series models only)"
    )


    @validator("response_format")
    def validate_response_format(cls, value):
        if value and value not in ["text", "json_object", "xml"]:
            raise ValueError("response_format must be either 'text', 'json_object' or 'xml'")
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
