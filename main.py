import logging
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, Request
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware 
import asyncio
from slowapi import Limiter
from slowapi.util import get_remote_address
from time import perf_counter
from fastapi.responses import RedirectResponse

# Configure logging




logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

import os

# Ensure the logs directory exists
if not os.path.exists("logs"):
    os.makedirs("logs")

# Configure a dedicated logger for user input
input_logger = logging.getLogger("input_logger")
input_logger.setLevel(logging.INFO)
input_handler = logging.FileHandler("logs/input.log")
input_handler.setLevel(logging.INFO)
input_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
input_logger.addHandler(input_handler)

# Configure a dedicated logger for model responses
response_logger = logging.getLogger("response_logger")
response_logger.setLevel(logging.INFO)
response_handler = logging.FileHandler("logs/response.log")
response_handler.setLevel(logging.INFO)
response_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
response_logger.addHandler(response_handler)

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import (
    text,
    Column,
    String,
    DateTime,
    Text,
    ForeignKey,
    Integer,
    BigInteger,
)
from fastapi.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, validator
from typing import Optional
from enum import Enum
import uuid
import datetime

from sqlalchemy.dialects.postgresql import UUID as PGUUID
import config
from openai import AzureOpenAI
import tiktoken


def count_tokens(text: str, model: str = None) -> int:
    """
    Count tokens based on model type with proper fallbacks.
    For o-series models:
    - Input context window: 200,000 tokens
    - Output context window: 100,000 tokens
    """
    try:
        # Default to cl100k_base for o-series models
        if model and any(m in model.lower() for m in ["o1-", "o3-"]):
            encoding = tiktoken.get_encoding("cl100k_base")
        else:
            # For other models, try to get specific encoding or fall back to cl100k_base
            try:
                encoding = tiktoken.encoding_for_model(model if model else "gpt-4")
            except KeyError:
                encoding = tiktoken.get_encoding("cl100k_base")

        return len(encoding.encode(text))
    except Exception as e:
        # Log the error and fall back to approximate calculation
        logger.warning(f"Token counting error for model {model}: {str(e)}")
        # More conservative approximation (3.5 chars per token average)
        return len(text) // 3


def calculate_model_timeout(messages, model_name, reasoning_effort="medium"):
    """
    Calculate appropriate timeout based on model type, message complexity,
    and reasoning effort level.

    Args:
        messages: The formatted messages to be sent to the model
        model_name: The name of the model deployment
        reasoning_effort: One of "low", "medium", "high"

    Returns:
        float: Calculated timeout in seconds
    """
    # Determine if using o-series model
    is_o_series = (
        any(m in model_name.lower() for m in ["o1-", "o3-"])
        and "preview" not in model_name.lower()
    )

    # Calculate approximate token count - safer to overestimate
    approx_token_count = len(str(messages))

    if is_o_series:
        # Get reasoning effort multiplier with fallback
        effort_multiplier = config.REASONING_EFFORT_MULTIPLIERS.get(
            reasoning_effort, config.REASONING_EFFORT_MULTIPLIERS["medium"]
        )

        # Calculate timeout with o-series specific factors
        calculated_timeout = max(
            config.O_SERIES_BASE_TIMEOUT,
            approx_token_count * config.O_SERIES_TOKEN_FACTOR * effort_multiplier,
        )

        # Cap at maximum timeout
        return min(config.O_SERIES_MAX_TIMEOUT, calculated_timeout)
    else:
        # Standard model calculation (maintain existing logic)
        calculated_timeout = max(
            config.STANDARD_BASE_TIMEOUT,
            approx_token_count * config.STANDARD_TOKEN_FACTOR,
        )
        return min(config.STANDARD_MAX_TIMEOUT, calculated_timeout)


app = FastAPI()

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

# Add security middleware
# app.add_middleware(HTTPSRedirectMiddleware)


# @app.middleware("http")
# async def security_headers(request: Request, call_next):
#     response = await call_next(request)
#     response.headers.update(
#         {
#             "Content-Security-Policy": (
#                 # default-src controls the global fallback
#                 "default-src 'self' https://liveonshuffle.com; "
#                 # scripts
#                 "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
#                 # styles – single directive for inline styles
#                 "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
#                 # images
#                 "img-src 'self' data:; "
#                 # fonts
#                 "font-src 'self' data:; "
#                 # XHR, fetch
#                 "connect-src 'self';"
#             ),
#             "X-Content-Type-Options": "nosniff",
#             "X-Frame-Options": "DENY",
#             "X-XSS-Protection": "1; mode=block",
#         }
#     )
#     return response


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        # Create tables sequentially
        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )
        """
            )
        )

        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        """
            )
        )

        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                size BIGINT NOT NULL,
                upload_time TIMESTAMPTZ DEFAULT NOW()
            )
        """
            )
        )

        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS typing_activity (
                session_id UUID REFERENCES sessions(id),
                user_id UUID NOT NULL,
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (session_id, user_id)
            )
        """
            )
        )


