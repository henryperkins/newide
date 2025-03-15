from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from uuid import UUID

# -------------------------------------------------------------------------
# ChatMessage (Pydantic)
# -------------------------------------------------------------------------

class ChatMessage(BaseModel):
    """
    Internal representation of a chat message with all possible parameters.
    """

    message: str
    session_id: str
    reasoning_effort: Optional[str] = "medium"
    include_files: bool = False
    model: Optional[str] = None
    file_ids: Optional[List[str]] = None
    use_file_search: bool = False
    response_format: Optional[Dict[str, str]] = Field(
        None, description="O-series only: Request structured output format"
    )
    max_completion_tokens: Optional[int] = None
    max_tokens: Optional[int] = None  # Added for non-O-series models
    temperature: Optional[float] = None

    # Add the missing messages field that process_chat_message expects
    messages: Optional[List[Dict[str, Any]]] = None

    @model_validator(mode="after")
    def validate_model_specific_rules(self):
        """Validate parameters against model-specific constraints"""
        from config import is_o_series_model, is_deepseek_model

        model_name = (self.model or "").lower()
        is_o_model = is_o_series_model(model_name)

        if is_o_model:
            # O-series validations
            if self.response_format and isinstance(self.response_format, dict) and "json_schema" not in self.response_format:
                raise ValueError("O-series requires JSON schema for structured output")
            if self.max_completion_tokens and self.max_completion_tokens > 100000:
                raise ValueError("O-series completion limited to 100,000 tokens")
            if self.messages and sum(len(m["content"]) for m in self.messages) > 200000:
                raise ValueError("O-series context limit is 200,000 tokens")
            if self.temperature is not None:
                raise ValueError("O-series models don't support temperature parameter")
            if any(msg.get("role") == "system" for msg in self.messages or []):
                raise ValueError("O-series models use 'developer' role instead of 'system'")

        # Handle max tokens parameter conversion
        if is_o_model and self.max_tokens is not None:
            # For O-series, convert max_tokens to max_completion_tokens if needed
            self.max_completion_tokens = self.max_completion_tokens or self.max_tokens
            self.max_tokens = None
        elif not is_o_model and self.max_completion_tokens is not None:
            # For non-O-series, convert max_completion_tokens to max_tokens if needed
            self.max_tokens = self.max_tokens or self.max_completion_tokens
            self.max_completion_tokens = None

        if is_deepseek_model(model_name) and self.max_tokens:
            if self.max_tokens > 131072:  # 128k context
                raise ValueError("DeepSeek-R1 supports max 131072 tokens")
            if self.max_completion_tokens and self.max_completion_tokens > 32000:
                raise ValueError("DeepSeek-R1 completion limited to 32000 tokens")

        return self

    def __init__(self, **data):
        super().__init__(**data)

        # Auto-populate messages field if it wasn't provided but message was
        if self.messages is None and self.message:
            self.messages = [{"role": "user", "content": self.message}]


# -------------------------------------------------------------------------
# CreateChatCompletionRequest (Pydantic)
# -------------------------------------------------------------------------
from pydantic import field_validator

class CreateChatCompletionRequest(BaseModel):
    """
    Request format for chat completion API endpoint.
    """

    @model_validator(mode="before")
    @classmethod
    def handle_single_message(cls, values):
        """
        Allows passing a single 'message' key instead of a full 'messages' array.
        """
        if "messages" not in values and "message" in values:
            user_msg = values["message"]
            values["messages"] = [{"role": "user", "content": user_msg}]
        return values

    messages: List[Dict[str, Any]]
    session_id: Optional[str] = Field(None, description="Optional session ID. If not provided, a new session will be created.")
    model: Optional[str] = None
    reasoning_effort: Optional[str] = "medium"
    include_files: bool = False
    file_ids: Optional[List[str]] = None
    use_file_search: bool = False
    response_format: Optional[Dict[str, str]] = None
    max_completion_tokens: Optional[int] = None
    max_tokens: Optional[int] = None  # Added for non-O-series models
    temperature: Optional[float] = None
    stream: Optional[bool] = None  # Add explicit stream parameter

    @field_validator("messages")
    @classmethod
    def validate_messages(cls, v):
        if not v:
            raise ValueError("messages field cannot be empty")
        for idx, msg in enumerate(v):
            if not isinstance(msg, dict):
                raise ValueError(f"messages[{idx}] must be a dictionary")
            if "role" not in msg or "content" not in msg:
                raise ValueError(f"messages[{idx}] must contain 'role' and 'content' keys")
            if not isinstance(msg["role"], str) or not isinstance(msg["content"], str):
                raise ValueError(f"messages[{idx}].role and messages[{idx}].content must be strings")
        return v

    @model_validator(mode="after")
    def validate_and_normalize_max_tokens(self):
        """
        Normalize max_tokens parameters based on model type.
        For O-series models, ensure max_completion_tokens is set.
        For other models, ensure max_tokens is set.
        """
        from config import is_o_series_model

        model_name = (self.model or "").lower()
        is_o_model = is_o_series_model(model_name)

        # Handle parameter conversion
        if is_o_model:
            # For O-series models, prefer max_completion_tokens
            if self.max_tokens is not None and self.max_completion_tokens is None:
                self.max_completion_tokens = self.max_tokens
                self.max_tokens = None
        else:
            # For other models, prefer max_tokens
            if self.max_completion_tokens is not None and self.max_tokens is None:
                self.max_tokens = self.max_completion_tokens
                self.max_completion_tokens = None

        return self


