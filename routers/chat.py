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
from services.model_stats_service import ModelStatsService
from utils import handle_client_error, count_tokens
from azure.ai.inference import ChatCompletionsClient
from openai import AzureOpenAI

# By using prefix="/chat", all routes below will become "/chat/..."
# and with the main app including this router under "/api",
# the SSE endpoint becomes "/api/chat/sse"
router = APIRouter(prefix="/chat")


@router.post("/conversations/store")
async def store_message(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Store a single chat message in the database.
    Expects JSON with the following fields:
      - session_id (string UUID)
      - role (e.g. 'user', 'assistant')
      - content (the message content)
    """
    try:
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

        # Validate session_id format
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid session_id format: {session_id}"
            )

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
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error storing message: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations/history")
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


@router.get("/conversations/sessions")
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


@router.post("", response_model=None)
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
    expected_version = MODEL_API_VERSIONS.get(model_name, MODEL_API_VERSIONS.get("default"))
    logger.debug(f"Expected API version for model '{model_name}': {expected_version}")

    try:
        if not request.messages:
            raise HTTPException(
                status_code=400,
                detail="Missing required arguments; 'messages' is required"
            )

        if not request.model:
            request.model = AZURE_OPENAI_DEPLOYMENT_NAME
            logger.info(f"No model specified. Using default: {request.model}")

        logger.info(f"API request for model: {request.model}")

        try:
            client_wrapper = await get_model_client_dependency(request.model)
            client = client_wrapper.get("client")
            if not client:
                raise ValueError("Client initialization failed (client is None).")

            model_config = client_wrapper.get("model_config", {})
            model_type = model_config.get("model_type", "standard")

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

        # Model-specific validation
        if is_deepseek_model(request.model):
            request.max_tokens = request.max_completion_tokens or DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            if request.max_tokens > DEEPSEEK_R1_DEFAULT_MAX_TOKENS:
                raise HTTPException(400, 
                    f"max_tokens cannot exceed {DEEPSEEK_R1_DEFAULT_MAX_TOKENS} for DeepSeek models")
            if request.temperature is not None:
                raise HTTPException(400, "Temperature not supported for DeepSeek models")
            del request.max_completion_tokens  # Remove conflicting parameter
        
        elif is_o_series_model(request.model):
            request.max_completion_tokens = request.max_completion_tokens or O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
            if request.temperature is not None:
                raise HTTPException(400, "Temperature not supported for O-series models")

        response_data: Dict[str, Any] = {}

        # 1) If the client is an Inference Client and it's a DeepSeek model
        if is_inference_client:
            if deepseek_check or model_type == "deepseek":
                max_retries = 3
                retry_count = 0
                retry_delay = 2
                last_error = None

                while retry_count <= max_retries:
                    try:
                        # Non-streaming completion for DeepSeek
                        response = client.complete(
                            messages=messages,
                            max_tokens=DEEPSEEK_R1_DEFAULT_MAX_TOKENS, 
                            stream=False
                        )
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
                        is_timeout = False
                        if hasattr(e, "__cause__") and e.__cause__:
                            if "timeout" in str(e.__cause__).lower():
                                is_timeout = True
                        elif "timeout" in str(e).lower():
                            is_timeout = True
                        if is_timeout and retry_count <= max_retries:
                            logger.warning(
                                f"Timeout in DeepSeek request, retrying ({retry_count}/{max_retries})"
                            )
                            import asyncio
                            await asyncio.sleep(retry_delay)
                            retry_delay *= 2
                        else:
                            raise
                if retry_count > max_retries and last_error:
                    raise last_error
            elif is_o_series_model(request.model):
                # O-series model with reasoning effort
                logger.info(f"O-series model: {request.model}, reasoning={request.reasoning_effort}")
                if not hasattr(client, "chat"):
                    raise ValueError("Client does not support 'chat' attribute.")
                response = client.chat.completions.create(
                    model=request.model,
                    messages=messages,
                    reasoning_effort=request.reasoning_effort or "medium",
                    max_completion_tokens=max_tokens or 5000,
                    stream=False
                )
            else:
                # Standard Azure OpenAI usage
                if not hasattr(client, "chat"):
                    raise ValueError("Client does not support 'chat' attribute.")
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

        # Count tokens
        user_msg_content = request.messages[-1]["content"] if request.messages else ""
        prompt_tokens = count_tokens(user_msg_content, model_name)
        completion_tokens = count_tokens(full_content, model_name)
        total_tokens = prompt_tokens + completion_tokens

        # Count any chain-of-thought tokens if deepseek
        reasoning_tokens = 0
        if deepseek_check and "<think>" in full_content and "</think>" in full_content:
            think_matches = re.findall(r"<think>([\s\S]*?)<\/think>", full_content)
            for think_text in think_matches:
                reasoning_tokens += count_tokens(think_text, model_name)

        # Add usage to model stats
        stats_service = ModelStatsService(db)
        await stats_service.record_usage(
            model=model_name,
            session_id=request.session_id,
            usage={
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "completion_tokens_details": {
                    "reasoning_tokens": reasoning_tokens
                } if reasoning_tokens > 0 else {}
            }
        )

        # Update usage in the final response
        if "usage" not in response_data:
            response_data["usage"] = {}
        response_data["usage"]["prompt_tokens"] = prompt_tokens
        response_data["usage"]["completion_tokens"] = completion_tokens
        response_data["usage"]["total_tokens"] = total_tokens

        if reasoning_tokens > 0:
            if "completion_tokens_details" not in response_data["usage"]:
                response_data["usage"]["completion_tokens_details"] = {}
            response_data["usage"]["completion_tokens_details"]["reasoning_tokens"] = reasoning_tokens

        # Store user and assistant messages in DB
        user_msg = Conversation(
            session_id=request.session_id,
            role="user",
            content=user_msg_content,
            model=request.model,
        )
        assistant_msg = Conversation(
            session_id=request.session_id,
            role="assistant",
            content=full_content,
            formatted_content=formatted_content,
            model=request.model,
            raw_response={
                "streaming": False,
                "final_content": full_content,
                "token_usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "reasoning_tokens": reasoning_tokens if reasoning_tokens > 0 else None
                }
            },
        )

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
    Provides a Server-Sent Events (SSE) endpoint for streaming chat responses.

    - session_id: conversation session UUID (string)
    - model: which model to use
    - message: user prompt or message
    - reasoning_effort: relevant for O-series models
    """
    try:
        # If the model is DeepSeek, ignore any reasoning_effort
        if is_deepseek_model(model):
            reasoning_effort = ""

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

    except Exception as e:
        logger.exception(f"/chat/sse streaming error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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

    It conditionally adds the reasoning_effort parameter only for non-DeepSeek models.
    """
    if not client:
        raise ValueError("Client is None; cannot proceed with streaming.")

    is_inference_client = isinstance(client, ChatCompletionsClient)
    deepseek_check = is_deepseek_model(model_name)

    # Build base messages
    if is_o_series_model(model_name):
        # Prepend developer message with formatting instruction for o-series
        messages_list = [
            {"role": "developer", "content": "Formatting re-enabled - please use markdown formatting for code blocks and structured content."},
            {"role": "user", "content": message}
        ]
    else:
        messages_list = [{"role": "user", "content": message}]

    # Build default params
    params = {
        "messages": messages_list,
        "temperature": DEEPSEEK_R1_DEFAULT_TEMPERATURE if deepseek_check else 0.7,
        "max_tokens": (
            DEEPSEEK_R1_DEFAULT_MAX_TOKENS if deepseek_check
            else O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
        ),
        "stream": True
    }

    # Only add reasoning_effort if not DeepSeek
    if not deepseek_check and reasoning_effort:
        params["reasoning_effort"] = reasoning_effort

    full_content = ""
    heartbeat_interval = 30
    last_heartbeat = time.time()

    async def send_heartbeat():
        nonlocal last_heartbeat
        current_time = time.time()
        if current_time - last_heartbeat >= heartbeat_interval:
            last_heartbeat = current_time
            yield f"data: {json.dumps({'heartbeat': True})}\n\n"

    try:
        #
        # 1) Inference Client + DeepSeek
        #
        # Use the "complete(...stream=True)" method for DeepSeek streaming from azure-ai-inference.
        max_retries = 3
        retry_count = 0
        retry_delay = 2
        while retry_count <= max_retries:
            try:
                # Streamed completions for DeepSeek
                stream_response = client.complete(
                    messages=params["messages"],
                    max_tokens=params["max_tokens"],
                    stream=True
                )
                # Each item in stream_response is a partial update
                for partial in stream_response:
                    if hasattr(partial, "choices") and partial.choices:
                        choice = partial.choices[0]
                        if hasattr(choice.delta, "content"):
                            content = choice.delta.content or ""
                            full_content += content
                            yield f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"
                break
            except Exception as e:
                retry_count += 1
                if isinstance(e, HttpResponseError) and e.status_code == 429:
                    logger.warning(f"Rate limit exceeded (429). Retry {retry_count}/{max_retries}")
                    yield f"data: {json.dumps({'error': {'code': 429, 'message': 'Rate limit exceeded. Please try again later.'}})}\n\n"
                    if retry_count <= max_retries:
                        import asyncio
                        await asyncio.sleep(retry_delay * 2)
                        retry_delay *= 2
                        continue
                    else:
                        return
                is_timeout = False
                if hasattr(e, "__cause__") and e.__cause__ and "timeout" in str(e.__cause__).lower():
                    is_timeout = True
                elif "timeout" in str(e).lower():
                    is_timeout = True
                if is_timeout and retry_count <= max_retries:
                    logger.warning(f"Timeout error in DeepSeek streaming call, retrying ({retry_count}/{max_retries})")
                    yield f"data: {json.dumps({'choices': [{'delta': {'content': f'[Timeout, retry {retry_count}/{max_retries}]'}}]})}\n\n"
                    import asyncio
                    await asyncio.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    raise
        else:
            # Handle Azure OpenAI client streaming
            is_o_series = is_o_series_model(model_name)
            # For o-series, ensure developer message is first
            if is_o_series:
                params["messages"].insert(0, {
                    "role": "developer",
                    "content": "Formatting re-enabled - please use markdown formatting for code blocks and structured content."
                })
            
            stream = client.chat.completions.create(
                model=model_name,
                messages=params["messages"],
                max_completion_tokens=params.get("max_tokens", 5000) if is_o_series else None,
                max_tokens=params.get("max_tokens", 800) if not is_o_series else None,
                stream=True,
                headers={
                    "reasoning-effort": reasoning_effort,
                    "Formatting": "re-enabled"
                } if is_o_series else None,
            )
            
            async for chunk in stream:
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
                        "finish_reason": choice.finish_reason
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

        # After streaming completes, store the entire assistant message in DB
        if full_content:
            formatted_content = full_content
            if deepseek_check:
                think_regex = r"<think>([\s\S]*?)<\/think>"
                matches = re.findall(think_regex, full_content)
                for match in matches:
                    inner_text = match
                    thinking_html = (
                        f"""<div class="thinking-process">
                        <div class="thinking-header">
                            <button class="thinking-toggle" aria-expanded="true">
                                <span class="toggle-icon">▼</span> Thinking Process
                            </button>
                        </div>
                        <div class="thinking-content">
                            <pre class="thinking-pre">{inner_text}</pre>
                        </div>
                        </div>"""
                    )
                    formatted_content = formatted_content.replace(f"<think>{match}</think>", thinking_html, 1)

            # Token counting
            prompt_tokens = count_tokens(message, model_name)
            completion_tokens = count_tokens(full_content, model_name)
            total_tokens = prompt_tokens + completion_tokens
            reasoning_tokens = 0
            if deepseek_check and "<think>" in full_content and "</think>" in full_content:
                all_thinks = re.findall(r"<think>([\s\S]*?)<\/think>", full_content)
                for t in all_thinks:
                    reasoning_tokens += count_tokens(t, model_name)

            stats_service = ModelStatsService(db)
            # Validate session_id format before converting to UUID
            try:
                session_uuid = uuid.UUID(session_id)
            except ValueError:
                logger.error(f"Invalid session_id format: {session_id}")
                raise ValueError("session_id must be a valid UUID")

            await stats_service.record_usage(
                model=model_name,
                session_id=session_uuid,
                usage={
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "completion_tokens_details": {"reasoning_tokens": reasoning_tokens} if reasoning_tokens > 0 else {}
                }
            )

            usage_data = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens
            }
            if reasoning_tokens > 0:
                usage_data["completion_tokens_details"] = {"reasoning_tokens": reasoning_tokens}

            # Emit partial finish info
            yield f"data: {json.dumps({'choices': [{'finish_reason': 'stop', 'index': 0}], 'usage': usage_data})}\n\n"
            # Emit final "complete" event
            yield f"event: complete\ndata: {json.dumps({'usage': usage_data})}\n\n"

            # Store the conversation in DB
            await save_conversation(
                db_session=db,
                session_id=session_uuid,
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