# Mount static files before the root route
app.mount("/static", StaticFiles(directory="static", html=True), name="static")


@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base = declarative_base()


# SQLAlchemy ORM Models


class Session(Base):
    __tablename__ = "sessions"
    id = Column(PGUUID, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_activity = Column(DateTime(timezone=True), server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))


class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id"), nullable=False)
    filename = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    size = Column(BigInteger, nullable=False)
    upload_time = Column(DateTime(timezone=True), server_default=text("NOW()"))


# Error response models matching OpenAPI spec
class ErrorBase(BaseModel):
    code: str
    message: str


class Error(ErrorBase):
    param: Optional[str] = None
    type: Optional[str] = None
    inner_error: Optional[dict] = None


class ErrorResponse(BaseModel):
    error: Error


# Standard error handler function
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


# Initialize Azure OpenAI client with updated configuration and error handling
client = AzureOpenAI(
    api_key=str(config.AZURE_OPENAI_API_KEY),
    api_version="2025-01-01-preview",  # Updated to match OpenAPI spec
    azure_endpoint=str(config.AZURE_OPENAI_ENDPOINT),
    default_headers={"api-version": "2025-01-01-preview"},  # Add version header
)

# Configure PostgreSQL
engine = create_async_engine(
    config.POSTGRES_URL,  # From .env via config.py
    pool_size=20,
    max_overflow=10,
    pool_recycle=3600,
    connect_args={"ssl": "prefer"},  # Add SSL preference
)
AsyncSessionLocal = sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
)


