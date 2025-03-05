"""Routers for chat endpoints, providing storage, retrieval, and streaming completions."""

import json
import re
import time
import uuid
import asyncio
from typing import Optional, Dict, Any, Union
from uuid import UUID

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text, select, insert, delete, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession
from azure.core.exceptions import HttpResponseError
from azure.ai.inference import ChatCompletionsClient
from openai import AzureOpenAI

# Local modules
from logging_config import logger
from database import get_db_session
from clients import get_model_client_dependency
from pydantic_models import CreateChatCompletionRequest
from models import Conversation, User
from routers.security import get_current_user
from services.config_service import ConfigService, get_config_service
from services.chat_service import save_conversation
from services.model_stats_service import ModelStatsService
from utils import handle_client_error, count_tokens

# Constants
DEEPSEEK_R1_DEFAULT_MAX_TOKENS = 4096
DEEPSEEK_R1_DEFAULT_TEMPERATURE = 0.0
O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS = 40000
MODEL_API_VERSIONS = {"default": "2024-05-01-preview"}
AZURE_OPENAI_DEPLOYMENT_NAME = "o1"

router = APIRouter(prefix="/chat")


###############################################################################
#                              HELPER LOGIC                                   #
###############################################################################


def is_o_series_model(name: str) -> bool:
    """Check if model name is 'o1' or starts with 'o-series'."""
    return name.startswith("o-series") or name == "o1"


def is_deepseek_model(name: str) -> bool:
    """Check if model name starts with 'deepseek-'."""
    return name.startswith("deepseek-")


def expand_chain_of_thought(full_content: str) -> str:
    """
    Replace <think>...</think> blocks with HTML expansions for chain-of-thought,
    typically used by DeepSeek models.
    """
    if not full_content:
        return full_content
    think_regex = r"<think>([\s\S]*?)<\/think>"
    matches = re.findall(think_regex, full_content)
    formatted = full_content
    for match in matches:
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
        formatted = formatted.replace(
            f"<think>{match}</think>", thinking_html, 1
        )
    return formatted


async def check_concurrency_limit(db: AsyncSession, limit: int = 10) -> None:
    """
    Check the number of active SSE connections using pg_stat_activity.
    Raises HTTP 429 if at or above the limit.

    NOTE: This approach requires DB permissions to read pg_stat_activity
    and might not perfectly reflect 'active' SSE sessions. A more robust
    approach is to use an in-memory semaphore or similar concurrency limiter.
    """
    result = await db.execute(
        text(
            "SELECT COUNT(*) FROM pg_stat_activity "
            "WHERE query LIKE '%/api/chat/sse%' AND state = 'active'"
        )
    )
    active_connections = result.scalar()
    if active_connections and active_connections >= limit:
        raise HTTPException(
            status_code=429,
            detail="Too many concurrent streaming connections. Please try again later.",
        )


###############################################################################
#                         ROUTES: CONVERSATION STORAGE                        #
###############################################################################


