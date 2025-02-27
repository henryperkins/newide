from typing import Optional, List, Dict, Any, Union
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

    # Add the missing messages field that process_chat_message expects
    messages: Optional[List[Dict[str, Any]]] = None

    def __init__(self, **data):
        super().__init__(**data)

        # Auto-populate messages field if it wasn't provided but message was
        if self.messages is None and self.message:
            self.messages = [{"role": "user", "content": self.message}]

        # If developer_config is provided, add it as a system/developer message
        if self.developer_config and self.messages:
            # Check if any existing system/developer message
            has_system = any(
                m.get("role") in ["system", "developer"] for m in self.messages
            )

            if not has_system:
                # Get model name from data if it exists
                model_name = data.get("model", "").lower()

                # Check if this is an o-series model
                is_o_series = "o1" in model_name or "o3" in model_name

                # Determine role based on model type
                role = "developer" if is_o_series else "system"
                self.messages.insert(
                    0, {"role": role, "content": self.developer_config}
                )


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