# -------------------------------------------------------------------------
# ChatCompletionChoice (Pydantic)
# -------------------------------------------------------------------------
class ChatCompletionChoice(BaseModel):
    """
    Single choice in a chat completion response.
    """

    index: int
    message: Dict[str, Any]  # Changed from Dict[str, str] to Dict[str, Any]
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
    """
    Response model for a single file.
    """

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
    """
    Response model for a list of files.
    """

    files: List[FileResponseModel]
    total_count: int
    total_size: int


class DeleteFileResponse(BaseModel):
    """
    Response model for a file deletion operation.
    """

    id: str
    message: str
    deleted_at: str


# -------------------------------------------------------------------------
# User-related models
# -------------------------------------------------------------------------
class UserCreate(BaseModel):
    """
    Request model for creating a new user.
    """

    email: str
    password: str


class UserLogin(BaseModel):
    """
    Request model for user login.
    """

    email: str
    password: str


# -------------------------------------------------------------------------
# Session-related models
# -------------------------------------------------------------------------
class SessionResponse(BaseModel):
    """
    Response model for session operations.
    """
    id: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    last_activity: Optional[datetime] = None
    last_model: Optional[str] = None
    status: str = "active"


class SessionInfoResponse(BaseModel):
    """
    Model for partial session information.
    """

    status: str
    message: Optional[str] = None
    session_id: Optional[str] = None


# -------------------------------------------------------------------------
# Error response model
# -------------------------------------------------------------------------
class ErrorResponse(BaseModel):
    """
    Standard error response format.
    """

    code: str
    message: str
    type: str = "error"
    param: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    retry_after: Optional[int] = Field(
        None, json_schema_extra={"example": 30}  # For 429 errors
    )


# -------------------------------------------------------------------------
# Assistant-related models
# -------------------------------------------------------------------------
class AssistantTool(BaseModel):
    """
    Tool configuration for an assistant.
    """

    type: str
    function: Optional[Dict[str, Any]] = None


class AssistantCreateRequest(BaseModel):
    """
    Request model for creating a new assistant.
    """

    model: str
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    tools: List[AssistantTool] = []
    file_ids: List[str] = []
    metadata: Optional[Dict[str, str]] = None


class AssistantObject(BaseModel):
    """
    Response model for an assistant object.
    """

    id: str
    object: str = "assistant"
    created_at: int
    name: Optional[str] = None
    description: Optional[str] = None
    model: str
    instructions: Optional[str] = None
    tools: List[AssistantTool] = []
    file_ids: List[str] = []
    metadata: Optional[Dict[str, str]] = None


class ListAssistantsResponse(BaseModel):
    """
    Response model for listing assistants.
    """

    object: str = "list"
    data: List[AssistantObject]
    first_id: Optional[str] = None
    last_id: Optional[str] = None
    has_more: bool = False


class DeleteAssistantResponse(BaseModel):
    """
    Response model for deleting an assistant.
    """

    id: str
    object: str = "assistant.deleted"
    deleted: bool = True


class FilePreview(BaseModel):
    id: UUID
    filename: str
    preview: str
    mime_type: str