@router.post("/conversations/store")
async def store_message(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Store a single chat message in the database. Expects JSON with:
      - session_id (string UUID)
      - role (e.g. 'user', 'assistant')
      - content (message content)
    """
    try:
        await check_concurrency_limit(db, limit=10)

        body = await request.json()
        if not body:
            raise HTTPException(status_code=400, detail="Invalid or missing JSON body")

        session_id = body.get("session_id")
        role = body.get("role")
        content = body.get("content")

        if not session_id:
            raise HTTPException(status_code=400, detail="Missing session_id parameter")
        if not role:
            raise HTTPException(status_code=400, detail="Missing role parameter")
        if not content:
            raise HTTPException(status_code=400, detail="Missing content parameter")

        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid session_id format: {session_id}"
            ) from exc

        values = {
            "session_id": session_uuid,
            "role": role,
            "content": content
        }
        if current_user:
            values["user_id"] = current_user.id

        stmt = insert(Conversation).values(**values)
        await db.execute(stmt)
        await db.commit()
        return {"status": "success"}

    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error storing message: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/conversations/history")
async def get_conversation_history(
    session_id: UUID = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Returns messages for a session in ascending order.

    - session_id: UUID of the conversation session
    - offset: pagination offset
    - limit: pagination limit
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
                    "content": msg.formatted_content or msg.content,
                    "raw_content": msg.content,
                    "timestamp": (
                        msg.timestamp.isoformat() if msg.timestamp else None
                    ),
                }
                for msg in messages
            ],
            "offset": offset,
            "limit": limit,
            "returned_count": len(messages),
            "has_more": (len(messages) == limit),
        }

    except Exception as exc:
        logger.exception("Error retrieving conversation history: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/conversations/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Returns a list of distinct session_ids in the conversations table,
    and how many messages each session has.
    """
    try:
        stmt = select(
            Conversation.session_id,
            sa_func.count(Conversation.id).label("message_count")
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
    except Exception as exc:
        logger.exception("Error listing conversation sessions: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/conversations/clear")
async def clear_db_conversation(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user)
):
    """
    Deletes all messages for a given session_id from the DB.
    """
    try:
        body = await request.json()
        session_id = body.get("session_id")
        if not session_id:
            raise HTTPException(status_code=400, detail="Missing session_id")

        # Validate UUID
        session_uuid = uuid.UUID(session_id)

        # Delete conversation rows
        await db.execute(delete(Conversation).where(Conversation.session_id == session_uuid))
        await db.commit()

        return {"status": "cleared"}
    except Exception as exc:
        logger.exception("Error clearing conversation: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

###############################################################################
#                         ROUTE: NON-STREAM COMPLETION                        #
###############################################################################


@router.post("", response_model=None)
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
    config_service: ConfigService = Depends(get_config_service),
):
    """
    Creates a single chat completion in a non-streaming manner.
    Returns an Azure-like ChatCompletionResponse JSON.

    Supports:
     - DeepSeek models (azure-ai-inference)
     - O-series (custom reasoning_effort)
     - Standard Azure OpenAI usage
    """
    try:
        if not request.messages:
            raise HTTPException(
                status_code=400,
                detail="Missing 'messages' field in request"
            )

        model_name = request.model or AZURE_OPENAI_DEPLOYMENT_NAME
        logger.info("API request for model: %s", model_name)

        # Get model client
        try:
            client_wrapper = await get_model_client_dependency(model_name)
            client = client_wrapper.get("client")
            if not client:
                raise ValueError("Client initialization failed (client is None).")
            model_config = client_wrapper.get("model_config", {})
            model_type = model_config.get("model_type", "standard")
        except Exception as exc:
            logger.error("Error getting model client: %s", exc)
            raise HTTPException(
                status_code=500,
                detail={
                    "error": {
                        "code": "model_unavailable",
                        "message": f"Could not initialize model {model_name}",
                        "type": "service_error",
                    }
                },
            ) from exc

        # Validate O-series constraints
        if is_o_series_model(model_name):
            # Per o1models-reference-guide.md, convert any 'system' role to 'developer'
            # so that the model sees it as a developer message for reasoning.
            for msg in request.messages:
                if msg.get("role") == "system":
                    msg["role"] = "developer"

            if request.temperature is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Temperature not supported for O-series models"
                )
            if not request.reasoning_effort:
                request.reasoning_effort = "medium"
            elif request.reasoning_effort not in ("low", "medium", "high"):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid reasoning_effort for O-series model"
                )
            if not request.max_completion_tokens:
                request.max_completion_tokens = O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS

        # Validate DeepSeek constraints
        if is_deepseek_model(model_name):
            if request.temperature is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Temperature not supported for DeepSeek models"
                )
            if (request.max_completion_tokens
                    and request.max_completion_tokens > DEEPSEEK_R1_DEFAULT_MAX_TOKENS):
                raise HTTPException(
                    status_code=400,
                    detail=("max_tokens cannot exceed "
                            f"{DEEPSEEK_R1_DEFAULT_MAX_TOKENS} for DeepSeek models")
                )
            if not request.max_completion_tokens:
                request.max_completion_tokens = DEEPSEEK_R1_DEFAULT_MAX_TOKENS

        # Standard fallback if user gave no max tokens
        if (not is_o_series_model(model_name) and not is_deepseek_model(model_name)
                and not request.max_completion_tokens):
            request.max_completion_tokens = 5000

        response_data: Dict[str, Any] = {}
        is_inference_client = isinstance(client, ChatCompletionsClient) or isinstance(client, AzureOpenAI)
        deepseek_check = is_deepseek_model(model_name)

        # ------------------- Non-streaming logic ----------------------------
        if is_inference_client and (deepseek_check or model_type == "deepseek"):
            # DeepSeek path with retry
            max_retries = 3
            retry_count = 0
            retry_delay = 2
            last_error = None
            while retry_count <= max_retries:
                try:
                    if isinstance(client, ChatCompletionsClient):
                        response = client.complete(
                            messages=request.messages,
                            max_tokens=request.max_completion_tokens,
                            stream=False
                        )
                    elif isinstance(client, AzureOpenAI):
                        response = client.chat.completions.create(
                            model=model_name,
                            messages=request.messages,
                            max_completion_tokens=request.max_completion_tokens,
                            stream=False
                        )
                    else:
                        raise ValueError("Unsupported DeepSeek client type")

                    usage_data = {}
                    if response.usage:
                        usage_data = {
                            "prompt_tokens": response.usage.prompt_tokens,
                            "completion_tokens": response.usage.completion_tokens,
                            "total_tokens": response.usage.total_tokens
                        }
                    content = response.choices[0].message.content or ""
                    response_data = {
                        "id": f"chatcmpl-{uuid.uuid4()}",
                        "object": "chat.completion",
                        "created": int(time.time()),
                        "model": model_name,
                        "choices": [
                            {
                                "index": 0,
                                "message": {
                                    "role": "assistant",
                                    "content": content,
                                },
                                "finish_reason": response.choices[0].finish_reason,
                            }
                        ],
                        "usage": usage_data,
                    }
                    break
                except Exception as exc:
                    retry_count += 1
                    last_error = exc
                    is_timeout = False
                    if (isinstance(exc, HttpResponseError)
                            and exc.status_code in (403, 429, 500, 503)):
                        logger.warning(
                            "Server error (%s). Retry %d/%d",
                            exc.status_code,
                            retry_count,
                            max_retries
                        )
                        if retry_count <= max_retries:
                            await asyncio.sleep(retry_delay * 2)
                            retry_delay *= 2
                            continue
                        else:
                            raise HTTPException(
                                status_code=exc.status_code,
                                detail="Max retries exhausted."
                            ) from exc

                    if "timeout" in str(exc).lower():
                        is_timeout = True

                    if is_timeout and retry_count <= max_retries:
                        logger.warning(
                            "Timeout in DeepSeek request, retrying (%d/%d)",
                            retry_count, max_retries
                        )
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2
                    else:
                        raise

            if retry_count > max_retries and last_error:
                raise HTTPException(
                    status_code=500,
                    detail=f"DeepSeek call failed: {str(last_error)}"
                ) from last_error

        elif is_inference_client and is_o_series_model(model_name):
            if isinstance(client, ChatCompletionsClient):
                response = client.complete(
                    messages=request.messages,
                    max_tokens=request.max_completion_tokens,
                    stream=False
                )
                # Convert to an Azure-like response
                usage_data = {}
                if response.usage:
                    usage_data = {
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                        "total_tokens": response.usage.total_tokens
                    }
                response_data = {
                    "id": f"chatcmpl-{uuid.uuid4()}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": response.choices[0].message.content,
                            },
                            "finish_reason": response.choices[0].finish_reason,
                        }
                    ],
                    "usage": usage_data,
                }
            else:
                if not hasattr(client, "chat"):
                    raise ValueError("Client does not support 'chat' attribute.")
                response = client.chat.completions.create(
                    model=model_name,
                    messages=request.messages,
                    reasoning_effort=request.reasoning_effort or "medium",
                    max_completion_tokens=request.max_completion_tokens,
                    stream=False
                )
                response_data = response.model_dump()

        elif is_inference_client:
            if isinstance(client, ChatCompletionsClient):
                response = client.complete(
                    messages=request.messages,
                    max_tokens=request.max_completion_tokens,
                    stream=False
                )
                # Convert to an Azure-like response
                usage_data = {}
                if response.usage:
                    usage_data = {
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                        "total_tokens": response.usage.total_tokens
                    }
                response_data = {
                    "id": f"chatcmpl-{uuid.uuid4()}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": response.choices[0].message.content,
                            },
                            "finish_reason": response.choices[0].finish_reason,
                        }
                    ],
                    "usage": usage_data,
                }
            else:
                if not hasattr(client, "chat"):
                    raise ValueError("Client does not support 'chat' attribute.")
                response = client.chat.completions.create(
                    model=model_name,
                    messages=request.messages,
                    max_completion_tokens=request.max_completion_tokens,
                    temperature=request.temperature,
                    stream=False
                )
                response_data = response.model_dump()
        else:
            raise HTTPException(
                status_code=500,
                detail="Unsupported client type for non-streaming completion"
            )

        # ------------------- Post-processing & DB Storage -------------------
        full_content = response_data["choices"][0]["message"]["content"]
        formatted_content = full_content  # Let the client handle chain-of-thought

        # Just count the last user message
        user_msg_content = request.messages[-1]["content"]
        prompt_tokens = count_tokens(user_msg_content, model_name)
        completion_tokens = count_tokens(full_content, model_name)
        total_tokens = prompt_tokens + completion_tokens
        reasoning_tokens = 0
        if deepseek_check and "<think>" in full_content:
            think_blocks = re.findall(r"<think>([\s\S]*?)<\/think>", full_content)
            for block in think_blocks:
                reasoning_tokens += count_tokens(block, model_name)

        usage_block = response_data.get("usage", {})
        usage_block["prompt_tokens"] = usage_block.get("prompt_tokens", prompt_tokens)
        usage_block["completion_tokens"] = usage_block.get(
            "completion_tokens", completion_tokens
        )
        usage_block["total_tokens"] = usage_block.get("total_tokens", total_tokens)
        if reasoning_tokens > 0:
            details = usage_block.setdefault("completion_tokens_details", {})
            details["reasoning_tokens"] = reasoning_tokens
        response_data["usage"] = usage_block

        # Record usage
        stats_service = ModelStatsService(db)
        await stats_service.record_usage(
            model=model_name,
            session_id=request.session_id,
            usage={
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "completion_tokens_details": (
                    {"reasoning_tokens": reasoning_tokens}
                    if reasoning_tokens > 0
                    else {}
                ),
            },
        )

        # Store conversation in DB
        user_msg = Conversation(
            session_id=request.session_id,
            role="user",
            content=user_msg_content,
            model=model_name,
        )
        assistant_msg = Conversation(
            session_id=request.session_id,
            role="assistant",
            content=full_content,
            formatted_content=formatted_content,
            model=model_name,
            raw_response={
                "streaming": False,
                "final_content": full_content,
                "token_usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "reasoning_tokens": reasoning_tokens if reasoning_tokens > 0 else None,
                },
            },
        )
        db.add(user_msg)
        db.add(assistant_msg)
        await db.commit()

        return response_data

    except HTTPException as exc:
        raise exc
    except Exception as exc:
        error_detail = handle_client_error(exc)
        logger.exception("Error creating chat completion: %s", exc)
        if "Forbidden" in str(error_detail["message"]):
            raise HTTPException(
                status_code=403,
                detail="Your Azure OpenAI resource is temporarily blocked by their content policy. Please contact Azure support or review your content usage."
            ) from exc
        else:
            raise HTTPException(
                status_code=error_detail["status_code"],
                detail=error_detail["message"]
            ) from exc


