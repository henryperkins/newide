from pydantic import BaseModel, validator, Field, model_validator
from typing import Optional, List, Dict, Any, Literal
from enum import Enum
from datetime import datetime
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

class VectorStoreCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Custom metadata for vector store organization"
    )

class VectorStoreResponse(VectorStoreCreateRequest):
    id: str
    created_at: datetime
    object: str = "vector_store"

class ReasoningEffort(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"

class ChatMessageContent(BaseModel):
    role: Literal["user", "assistant", "developer"] = Field(..., description="Message author role")
    content: str = Field(..., min_length=1, description="Message content")

class CreateChatCompletionRequest(BaseModel):
    model: str = Field(..., description="Azure OpenAI deployment name")
    message: str = Field(..., description="User message content")
    session_id: str = Field(..., description="Session ID for conversation history")
    reasoning_effort: ReasoningEffort = Field(
        default=ReasoningEffort.medium,
        description="Reasoning effort level (required for o-series models)"
    )
    max_completion_tokens: int = Field(
        default=40000,
        ge=100,
        le=100000,
        description="Maximum tokens for response (required for o-series)"
    )
    temperature: float = Field(
        default=1.0, 
        ge=0.0, 
        le=2.0,
        description="Temperature setting (fixed for o-series)"
    )
    stream: bool = Field(
        default=False,
        description="Streaming enabled (only supported for o3-mini)"
    )
    developer_config: Optional[str] = Field(
        default=None,
        description="Developer instructions with formatting hints"
    )
    include_files: Optional[bool] = Field(
        default=False,
        description="Whether to include file context in the request"
    )

    @model_validator(mode='after')
    @classmethod
    def validate_o_series_params(cls, values):
        model_name = values.model.lower()
        if "o" in model_name:
            forbidden_params = ["max_tokens", "top_p", "frequency_penalty", "presence_penalty"]
            if any(getattr(values, param, None) for param in forbidden_params):
                raise ValueError(f"Parameters {forbidden_params} not supported for o-series models")
        return values

class ChatCompletionResponseChoice(BaseModel):
    finish_reason: str = Field(..., alias="finish_reason")
    index: int
    message: Dict[str, Any] = Field(..., description="Message content with citations")
    content_filter_results: Dict[str, Any] = Field(
        ..., 
        alias="content_filter_results",
        description="Azure content filtering results"
    )

class ChatCompletionResponseUsage(BaseModel):
    completion_tokens: int
    prompt_tokens: int
    total_tokens: int
    completion_tokens_details: Dict[str, Optional[int]] = Field(
        default_factory=dict,
        description="Includes reasoning_tokens for o-series"
    )
    prompt_tokens_details: Dict[str, Optional[int]] = Field(
        default_factory=dict,
        description="Includes cached_tokens if applicable"
    )

class ChatCompletionResponse(BaseModel):
    id: str
    created: int
    model: str
    system_fingerprint: str
    object: str = "chat.completion"
    choices: List[ChatCompletionResponseChoice]
    usage: ChatCompletionResponseUsage
    prompt_filter_results: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Content filtering results for prompts"
    )
    response_format: Optional[str] = Field(
        default=None,
        description="Response format: text, json_object, or xml (o1 models only)",
        json_schema_extra={"enum": ["text", "json_object", "xml"]}
    )
    reasoning_effort: Optional[ReasoningEffort] = Field(
        default=ReasoningEffort.medium,
        description="Default effort level for optimal performance"
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
    tools: Optional[List[Dict]] = Field(
        default=None,
        description="Tools available to the model"
    )
    tool_resources: Optional[Dict] = Field(
        default=None,
        description="Resource references for tools"
    )
    include_usage_metrics: Optional[bool] = Field(
        default=False,
        description="Include detailed token metrics"
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
    file_type: Optional[str] = None
    status: Optional[str] = "ready"
    chunk_count: Optional[int] = 1
    file_metadata: Optional[Dict] = None

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

class ChatMessage(BaseModel):
    message: str
    session_id: str
    developer_config: Optional[str] = None
    reasoning_effort: ReasoningEffort = ReasoningEffort.medium
    include_files: bool = False
    response_format: Optional[str] = None
    max_completion_tokens: Optional[int] = 40000
