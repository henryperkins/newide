from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

class ChatMessage(BaseModel):
    """
    Internal representation of a chat message with all possible parameters.
    """
    message: str
    session_id: str
    developer_config: Optional[str] = None
    reasoning_effort: Optional[str] = "medium"
    include_files: bool = False
    file_ids: Optional[List[str]] = None
    use_file_search: bool = False
    response_format: Optional[str] = None
    max_completion_tokens: Optional[int] = None
    temperature: Optional[float] = None
    model: Optional[str] = None

class CreateChatCompletionRequest(BaseModel):
    """
    Request format for chat completion API endpoint.
    """
    messages: List[Dict[str, str]]
    session_id: str
    model: Optional[str] = None
    developer_config: Optional[str] = None
    reasoning_effort: Optional[str] = "medium"
    include_files: bool = False
    file_ids: Optional[List[str]] = None
    use_file_search: bool = False
    response_format: Optional[Dict[str, str]] = None
    max_completion_tokens: Optional[int] = None
    temperature: Optional[float] = None

class ChatCompletionChoice(BaseModel):
    """
    Single choice in a chat completion response.
    """
    index: int
    message: Dict[str, str]
    finish_reason: Optional[str] = None
    content_filter_results: Optional[Dict[str, Any]] = None

class ChatCompletionUsage(BaseModel):
    """
    Token usage information for a chat completion.
    """
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    completion_tokens_details: Optional[Dict[str, int]] = None
    prompt_tokens_details: Optional[Dict[str, int]] = None

class ChatCompletionResponse(BaseModel):
    """
    Full response format for chat completion API endpoint.
    """
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    system_fingerprint: Optional[str] = None
    choices: List[ChatCompletionChoice]
    usage: ChatCompletionUsage
    prompt_filter_results: Optional[List[Dict[str, Any]]] = None

class Session(BaseModel):
    """
    Database model for chat sessions.
    """
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity: datetime = Field(default_factory=datetime.utcnow)
    last_model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class Conversation(BaseModel):
    """
    Database model for conversation messages.
    """
    id: Optional[int] = None
    session_id: uuid.UUID
    role: str
    content: str
    model: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Optional[Dict[str, Any]] = None

class UploadedFile(BaseModel):
    """
    Database model for uploaded files.
    """
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    session_id: uuid.UUID
    filename: str
    content: Optional[str] = None
    status: Optional[str] = None
    chunk_count: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class AppConfiguration(BaseModel):
    """
    Database model for application configuration.
    """
    key: str
    value: Dict[str, Any]
    description: Optional[str] = None
    is_secret: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class ModelUsageStats(BaseModel):
    """
    Database model for tracking model usage statistics.
    """
    id: Optional[int] = None
    model: str
    session_id: uuid.UUID
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    reasoning_tokens: Optional[int] = None
    cached_tokens: Optional[int] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Optional[Dict[str, Any]] = None

class ModelCapabilities(BaseModel):
    """
    Model capabilities response format.
    """
    model: str
    capabilities: Dict[str, Any]

class ModelCapabilitiesResponse(BaseModel):
    """
    Response format for model capabilities endpoint.
    """
    models: Dict[str, ModelCapabilities]

class FileResponseModel(BaseModel):
    """
    Response model for file operations.
    """
    id: str
    filename: str
    status: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class FileListResponse(BaseModel):
    """
    Response model for listing files.
    """
    files: List[FileResponseModel]
    total_count: int

class DeleteFileResponse(BaseModel):
    """
    Response model for file deletion.
    """
    status: str
    deleted_id: str