###############################################################################
#                       ROUTE: STREAMING SSE COMPLETION                       #
###############################################################################


@router.get("/sse")
async def chat_sse(
    request: Request,
    session_id: str,
    model: str,
    message: str,
    reasoning_effort: str = "medium",
    db: AsyncSession = Depends(get_db_session),
):
    """
    SSE endpoint for streaming chat responses.

    - session_id: conversation session UUID (string)
    - model: which model to use
    - message: user prompt
    - reasoning_effort: used by O-series models
    """
    try:
        await check_concurrency_limit(db, limit=10)

        if is_deepseek_model(model):
            reasoning_effort = ""  # Not applicable

        client_wrapper = await get_model_client_dependency(model)
        client = client_wrapper["client"]
        if not client:
            raise ValueError("Client initialization failed (client is None).")

        return StreamingResponse(
            generate_stream_chunks(
                message=message,
                client=client,
                model_name=model,
                reasoning_effort=reasoning_effort,
                db=db,
                session_id=session_id
            ),
            media_type="text/event-stream"
        )

    except Exception as exc:
        logger.exception("/chat/sse streaming error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


async def generate_stream_chunks(
    message: str,
    client: Union[AzureOpenAI, ChatCompletionsClient],
    model_name: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str
):
    """
    Async generator that yields SSE data chunks from streaming responses.
    Conditionally includes reasoning_effort for O-series models only.
    """
    if not client:
        raise ValueError("Client is None; cannot proceed with streaming.")

    deepseek_check = is_deepseek_model(model_name)
    is_o_series = is_o_series_model(model_name)
    is_inference_client = isinstance(client, ChatCompletionsClient)

    # Build base messages
    messages_list = []
    if is_o_series:
        messages_list.append({
            "role": "developer",
            "content": "Formatting re-enabled - please use markdown formatting for code blocks."
        })
    messages_list.append({"role": "user", "content": message})

    max_tokens = (
        DEEPSEEK_R1_DEFAULT_MAX_TOKENS if deepseek_check
        else (O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS if is_o_series else 5000)
    )
    temperature = DEEPSEEK_R1_DEFAULT_TEMPERATURE if deepseek_check else 0.7

    full_content = ""

    async def stream_deepseek():
        """
        Specialized streaming logic for DeepSeek (azure-ai-inference),
        including retries for timeouts or server errors.
        """
        nonlocal full_content
        max_retries = 3
        retry_count = 0
        retry_delay = 2

        while retry_count <= max_retries:
            try:
                if isinstance(client, ChatCompletionsClient):
                    stream_response = client.complete(
                        messages=messages_list,
                        max_tokens=max_tokens,
                        stream=True
                    )
                elif isinstance(client, AzureOpenAI):
                    stream_response = client.chat.completions.create(
                        model=model_name,
                        messages=messages_list,
                        max_completion_tokens=max_tokens,
                        stream=True
                    )
                else:
                    raise ValueError("Unsupported DeepSeek client type")

                for partial in stream_response:
                    if hasattr(partial, "choices") and partial.choices:
                        choice = partial.choices[0]
                        content = getattr(choice.delta, "content", "") or ""
                        full_content += content
                        yield ("data: " + json.dumps(
                            {"choices": [{"delta": {"content": content}}]}
                        ) + "\n\n")
                break
            except HttpResponseError as hrex:
                # Only handle known HTTP errors
                retry_count += 1
                if hrex.status_code in (429, 500, 503) and retry_count <= max_retries:
                    logger.warning(
                        "Server error (%s). Retry %d/%d",
                        hrex.status_code,
                        retry_count,
                        max_retries
                    )
                    yield ("data: " + json.dumps({
                        "error": {
                            "code": hrex.status_code,
                            "message": "Temporary server error. Retrying..."
                        }
                    }) + "\n\n")
                    await asyncio.sleep(retry_delay * 2)
                    retry_delay *= 2
                    continue
                raise HTTPException(
                    status_code=hrex.status_code,
                    detail="DeepSeek streaming failed."
                ) from hrex
            except Exception as exc:
                retry_count += 1
                exc_str = str(exc).lower()
                if "timeout" in exc_str and retry_count <= max_retries:
                    logger.warning(
                        "Timeout in DeepSeek streaming, retry %d/%d",
                        retry_count,
                        max_retries
                    )
                    yield ("data: " + json.dumps({
                        "choices": [{
                            "delta": {
                                "content": (f"[Timeout, retry {retry_count}/{max_retries}]")
                            }
                        }]}
                    ) + "\n\n")
                    await asyncio.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    error_payload = {
                        "error": {
                            "message": "Streaming error occurred",
                            "code": 500,
                            "type": "server_error",
                            "details": str(exc)
                        }
                    }
                    yield "data: " + json.dumps(error_payload) + "\n\n"
                    return

    async def stream_azure_openai():
        """
        Standard AzureOpenAI streaming (or O-series).
        """
        nonlocal full_content
        if not hasattr(client, "chat"):
            raise ValueError("Client does not support 'chat' attribute.")

        extra_kwargs = {}
        if is_o_series:
            if reasoning_effort:
                extra_kwargs["reasoning_effort"] = reasoning_effort
            if max_tokens:
                extra_kwargs["max_completion_tokens"] = max_tokens
        else:
            if max_tokens:
                extra_kwargs["max_tokens"] = max_tokens
            if temperature is not None:
                extra_kwargs["temperature"] = temperature

        stream = client.chat.completions.create(
            model=model_name,
            messages=messages_list,
            stream=True,
            **extra_kwargs
        )

        async for chunk in stream:
            resp_data = {
                "id": f"chatcmpl-{uuid.uuid4()}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model_name,
                "choices": []
            }
            chunk_choices = []
            for idx, choice in enumerate(chunk.choices):
                delta_content = choice.delta.content or ""
                full_content += delta_content
                partial = {
                    "index": idx,
                    "delta": {
                        "role": getattr(choice.delta, "role", None),
                        "content": delta_content,
                        "tool_calls": getattr(choice.delta, "tool_calls", None)
                    },
                    "finish_reason": choice.finish_reason
                }
                chunk_choices.append(partial)
            resp_data["choices"] = chunk_choices
            yield "data: " + json.dumps(resp_data) + "\n\n"

    try:
        if deepseek_check and is_inference_client:
            async for chunk in stream_deepseek():
                yield chunk
        else:
            # O-series or normal AzureOpenAI
            async for chunk in stream_azure_openai():
                yield chunk

        # ------------------- Post-stream usage & DB store -------------------
        if full_content:
            formatted_content = full_content

            # Token counting
            prompt_tokens = count_tokens(message, model_name)
            completion_tokens = count_tokens(full_content, model_name)
            total_tokens = prompt_tokens + completion_tokens
            reasoning_tokens = 0
            if deepseek_check and "<think>" in full_content:
                thinks = re.findall(r"<think>([\s\S]*?)<\/think>", full_content)
                for tblock in thinks:
                    reasoning_tokens += count_tokens(tblock, model_name)

            usage_data = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens
            }
            if reasoning_tokens > 0:
                usage_data["completion_tokens_details"] = {
                    "reasoning_tokens": reasoning_tokens
                }

            finish_payload = {
                "choices": [{"finish_reason": "stop", "index": 0}],
                "usage": usage_data
            }
            yield "data: " + json.dumps(finish_payload) + "\n\n"

            complete_event = {"usage": usage_data}
            yield "event: complete\ndata: " + json.dumps(complete_event) + "\n\n"

            stats_service = ModelStatsService(db)
            try:
                session_uuid = uuid.UUID(session_id)
            except ValueError as exc:
                logger.error("Invalid session_id format: %s", session_id)
                raise ValueError("session_id must be a valid UUID") from exc

            await stats_service.record_usage(
                model=model_name,
                session_id=session_uuid,
                usage={
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "completion_tokens_details": (
                        {"reasoning_tokens": reasoning_tokens}
                        if reasoning_tokens > 0
                        else {}
                    ),
                }
            )

            # Store conversation in DB
            await save_conversation(
                db_session=db,
                session_id=session_uuid,
                model_name=model_name,
                user_text=message,
                assistant_text=full_content,
                formatted_assistant_text=formatted_content,
                raw_response=None
            )

    except HttpResponseError as http_err:
        if http_err.status_code == 429:
            yield ("data: " + json.dumps({
                "error": {
                    "code": 429,
                    "message": "Rate limit exceeded. Please try again later."
                }
            }) + "\n\n")
        else:
            error_payload = {
                "error": {
                    "message": "Streaming error occurred",
                    "code": http_err.status_code,
                    "type": "server_error",
                    "details": str(http_err)
                }
            }
            yield "data: " + json.dumps(error_payload) + "\n\n"

    except Exception as exc:  # broad catch
        logger.exception("[ChatRouter] SSE streaming error: %s", exc)
        error_payload = {
            "error": {
                "message": "Streaming error occurred",
                "code": 500,
                "type": "server_error",
                "details": str(exc)
            }
        }
        yield "data: " + json.dumps(error_payload) + "\n\n"