class ReasoningEffort(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


def validate_reasoning_effort(value: Optional[ReasoningEffort]) -> str:
    try:
        # Return enum value if provided, else default to "medium"
        return value.value if value else "medium"
    except AttributeError:
        return "medium"


# API Response Models
class FileResponse(BaseModel):
    id: str
    filename: str
    size: int
    upload_time: str


class FileListResponse(BaseModel):
    files: list[FileResponse]
    total_count: int
    total_size: int


class DeleteFileResponse(BaseModel):
    id: str
    message: str
    deleted_at: str


# API Response Models for Conversations
class ConversationMessage(BaseModel):
    role: str
    content: str
    timestamp: str


class ConversationResponse(BaseModel):
    conversation: list[ConversationMessage]
    total_messages: int


class ClearConversationResponse(BaseModel):
    message: str
    cleared_at: str
    message_count: int


class ChatMessage(BaseModel):
    message: str
    session_id: str
    developer_config: Optional[str] = None
    reasoning_effort: Optional[ReasoningEffort] = None
    response_format: Optional[str] = None  # For o-series JSON output control
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


@app.post("/chat")
@limiter.limit("10/minute")
async def chat(request: Request, chat_message: ChatMessage):
    start_time = perf_counter()
    session_id = chat_message.session_id
    logger.info(f"Chat request received from session {session_id}")
    input_logger.info(chat_message.message)

    # Prepare messages list with developer config and user input
    messages = []

    # Use developer message (preferred for o-series) over system message
    if chat_message.developer_config:
        messages.append(
            {
                "role": "developer",
                "content": (
                    f"Formatting re-enabled - {chat_message.developer_config}"
                    if "formatting" in chat_message.developer_config.lower()
                    else chat_message.developer_config
                ),
            }
        )

    # Add user message
    messages.append({"role": "user", "content": chat_message.message})

    async with AsyncSessionLocal() as db_session:
        # Retrieve previous conversation history (if needed)
        result = await db_session.execute(
            text(
                "SELECT role, content FROM conversations WHERE session_id = :session_id ORDER BY timestamp ASC"
            ),
            {"session_id": session_id},
        )
        history = result.mappings().all()
        # Prepend the history to the messages list (if applicable)
        if history:
            messages = [
                {"role": row["role"], "content": row["content"]} for row in history
            ] + messages

        # Format messages according to API schema
        formatted_messages = []

        # Add developer config if present
        if chat_message.developer_config:
            formatted_messages.append(
                {
                    "role": "developer",
                    "content": [
                        {"type": "text", "text": chat_message.developer_config}
                    ],
                }
            )

        # Add conversation history with proper content structure
        for msg in history:
            message = {
                "role": msg["role"],
                "content": (
                    [{"type": "text", "text": msg["content"]}]
                    if isinstance(msg["content"], str)
                    else msg["content"]
                ),
            }
            # Add name if present in historical message
            if "name" in msg:
                message["name"] = msg["name"]
            formatted_messages.append(message)

        # Add current user message
        formatted_messages.append(
            {
                "role": "user",
                "content": [{"type": "text", "text": chat_message.message}],
            }
        )

        # Define parameters strictly following API schema
        model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
        is_o_series = (
            any(m in model_name for m in ["o1-", "o3-"]) and "preview" not in model_name
        )

        params = {
            "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
            "messages": formatted_messages,
            "stream": False,
        }

        # Add o-series specific parameters
        if is_o_series:
            params["max_completion_tokens"] = 40000
            params["reasoning_effort"] = validate_reasoning_effort(
                chat_message.reasoning_effort
            )
        else:
            # For non-o-series models, use standard parameters
            params["max_tokens"] = 4096
            params["temperature"] = 1.0
            params["top_p"] = 1.0
            params["presence_penalty"] = 0
            params["frequency_penalty"] = 0

        # Add optional parameters
        if chat_message.response_format:
            params["response_format"] = {"type": chat_message.response_format}

        logger.info(
            f"Using API parameters for {'o-series' if is_o_series else 'standard'} model: "
            f"{str(params)}"
        )

        try:
            # Enhanced retry and timeout implementation
            original_reasoning_effort = params.get("reasoning_effort", "medium")
            retry_attempts = 0
            max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 1
            retry_reasoning_efforts = []
            timeouts_used = []

            while True:
                current_reasoning = params.get("reasoning_effort", "medium")

                # Calculate appropriate timeout based on model and reasoning effort
                timeout = calculate_model_timeout(
                    formatted_messages, model_name, current_reasoning
                )

                # Apply retry backoff if this is a retry attempt
                if retry_attempts > 0:
                    backoff_multiplier = (
                        config.O_SERIES_BACKOFF_MULTIPLIER**retry_attempts
                    )
                    timeout = timeout * backoff_multiplier

                # Track timeouts for logging/debugging
                timeouts_used.append(timeout)

                logger.info(
                    f"Attempt {retry_attempts+1}/{max_retries+1} with "
                    f"{current_reasoning} reasoning effort, timeout: {timeout:.1f}s"
                )

                # Set client timeout
                client.timeout = timeout

                try:
                    attempt_start = perf_counter()
                    response = client.chat.completions.create(**params)

                    # If we got here, request succeeded
                    elapsed = perf_counter() - attempt_start
                    logger.info(
                        f"Request completed successfully in {elapsed:.2f}s using "
                        f"{current_reasoning} reasoning effort"
                    )
                    break

                except Exception as e:
                    elapsed = perf_counter() - attempt_start
                    error_msg = str(e).lower()

                    # Track what we tried
                    retry_reasoning_efforts.append(current_reasoning)

                    # Check if we've exhausted our retries
                    if retry_attempts >= max_retries:
                        logger.error(
                            f"All {retry_attempts+1} attempts failed. Final error after "
                            f"{elapsed:.2f}s: {error_msg}"
                        )
                        raise create_error_response(
                            status_code=503,
                            code="service_timeout",
                            message="Service temporarily unavailable - all retry attempts failed",
                            error_type="timeout",
                            inner_error={
                                "original_error": error_msg,
                                "total_elapsed_seconds": perf_counter() - start_time,
                                "reasoning_attempts": [original_reasoning_effort]
                                + retry_reasoning_efforts,
                                "timeouts_used": timeouts_used,
                            },
                        )

                    retry_attempts += 1

                    # For o-series models, progressively reduce reasoning effort
                    if is_o_series and "low" != current_reasoning:
                        # First try reducing to medium if we're on high
                        if current_reasoning == "high" and retry_attempts == 1:
                            params["reasoning_effort"] = "medium"
                            logger.warning(
                                f"Request timed out after {elapsed:.2f}s with high reasoning. "
                                f"Retrying with medium reasoning."
                            )
                        else:
                            # Otherwise reduce to low
                            params["reasoning_effort"] = "low"
                            logger.warning(
                                f"Request timed out after {elapsed:.2f}s with {current_reasoning} reasoning. "
                                f"Retrying with low reasoning."
                            )
                    else:
                        # If already at low reasoning, we'll retry with same parameters but longer timeout
                        # due to backoff multiplier applied above
                        logger.warning(
                            f"Request timed out after {elapsed:.2f}s with {current_reasoning} reasoning. "
                            f"Retrying with increased timeout."
                        )

            # Log successful response with detailed performance info
            elapsed_total = perf_counter() - start_time

            # Log the raw JSON response with performance data
            import json

            try:
                response_data = (
                    response.to_dict() if hasattr(response, "to_dict") else response
                )
                response_data["_performance"] = {
                    "total_elapsed_seconds": elapsed_total,
                    "attempts": retry_attempts + 1,
                    "final_reasoning_effort": params.get("reasoning_effort"),
                    "original_reasoning_effort": original_reasoning_effort,
                    "timeouts_used": timeouts_used,
                }
                raw_json = json.dumps(response_data, default=str, indent=2)
                response_logger.info("Raw JSON response: %s", raw_json)
            except Exception as log_ex:
                response_logger.warning(
                    f"Failed to serialize raw response: {str(log_ex)}"
                )

            assistant_msg = response.choices[0].message.content
            response_logger.info(assistant_msg)

        except Exception as outer_e:
            error_msg = str(outer_e)
            logger.error(f"Outer error layer: {error_msg}")

            # Check if it's already a structured error response
            if isinstance(outer_e, HTTPException) and isinstance(outer_e.detail, dict):
                raise outer_e

            raise create_error_response(
                status_code=500,
                code="request_processing_error",
                message="Error processing chat completion request",
                error_type="internal_error",
                inner_error={"original_error": error_msg},
            )

        # Save the conversation to the database
        async with AsyncSessionLocal() as db_session:
            user_msg = Conversation(
                session_id=session_id, role="user", content=chat_message.message
            )
            assistant_msg_obj = Conversation(
                session_id=session_id, role="assistant", content=assistant_msg
            )
            db_session.add(user_msg)
            db_session.add(assistant_msg_obj)
            await db_session.execute(
                text(
                    "UPDATE sessions SET last_activity = NOW() WHERE id = :session_id"
                ),
                {"session_id": session_id},
            )
            await db_session.commit()

        elapsed = perf_counter() - start_time
        tokens = {
            "prompt": response.usage.prompt_tokens if response.usage else 0,
            "completion": response.usage.completion_tokens if response.usage else 0,
            "total": response.usage.total_tokens if response.usage else 0,
        }
        logger.info(
            f"Chat request completed in {elapsed:.2f}s - Tokens used: {tokens['total']} "
            f"(prompt: {tokens['prompt']}, completion: {tokens['completion']})"
        )

        # Build response according to API reference
        response_data = {
            "response": assistant_msg,
            "usage": {
                "prompt_tokens": tokens["prompt"],
                "completion_tokens": tokens["completion"],
                "total_tokens": tokens["total"],
            },
        }

        # Add detailed tracking information if requested
        if chat_message.include_usage_metrics and hasattr(
            response.usage, "completion_tokens_details"
        ):
            completion_details = response.usage.completion_tokens_details
            if hasattr(completion_details, "reasoning_tokens"):
                response_data["usage"]["completion_details"] = {
                    "reasoning_tokens": completion_details.reasoning_tokens
                }

        # Include additional response data based on API reference
        if hasattr(response, "choices") and response.choices:
            choice = response.choices[0]
            # Add finish reason
            if hasattr(choice, "finish_reason"):
                response_data["finish_reason"] = choice.finish_reason
            # Add content filter results if present
            if hasattr(choice, "content_filter_results"):
                response_data["content_filter_results"] = choice.content_filter_results

        # Add system fingerprint for deterministic responses
        if hasattr(response, "system_fingerprint"):
            response_data["system_fingerprint"] = response.system_fingerprint

        # Add prompt filter results if present
        if hasattr(response, "prompt_filter_results"):
            response_data["prompt_filter_results"] = response.prompt_filter_results

        return response_data


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = Form(...)):
    logger.info(
        f"File upload request received: {file.filename} for session {session_id}"
    )
    if not session_id:
        raise create_error_response(
            status_code=400,
            code="missing_session_id",
            message="Session ID is required",
            param="session_id",
        )

    async with AsyncSessionLocal() as db_session:
        session = await db_session.get(Session, session_id)
        if not session:
            raise create_error_response(
                status_code=400,
                code="invalid_session_id",
                message="Invalid session ID",
                param="session_id",
            )

        try:
            contents = await file.read()
            try:
                file_text = contents.decode("utf-8")

                # Get model information
                model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
                is_o_series = (
                    any(m in model_name for m in ["o1-", "o3-"])
                    and "preview" not in model_name
                )

                # Calculate tokens with proper model context
                token_count = count_tokens(
                    file_text, config.AZURE_OPENAI_DEPLOYMENT_NAME
                )
                max_tokens = 200000 if is_o_series else 4096

                # Truncate based on token count if needed
                if token_count > max_tokens:
                    # Use tiktoken for precise truncation
                    encoding = tiktoken.get_encoding("cl100k_base")
                    tokens = encoding.encode(file_text)
                    safe_token_limit = (
                        max_tokens - 100
                    )  # Leave room for truncation message
                    truncated_tokens = tokens[:safe_token_limit]
                    file_text = encoding.decode(truncated_tokens)
                    file_text += "\n[Content truncated to fit model context window]"
                    token_count = count_tokens(
                        file_text, config.AZURE_OPENAI_DEPLOYMENT_NAME
                    )
                    logger.info(
                        f"File truncated from {len(tokens)} to {token_count} tokens"
                    )

                file_id = uuid.uuid4()
                uploaded_file = UploadedFile(
                    id=file_id,
                    session_id=session_id,
                    filename=file.filename or "unnamed_file.txt",
                    content=file_text,
                    size=len(contents),
                )
                db_session.add(uploaded_file)
                await db_session.commit()

                # Prepare detailed metadata
                metadata = {
                    "filename": file.filename,
                    "size": len(contents),
                    "upload_time": uploaded_file.upload_time.isoformat(),
                    "char_count": len(file_text),
                    "token_count": token_count,
                    "model_info": {
                        "name": config.AZURE_OPENAI_DEPLOYMENT_NAME,
                        "type": "o-series" if is_o_series else "standard",
                        "max_context_tokens": max_tokens,
                        "encoding": "cl100k_base",
                    },
                    "truncated": (
                        token_count < len(tokens) if "tokens" in locals() else False
                    ),
                }

                logger.info(
                    f"File uploaded successfully: {file.filename} "
                    f"({metadata['size']} bytes, ~{metadata['token_count']} tokens)"
                )

                return {
                    "message": "File uploaded successfully",
                    "file_id": str(file_id),
                    "metadata": metadata,
                }
            except UnicodeDecodeError:
                raise create_error_response(
                    status_code=400,
                    code="invalid_encoding",
                    message="File must be valid UTF-8 text",
                    error_type="validation_error",
                    param="file",
                )
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise create_error_response(
                status_code=500,
                code="file_processing_error",
                message="Error processing file",
                error_type="internal_error",
                inner_error={"original_error": str(e)},
            )


