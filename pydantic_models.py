from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

# -------------------------------------------------------------------------
# ChatMessage (Pydantic)
# -------------------------------------------------------------------------
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


# -------------------------------------------------------------------------
# CreateChatCompletionRequest (Pydantic)
# -------------------------------------------------------------------------
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


# -------------------------------------------------------------------------
# ChatCompletionChoice (Pydantic)
# -------------------------------------------------------------------------
class ChatCompletionChoice(BaseModel):
    """
    Single choice in a chat completion response.
    """
    index: int
    message: Dict[str, str]
    finish_reason: Optional[str] = None
    content_filter_results: Optional[Dict[str, Any]] = None


# -------------------------------------------------------------------------
# ChatCompletionUsage (Pydantic)
# -------------------------------------------------------------------------
class ChatCompletionUsage(BaseModel):
    """
    Token usage information for a chat completion.
    """
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    completion_tokens_details: Optional[Dict[str, int]] = None
    prompt_tokens_details: Optional[Dict[str, int]] = None


# -------------------------------------------------------------------------
# ChatCompletionResponse (Pydantic)
# -------------------------------------------------------------------------
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


# -------------------------------------------------------------------------
# ModelCapabilities and ModelCapabilitiesResponse (Pydantic)
# -------------------------------------------------------------------------
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
# -------------------------------------------------------------------------
# File schemas for file-related endpoints
# -------------------------------------------------------------------------
class FileResponseModel(BaseModel):
    id: str
    filename: str
    size: int
    upload_time: str
    char_count: int
    token_count: int
    file_type: str
    chunk_count: int
    status: str
    file_metadata: dict

class FileListResponse(BaseModel):
    files: List[FileResponseModel]
    total_count: int
    total_size: int

class DeleteFileResponse(BaseModel):
    id: str
    message: str
    deleted_at: str

class UserCreate(BaseModel):
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str
