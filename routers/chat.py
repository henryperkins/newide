"""
This module provides endpoints for chat operations, including:
- Storing chat messages in the database
- Retrieving conversation history
- Listing existing sessions
- Creating chat completions (both standard and streaming via SSE)

It supports both Azure OpenAI and Azure AI Inference clients, with
custom handling for DeepSeek and O-series models. The code includes
some basic retry logic and content transformations, such as handling
<think> tags in DeepSeek responses.
"""

import json
import uuid
import time
import re
from typing import Optional, List, Dict, Any, Union
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    Request,
    HTTPException,
    Query
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func, insert
from azure.core.exceptions import HttpResponseError

from database import get_db_session, AsyncSessionLocal
from clients import get_model_client_dependency
from config import (
    DEEPSEEK_R1_DEFAULT_API_VERSION,
    DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
    DEEPSEEK_R1_DEFAULT_TEMPERATURE,
    O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
    MODEL_API_VERSIONS,
    AZURE_OPENAI_DEPLOYMENT_NAME,
    is_o_series_model,
    is_deepseek_model
)
from logging_config import logger

from pydantic_models import (
    ChatMessage,
    ChatCompletionResponse,
    CreateChatCompletionRequest,
    ModelCapabilities,
    ModelCapabilitiesResponse
)
from models import Conversation, User
from routers.security import get_current_user
from services.config_service import ConfigService, get_config_service
from services.chat_service import (
    process_chat_message,
    save_conversation
)
from utils import handle_client_error
from azure.ai.inference import ChatCompletionsClient
from openai import AzureOpenAI

router = APIRouter(prefix="/chat")