@app.get("/files/{session_id}", response_model=FileListResponse)
async def get_files(session_id: str):
    try:
        async with AsyncSessionLocal() as db_session:
            # Verify session exists
            session = await db_session.get(Session, session_id)
            if not session:
                raise create_error_response(
                    status_code=404,
                    code="session_not_found",
                    message="Session not found",
                    error_type="not_found",
                    param="session_id",
                )

            result = await db_session.execute(
                text(
                    """
                    SELECT id, filename, size, upload_time
                    FROM uploaded_files
                    WHERE session_id = :session_id
                    ORDER BY upload_time DESC
                """
                ),
                {"session_id": session_id},
            )
            files = result.mappings().all()

            # Calculate totals
            total_size = sum(file["size"] for file in files)

            return FileListResponse(
                files=[
                    FileResponse(
                        id=str(file["id"]),
                        filename=file["filename"],
                        size=file["size"],
                        upload_time=file["upload_time"].isoformat(),
                    )
                    for file in files
                ],
                total_count=len(files),
                total_size=total_size,
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error retrieving files",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )


@app.delete("/files/{session_id}/{file_id}", response_model=DeleteFileResponse)
async def delete_file(session_id: str, file_id: str):
    try:
        async with AsyncSessionLocal() as db_session:
            # Verify session exists
            session = await db_session.get(Session, session_id)
            if not session:
                raise create_error_response(
                    status_code=404,
                    code="session_not_found",
                    message="Session not found",
                    error_type="not_found",
                    param="session_id",
                )

            result = await db_session.execute(
                text(
                    """
                    DELETE FROM uploaded_files
                    WHERE session_id = :session_id AND id = :file_id
                    RETURNING id
                """
                ),
                {"session_id": session_id, "file_id": file_id},
            )
            deleted = result.first()
            if not deleted:
                raise create_error_response(
                    status_code=404,
                    code="file_not_found",
                    message="File not found",
                    error_type="not_found",
                    param="file_id",
                )

            await db_session.commit()
            return DeleteFileResponse(
                id=str(deleted[0]),
                message="File deleted successfully",
                deleted_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error deleting file",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )


@app.websocket("/ws/typing/{session_id}")
async def websocket_typing(websocket: WebSocket, session_id: str):
    await websocket.accept()
    user_id = str(uuid.uuid4())

    try:
        while True:
            await websocket.receive_text()
            async with AsyncSessionLocal() as db_session:
                await db_session.execute(
                    text(
                        """
                        INSERT INTO typing_activity 
                            (session_id, user_id, last_activity)
                        VALUES (:session_id, :user_id, NOW())
                        ON CONFLICT (session_id, user_id) 
                        DO UPDATE SET last_activity = NOW()
                    """
                    ),
                    {"session_id": session_id, "user_id": user_id},
                )
                await db_session.commit()

                result = await db_session.execute(
                    text(
                        """
                        SELECT user_id 
                        FROM typing_activity 
                        WHERE session_id = :session_id 
                        AND last_activity > NOW() - 
                            INTERVAL '2 seconds'
                    """
                    ),
                    {"session_id": session_id},
                )
                active_typers = [str(row[0]) for row in result]

            await websocket.send_json({"typing_users": active_typers})

    except WebSocketDisconnect:
        async with AsyncSessionLocal() as db_session:
            await db_session.execute(
                text(
                    """
                    DELETE FROM typing_activity 
                    WHERE session_id = :session_id AND user_id = :user_id
                """
                ),
                {"session_id": session_id, "user_id": user_id},
            )
            await db_session.commit()


@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.utcnow()}


@app.post("/new_session")
async def new_session():
    session_id = uuid.uuid4()
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        minutes=config.SESSION_TIMEOUT_MINUTES
    )

    async with AsyncSessionLocal() as session:
        new_session_obj = Session(id=session_id, expires_at=expires_at)
        session.add(new_session_obj)
        await session.commit()

    return {"session_id": str(session_id)}