@router.post("/conversations/store")
async def store_message(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Store a single chat message in the database.

    This endpoint supports JSON bodies. The required fields are:
    - session_id (string UUID)
    - role (string: 'user' | 'assistant' | etc.)
    - content (string: the message content)
    """
    from json import JSONDecodeError
    try:
        # Parse the request body
        try:
            body = await request.json()
        except JSONDecodeError:
            body = None

        if not body:
            raise HTTPException(status_code=400, detail="Invalid or missing JSON body")

        session_id = body.get("session_id")
        role = body.get("role")
        content = body.get("content")

        # Validate required parameters
        if not session_id:
            raise HTTPException(status_code=400, detail="Missing session_id parameter")
        if not role:
            raise HTTPException(status_code=400, detail="Missing role parameter")
        if not content:
            raise HTTPException(status_code=400, detail="Missing content parameter")

        # Validate session_id format
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid session_id format: {session_id}"
            )

        # Prepare insertion values
        values = {
            "session_id": session_uuid,
            "role": role,
            "content": content
        }

        # Add user_id if we have a logged-in user
        if current_user:
            values["user_id"] = current_user.id

        # Insert into database
        stmt = insert(Conversation).values(**values)
        await db.execute(stmt)
        await db.commit()

        return {"status": "success"}

    except HTTPException:
        # Re-raise our handled HTTPExceptions
        raise
    except Exception as e:
        # Roll back and log unexpected exceptions
        await db.rollback()
        logger.exception(f"Error storing message: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", include_in_schema=False)
async def create_chat_no_slash(
    request: CreateChatCompletionRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
    config_service: ConfigService = Depends(get_config_service)
):
    """
    For POST /chat with no trailing slash, we defer to create_chat_completion
    to ensure consistent behavior.
    """
    return await create_chat_completion(request, db, current_user, config_service)


@router.get("/api/conversations/history")
async def get_conversation_history(
    session_id: UUID = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Returns messages for a specified session in ascending (chronological) order.

    - session_id: UUID of the conversation session
    - offset: pagination offset
    - limit: pagination limit

    Response includes:
    - messages: list of messages with role, content, timestamp
    - has_more: boolean indicating whether more messages are available
    """
    try:
        query = (
            select(Conversation)
            .where(Conversation.session_id == session_id)
            .order_by(Conversation.id.asc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(query)
        messages = result.scalars().all()

        return {
            "session_id": str(session_id),
            "messages": [
                {
                    "role": msg.role,
                    "content": (msg.formatted_content or msg.content),
                    "raw_content": msg.content,
                    "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
                }
                for msg in messages
            ],
            "offset": offset,
            "limit": limit,
            "returned_count": len(messages),
            "has_more": (len(messages) == limit),
        }

    except Exception as e:
        logger.exception(f"Error retrieving conversation history: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/conversations/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Returns a list of distinct session_ids in the conversations table,
    along with how many messages each session has.
    """
    try:
        stmt = select(
            Conversation.session_id,
            func.count(Conversation.id).label("message_count")
        ).group_by(Conversation.session_id)

        result = await db.execute(stmt)
        rows = result.all()
        return [
            {
                "session_id": str(row.session_id),
                "message_count": row.message_count
            }
            for row in rows
        ]
    except Exception as e:
        logger.exception(f"Error listing conversation sessions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=None)
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
    config_service: ConfigService = Depends(get_config_service),
):
    """
    Creates a single chat completion in a non-streaming manner,
    returning a ChatCompletionResponse following Azure OpenAI style.

    This supports:
    - DeepSeek models via Azure Inference
    - O-series (special reasoning param)
    - Standard Azure OpenAI with standard parameters
    """
    model_name = request.model or AZURE_OPENAI_DEPLOYMENT_NAME

    # Get the expected API version for this model from config
    expected_version = MODEL_API_VERSIONS.get(model_name, MODEL_API_VERSIONS.get("default"))
    logger.debug(f"Expected API version for model '{model_name}': {expected_version}")

    try:
        # Validate that we have messages
        if not request.messages:
            raise HTTPException(
                status_code=400,
                detail="Missing required arguments; 'messages' is required"
            )

        # If no model specified, fall back to default from config
        if not request.model:
            request.model = AZURE_OPENAI_DEPLOYMENT_NAME
            logger.info(f"No model specified. Using default: {request.model}")

        logger.info(f"API request for model: {request.model}")

        # Acquire the client from our dependency
        try:
            client_wrapper = await get_model_client_dependency(request.model)
            client = client_wrapper.get("client")
            model_config = client_wrapper.get("model_config", {})
            model_type = model_config.get("model_type", "standard")

            # If the client has an azure_deployment different from the user request, override
            if (
                isinstance(client, ChatCompletionsClient) and
                hasattr(client, "azure_deployment") and
                client.azure_deployment != request.model
            ):
                logger.info(
                    f"Using fallback model {client.azure_deployment} instead of {request.model}"
                )
                request.model = client.azure_deployment

        except Exception as e:
            logger.error(f"Error getting model client: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": {
                        "code": "model_unavailable",
                        "message": f"Could not initialize model {request.model}",
                        "type": "service_error",
                    }
                },
            )

        messages = request.messages
        temperature = request.temperature
        max_tokens = request.max_completion_tokens

        # Determine client type
        is_inference_client = isinstance(client, ChatCompletionsClient)
        deepseek_check = is_deepseek_model(request.model)

        # Validate parameters based on model type
        if is_o_series_model(request.model):
            if request.temperature is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Temperature parameter not supported for o-series models"
                )
            if not request.reasoning_effort:
                request.reasoning_effort = "medium"
            elif request.reasoning_effort not in ["low", "medium", "high"]:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid reasoning_effort. Must be 'low', 'medium', or 'high'"
                )

        if is_deepseek_model(request.model):
            if not request.max_completion_tokens:
                request.max_completion_tokens = config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            elif request.max_completion_tokens > config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS:
                raise HTTPException(
                    status_code=400,
                    detail=f"max_completion_tokens cannot exceed {DEEPSEEK_R1_DEFAULT_MAX_TOKENS} for DeepSeek models"
                )

        # Prepare the final response structure
        response_data: Dict[str, Any] = {}

        #
        # 1) If the client is an Inference Client:
        #
        if is_inference_client:
            if deepseek_check or model_type == "deepseek":
                # Perform custom handling for DeepSeek
                max_retries = 3
                retry_count = 0
                retry_delay = 2
                last_error = None

                while retry_count <= max_retries:
                    try:
                        # Non-streaming completion
                        response = client.complete(
                            model=request.model,
                            messages=messages,
                            temperature=DEEPSEEK_R1_DEFAULT_TEMPERATURE,
                            max_tokens=DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
                            stream=False
                        )

                        # Convert to a standard ChatCompletion-style dict
                        usage_data = {
                            "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                            "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                            "total_tokens": response.usage.total_tokens if response.usage else 0,
                        }

                        response_data = {
                            "id": f"chatcmpl-{uuid.uuid4()}",
                            "object": "chat.completion",
                            "created": int(time.time()),
                            "model": request.model,
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {
                                        "role": "assistant",
                                        "content": response.choices[0].message.content or "",
                                    },
                                    "finish_reason": response.choices[0].finish_reason,
                                }
                            ],
                            "usage": usage_data,
                        }
                        break

                    except Exception as e:
                        retry_count += 1
                        last_error = e

                        # Check if it's a timeout error
                        is_timeout = False
                        if hasattr(e, "__cause__") and e.__cause__:
                            if "timeout" in str(e.__cause__).lower():
                                is_timeout = True
                        elif "timeout" in str(e).lower():
                            is_timeout = True

                        if is_timeout and retry_count <= max_retries:
                            logger.warning(
                                f"Timeout in DeepSeek request, retrying "
                                f"({retry_count}/{max_retries})"
                            )
                            import asyncio
                            await asyncio.sleep(retry_delay)
                            retry_delay *= 2
                        else:
                            raise

                if retry_count > max_retries and last_error:
                    raise last_error

            else:
                # If it's an inference client but not recognized as DeepSeek
                raise ValueError(
                    f"Unsupported model '{request.model}' for ChatCompletionsClient"
                )

        #
        # 2) Otherwise, Azure OpenAI-based client
        #
        else:
            # If it's a deepseek model with an AzureOpenAI client, handle specially
            if deepseek_check:
                response = client.chat.completions.create(
                    model=request.model,
                    messages=messages,
                    temperature=DEEPSEEK_R1_DEFAULT_TEMPERATURE,
                    max_tokens=DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
                    stream=False
                )
            elif is_o_series_model(request.model):
                # O-series model with reasoning effort
                logger.info(f"O-series model: {request.model}, reasoning={request.reasoning_effort}")
                response = client.chat.completions.create(
                    model=request.model,
                    messages=messages,
                    reasoning_effort=request.reasoning_effort or "medium",
                    max_completion_tokens=max_tokens or 5000,
                    stream=False
                )
            else:
                # Standard Azure OpenAI usage
                response = client.chat.completions.create(
                    model=request.model,
                    messages=messages,
                    max_completion_tokens=max_tokens,
                    temperature=temperature,
                    stream=False
                )

            response_data = response.model_dump()

        # Extract the assistant content for DB storage
        full_content = response_data["choices"][0]["message"]["content"]

        # Format content for <think> blocks if it's a DeepSeek model
        formatted_content = full_content
        if deepseek_check and full_content:
            think_regex = r"<think>([\s\S]*?)<\/think>"
            matches = re.findall(think_regex, full_content)
            for i, match in enumerate(matches):
                thinking_html = (
                    f"""<div class="thinking-process">
                    <div class="thinking-header">
                        <button class="thinking-toggle" aria-expanded="true">
                            <span class="toggle-icon">▼</span> Thinking Process
                        </button>
                    </div>
                    <div class="thinking-content">
                        <pre class="thinking-pre">{match}</pre>
                    </div>
                    </div>"""
                )
                formatted_content = formatted_content.replace(
                    f"<think>{match}</think>", thinking_html, 1
                )

        # Create user message (the last message in request.messages is from the user)
        user_msg_content = request.messages[-1]["content"] if request.messages else ""
        user_msg = Conversation(
            session_id=request.session_id,
            role="user",
            content=user_msg_content,
            model=request.model,
        )

        # Create assistant message
        assistant_msg = Conversation(
            session_id=request.session_id,
            role="assistant",
            content=full_content,
            formatted_content=formatted_content,
            model=request.model,
            raw_response={"streaming": False, "final_content": full_content},
        )

        # Store both in DB
        db.add(user_msg)
        db.add(assistant_msg)
        await db.commit()

        return response_data

    except HTTPException:
        raise
    except Exception as e:
        error_detail = handle_client_error(e)
        logger.exception(f"Error creating chat completion: {str(e)}")
        raise HTTPException(
            status_code=error_detail["status_code"],
            detail=error_detail["message"]
        )


async def generate_stream_chunks(
    message: str,
    client: Union[AzureOpenAI, ChatCompletionsClient],
    model_name: str,
    developer_config: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str
):
    """
    Async generator that yields SSE data chunks from streaming responses.

    It handles:
    - Developer config as a system message (if provided)
    - DeepSeek models with <think> block expansions
    - O-series with reasoning effort
    - Standard Azure OpenAI streaming
    """

    is_inference_client = isinstance(client, ChatCompletionsClient)
    deepseek_check = is_deepseek_model(model_name)

    # Build messages list
    messages_list = []
    if developer_config:
        messages_list.append({"role": "system", "content": developer_config})
    messages_list.append({"role": "user", "content": message})

    # Default parameters
    params = {
        "messages": messages_list,
        "temperature": DEEPSEEK_R1_DEFAULT_TEMPERATURE if deepseek_check else 0.7,
        "max_tokens": (
            DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            if deepseek_check
            else O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
        ),
    }

    if not deepseek_check and reasoning_effort:
        params["reasoning_effort"] = reasoning_effort

    # For streaming:
    params["stream"] = True
    full_content = ""
    heartbeat_interval = 30
    last_heartbeat = time.time()

    async def send_heartbeat():
        """Helper function to emit a heartbeat event."""
        nonlocal last_heartbeat
        current_time = time.time()
        if current_time - last_heartbeat >= heartbeat_interval:
            last_heartbeat = current_time
            yield f"data: {json.dumps({'heartbeat': True})}\n\n"

    try:
        #
        # 1) Inference Client + DeepSeek
        #
        if is_inference_client and deepseek_check:
            max_retries = 3
            retry_count = 0
            retry_delay = 2

            while retry_count <= max_retries:
                try:
                    stream = client.complete(
                        model=model_name,
                        messages=params["messages"],
                        temperature=params["temperature"],
                        max_tokens=params["max_tokens"],
                        stream=True
                    )

                    for chunk in stream:
                        try:
                            # Each chunk should have chunk.choices
                            if hasattr(chunk, "choices") and chunk.choices:
                                choice = chunk.choices[0]
                                if hasattr(choice, "delta") and hasattr(choice.delta, "content"):
                                    content = choice.delta.content or ""
                                    full_content += content
                                    yield f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"
                                elif (
                                    hasattr(choice, "message") and
                                    hasattr(choice.message, "content") and
                                    choice.message.content
                                ):
                                    content = choice.message.content
                                    full_content += content
                                    yield f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"

                        except Exception as chunk_err:
                            logger.warning(f"Error processing DeepSeek chunk: {str(chunk_err)}")
                            yield f"data: {json.dumps({'choices': [{'delta': {'content': ''}}]})}\n\n"

                    break

                except Exception as e:
                    retry_count += 1
                    
                    # Check for rate limit (429) errors
                    if isinstance(e, HttpResponseError) and e.status_code == 429:
                        logger.warning(f"Rate limit exceeded (429). Retry count: {retry_count}/{max_retries}")
                        yield f"data: {json.dumps({'error': {'code': 429, 'message': 'Rate limit exceeded. Please try again later.'}})}\n\n"
                        if retry_count <= max_retries:
                            import asyncio
                            await asyncio.sleep(retry_delay * 2)  # Longer delay for rate limits
                            retry_delay *= 2
                            continue
                        else:
                            return  # Exit the generator if max retries reached for rate limits
                    
                    # Check for timeout errors
                    is_timeout = False
                    if hasattr(e, "__cause__") and e.__cause__:
                        if "timeout" in str(e.__cause__).lower():
                            is_timeout = True
                    elif "timeout" in str(e).lower():
                        is_timeout = True

                    if is_timeout and retry_count <= max_retries:
                        logger.warning(
                            f"Timeout error in DeepSeek streaming, "
                            f"retrying ({retry_count}/{max_retries})"
                        )
                        yield f"data: {json.dumps({'choices': [{'delta': {'content': f'\n\n[Timeout, retry {retry_count}/{max_retries}]'}}]})}\n\n"
                        import asyncio
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2
                    else:
                        raise

        #
        # 2) Otherwise, standard streaming with Azure OpenAI
        #
        else:
            response = client.begin_chat_completions(deployment=model_name, **params, stream=True)
            async for chunk in response:
                response_data = {
                    "id": f"chatcmpl-{uuid.uuid4()}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": []
                }

                chunk_choices = []
                for idx, choice in enumerate(chunk.choices):
                    partial = {
                        "index": idx,
                        "delta": {},
                        "finish_reason": choice.finish_reason,
                    }
                    if hasattr(choice.delta, "content"):
                        content_part = choice.delta.content or ""
                        full_content += content_part
                        partial["delta"]["content"] = content_part
                    if hasattr(choice.delta, "role"):
                        partial["delta"]["role"] = choice.delta.role
                    if hasattr(choice.delta, "tool_calls"):
                        partial["delta"]["tool_calls"] = choice.delta.tool_calls
                    if hasattr(chunk, "content_filter_results"):
                        partial["delta"]["content_filter_results"] = chunk.content_filter_results

                    chunk_choices.append(partial)

                response_data["choices"] = chunk_choices
                yield f"data: {json.dumps(response_data)}\n\n"

        #
        # After streaming completes, store the entire assistant message in DB
        #
        if full_content:
            formatted_content = full_content
            if deepseek_check:
                # Format <think> blocks
                think_regex = r"<think>([\s\S]*?)<\/think>"
                matches = re.findall(think_regex, full_content)
                for i, match in enumerate(matches):
                    thinking_html = (
                        f"""<div class="thinking-process">
                        <div class="thinking-header">
                            <button class="thinking-toggle" aria-expanded="true">
                                <span class="toggle-icon">▼</span> Thinking Process
                            </button>
                        </div>
                        <div class="thinking-content">
                            <pre class="thinking-pre">{match}</pre>
                        </div>
                        </div>"""
                    )
                    formatted_content = formatted_content.replace(
                        f"<think>{match}</think>", thinking_html, 1
                    )

            # Save both user + assistant messages in DB
            user_msg = Conversation(
                session_id=session_id,
                role="user",
                content=message,
                model=model_name,
            )
            assistant_msg = Conversation(
                session_id=session_id,
                role="assistant",
                content=full_content,
                formatted_content=formatted_content,
                model=model_name,
                raw_response={"streaming": True, "final_content": full_content},
            )

            # Use the existing DB session in save_conversation to stay consistent
            await save_conversation(
                db_session=db,
                session_id=session_id,
                model_name=model_name,
                user_text=message,
                assistant_text=full_content,
                formatted_assistant_text=formatted_content,
                raw_response=None
            )

    except Exception as e:
        logger.exception("[ChatRouter] SSE streaming error")
        if isinstance(e, HttpResponseError) and e.status_code == 429:
            yield f"data: {json.dumps({'error': {'code': 429, 'message': 'Rate limit exceeded. Please try again later.'}})}\n\n"
            return
        error_payload = {
            "error": {
                "message": "Streaming error occurred",
                "code": 500,
                "type": "server_error",
                "details": str(e)
            }
        }
        yield f"data: {json.dumps(error_payload)}\n\n"


@router.get("/sse")
async def chat_sse(
    request: Request,
    session_id: str,
    model: str,
    message: str,
    developer_config: Optional[str] = Query(default=""),
    reasoning_effort: str = "medium",
    db: AsyncSession = Depends(get_db_session),
):
    """
    Provides a Server-Sent Events (SSE) endpoint for streaming chat responses.

    - session_id: conversation session UUID (as a string)
    - model: which model to use
    - message: user prompt or message
    - developer_config: optional system message or instructions
    - reasoning_effort: relevant for O-series models
    """
    try:
        client_wrapper = await get_model_client_dependency(model)
        client = client_wrapper["client"]
        return StreamingResponse(
            generate_stream_chunks(
                message=message,
                client=client,
                model_name=model,
                developer_config=developer_config,
                reasoning_effort=reasoning_effort,
                db=db,
                session_id=session_id
            ),
            media_type="text/event-stream"
        )

    except Exception as e:
        logger.exception(f"/chat/sse streaming error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