@app.get("/new_session")
async def reject_new_session_get():
    raise HTTPException(status_code=405, detail="Use POST method to create new session")


@app.get("/conversation/{session_id}", response_model=ConversationResponse)
async def get_conversation(session_id: str):
    try:
        async with AsyncSessionLocal() as db_session:
            # Verify session exists
            session = await db_session.get(Session, session_id)
            if not session:
                raise create_error_response(
                    status_code=404,
                    code="session_not_found",
                    message="Session not found",
                    error_type="not_found",
                    param="session_id",
                )

            result = await db_session.execute(
                text(
                    """
                    SELECT role, content, timestamp
                    FROM conversations
                    WHERE session_id = :session_id
                    ORDER BY timestamp ASC
                """
                ),
                {"session_id": session_id},
            )
            history = result.mappings().all()

            return ConversationResponse(
                conversation=[
                    ConversationMessage(
                        role=row["role"],
                        content=row["content"],
                        timestamp=row["timestamp"].isoformat(),
                    )
                    for row in history
                ],
                total_messages=len(history),
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error retrieving conversation history",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )


@app.delete("/conversation/{session_id}", response_model=ClearConversationResponse)
async def clear_conversation(session_id: str):
    try:
        async with AsyncSessionLocal() as db_session:
            # Verify session exists
            session = await db_session.get(Session, session_id)
            if not session:
                raise create_error_response(
                    status_code=404,
                    code="session_not_found",
                    message="Session not found",
                    error_type="not_found",
                    param="session_id",
                )

            # Get count of messages before deleting
            result = await db_session.execute(
                text(
                    """
                    SELECT COUNT(*) as count
                    FROM conversations
                    WHERE session_id = :session_id
                """
                ),
                {"session_id": session_id},
            )
            message_count = result.scalar()

            # Delete messages
            await db_session.execute(
                text(
                    """
                    DELETE FROM conversations
                    WHERE session_id = :session_id
                """
                ),
                {"session_id": session_id},
            )
            await db_session.commit()

            return ClearConversationResponse(
                message="Conversation history cleared",
                cleared_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                message_count=message_count,
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error clearing conversation history",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )
