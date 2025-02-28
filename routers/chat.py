import json
import uuid
import time
from typing import Optional, List, Dict, Any, Union
from uuid import UUID

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func, insert
from azure.core.exceptions import HttpResponseError

from database import get_db_session, AsyncSessionLocal  # Corrected import
from clients import get_model_client_dependency
from config import (
    DEEPSEEK_R1_DEFAULT_API_VERSION,
    DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
    DEEPSEEK_R1_DEFAULT_TEMPERATURE,
)
from logging_config import logger
import config

# Import models and schemas that define request/response shapes
from pydantic_models import (
    ChatMessage,
    ChatCompletionResponse,
    CreateChatCompletionRequest,
)
from models import Conversation
from pydantic_models import ModelCapabilities, ModelCapabilitiesResponse
from openai import AzureOpenAI
from azure.ai.inference import ChatCompletionsClient
from routers.security import get_current_user
from models import User
from services.config_service import ConfigService, get_config_service
from services.chat_service import process_chat_message, save_conversation
from utils import handle_client_error

router = APIRouter(prefix="/chat")


@router.post("/conversations/store")
async def store_message(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Store a chat message in the database.
    
    This endpoint supports two methods of passing parameters:
    1. As JSON body (preferred)
    2. As query parameters (backward compatibility)
    """
    try:
        # First try to get parameters from JSON body
        try:
            body = await request.json()
            session_id = body.get("session_id")
            role = body.get("role")
            content = body.get("content")
        except:
            # Fallback to query parameters
            session_id = request.query_params.get("session_id")
            role = request.query_params.get("role")
            content = request.query_params.get("content")
        
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
            raise HTTPException(status_code=400, detail=f"Invalid session_id format: {session_id}")

        # Prepare values for insertion
        values = {"session_id": session_uuid, "role": role, "content": content}

        # Add user_id if authenticated
        if current_user:
            values["user_id"] = current_user.id

        # Insert into database
        stmt = insert(Conversation).values(**values)
        await db.execute(stmt)
        await db.commit()
        
        return {"status": "success"}
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        await db.rollback()
        logger.exception(f"Error storing message: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/conversations/history")
async def get_conversation_history(
    session_id: UUID = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Returns messages for a specified session in ascending order.
    Allows pagination via offset & limit.
    Uses formatted_content when available for display purposes.
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
                    # Use formatted_content if available, otherwise fall back to content
                    "content": (
                        msg.formatted_content if msg.formatted_content else msg.content
                    ),
                    "raw_content": msg.content,  # Original unformatted content
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/conversations/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db_session)):
    """
    Returns a list of distinct session_ids in the conversations table,
    along with how many messages each session has.
    Useful for listing conversation histories in the UI.
    """
    try:
        stmt = select(
            Conversation.session_id, func.count(Conversation.id).label("message_count")
        ).group_by(Conversation.session_id)

        result = await db.execute(stmt)
        rows = result.all()
        return [
            {"session_id": str(row.session_id), "message_count": row.message_count}
            for row in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=None)
async def create_chat_completion(
    request: CreateChatCompletionRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
    config_service: "ConfigService" = Depends(get_config_service),
):
    """
    Creates a single chat completion in a non-streaming (standard) manner,
    returning a ChatCompletionResponse following Azure OpenAI style.
    """
    try:
        # Ensure we have the required fields
        if not request.messages:
            raise HTTPException(
                status_code=400,
                detail="Missing required arguments; 'messages' field is required",
            )

        if not request.model:
            request.model = config.AZURE_OPENAI_DEPLOYMENT_NAME
            logger.info(f"Using default model: {request.model}")

        logger.info(f"API request for model: {request.model}")

        # Get the client from the dependency wrapper 
        try:
            client_wrapper = await get_model_client_dependency(request.model)
            client = client_wrapper.get("client")
            
            # Check if we need to update the model name based on the client
            if (
                isinstance(client, ChatCompletionsClient)
                and hasattr(client, "azure_deployment")
                and client.azure_deployment != request.model
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
                        "message": f"Could not initialize model {request.model} or any fallback models",
                        "type": "service_error",
                    }
                },
            )

        # Prepare parameters based on client type and model
        messages = request.messages
        temperature = request.temperature
        max_tokens = request.max_completion_tokens

        # Determine client type
        is_inference_client = isinstance(client, ChatCompletionsClient)
        is_deepseek = config.is_deepseek_model(request.model)

        # Prepare parameters based on client type and model
        params = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        if is_inference_client:
            # Add necessary parameters for DeepSeek
            if is_deepseek:
                params["temperature"] = DEEPSEEK_R1_DEFAULT_TEMPERATURE
                params["max_tokens"] = DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            else:
                raise ValueError(
                    "Unsupported model for inference client: " + request.model
                )
        else:
            # Azure OpenAI client
            if not is_deepseek:
                params["reasoning_effort"] = request.reasoning_effort

        # Call the appropriate client method
        if is_inference_client:
            response = client.complete(
                model=request.model,
                messages=params["messages"],
                temperature=params.get("temperature"),
                max_tokens=params.get("max_tokens"),
                stream=False,
            )

            # Convert to standard format
            usage_data = {
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": (
                    response.usage.completion_tokens if response.usage else 0
                ),
                "total_tokens": response.usage.total_tokens if response.usage else 0,
            }

            response_data = {
                "id": f"chatcmpl-{uuid.uuid4()}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": request.model,
                "choices": [
                    {
                        "index": 0,  # Add the required index field
                        "message": {
                            "role": "assistant",
                            "content": response.choices[0].message.content or "",
                        },
                        "finish_reason": response.choices[0].finish_reason,
                    }
                ],
                "usage": usage_data,
            }
        else:
            # Conditionally pass "reasoning_effort" if not a DeepSeek model (i.e., O-series or standard)
            if is_deepseek:
                # DeepSeek model uses temperature and max_tokens
                response = client.chat.completions.create(
                    model=request.model,
                    messages=params["messages"],
                    temperature=params.get("temperature"),
                    max_tokens=params.get("max_tokens"),
                    stream=False,
                )
            else:
                # O-series or standard Azure OpenAI model can use reasoning_effort, and uses max_completion_tokens instead of max_tokens
                response = client.chat.completions.create(
                    model=request.model,
                    messages=params["messages"],
                    reasoning_effort=params.get("reasoning_effort", "medium"),
                    max_completion_tokens=params.get("max_tokens"),
                    stream=False,
                )
            response_data = response.model_dump()

        # Store the content in the database
        full_content = response_data["choices"][0]["message"]["content"]

        # Process and format content for display
        formatted_content = full_content

        # Replace the existing regex pattern with this simpler one that matches <think> tags
        if is_deepseek and full_content:
            import re

            # Use this simpler regex pattern for <think> tags
            thinkRegex = r"<think>([\s\S]*?)<\/think>"

            matches = re.findall(thinkRegex, full_content)

            # Apply formatting to each thinking block
            for i, match in enumerate(matches):
                thinking_html = f"""<div class="thinking-process">
                <div class="thinking-header">
                    <button class="thinking-toggle" aria-expanded="true">
                    <span class="toggle-icon">▼</span> Thinking Process
                    </button>
                </div>
                <div class="thinking-content">
                    <pre class="thinking-pre">{match}</pre>
                </div>
                </div>"""

                # Replace the original thinking tags with formatted HTML
                formatted_content = formatted_content.replace(
                    f"<think>{match}</think>", thinking_html, 1
                )

        # Create user message
        user_msg = Conversation(
            session_id=request.session_id,
            role="user",
            content=request.messages[-1]["content"],
            model=request.model,
        )

        # Create assistant message with formatted content and raw response
        assistant_msg = Conversation(
            session_id=request.session_id,
            role="assistant",
            content=full_content,
            formatted_content=formatted_content,
            model=request.model,
            raw_response={"streaming": False, "final_content": full_content},
        )

        # Store messages in database
        db.add(user_msg)
        db.add(assistant_msg)
        await db.commit()

        return response_data

    except HTTPException:
        # Re-raise known HTTPExceptions
        raise

    except Exception as e:
        error_detail = handle_client_error(e)
        raise HTTPException(
            status_code=error_detail["status_code"], detail=error_detail["message"]
        )


async def generate_stream_chunks(
    message: str,
    client: Union["AzureOpenAI", "ChatCompletionsClient"],
    model_name: str,
    developer_config: str,
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str,
):
    """
    Async generator that yields SSE data chunks from streaming responses,
    including optional developer_config as a system message if provided.
    Handles both AzureOpenAI and ChatCompletionsClient.
    """
    # Prepare parameters based on client type and model
    is_inference_client = isinstance(client, ChatCompletionsClient)
    is_deepseek = model_name.lower().startswith("deepseek")

    # If developer_config is provided, treat it as a system message
    messages_list = []
    if developer_config:
        messages_list.append({"role": "system", "content": developer_config})

    # Then add the user message
    messages_list.append({"role": "user", "content": message})

    # Prepare parameters based on client type and model
    params = {
        "messages": messages_list,  # Use full messages list with system message if provided
        "temperature": config.DEEPSEEK_R1_DEFAULT_TEMPERATURE if is_deepseek else 0.7,
        "max_tokens": (
            config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            if is_deepseek
            else config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
        ),
    }

    # Handle reasoning effort for o-series models
    if not is_deepseek and reasoning_effort:
        params["reasoning_effort"] = reasoning_effort
        
    # Special handling for DeepSeek to enable thinking blocks
    if is_deepseek:
        # DeepSeek-specific parameters for thinking
        params["enable_thinking"] = True
        params["stream"] = True

    full_content = ""

    try:
        if is_inference_client and is_deepseek:
            # Enhanced DeepSeek-R1 streaming with proper handling of thinking blocks
            stream = client.chat_completions.create(
                **params,
                deployment=model_name,
                stream=True,
            )
            
            async for chunk in stream:
                try:
                    if hasattr(chunk.choices[0].delta, "content") and chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_content += content
                        yield f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"
                except Exception as chunk_error:
                    logger.warning(f"Error processing DeepSeek chunk: {str(chunk_error)}")
                    # Still yield a partial chunk if possible to avoid breaking the stream
                    if hasattr(chunk, 'choices') and chunk.choices:
                        yield f"data: {json.dumps({'choices': [{'delta': {'content': ''}}]})}\n\n"

        else:
            # Stream with OpenAI client
            params["stream"] = True
            response = client.chat.completions.create(**params)

            full_content = ""

            async for chunk in response:
                response_data = {
                    "id": f"chatcmpl-{uuid.uuid4()}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": [],
                }

                chunk_choices = []
                for idx, choice in enumerate(chunk.choices):
                    partial = {
                        "index": idx,
                        "delta": {},
                        "finish_reason": choice.finish_reason,
                    }

                    # Fix bug: hasattr() only takes 2 arguments, not 3
                    if hasattr(choice.delta, "content"):
                        content_part = choice.delta.content or ""
                        full_content += content_part
                        partial["delta"]["content"] = content_part

                    if hasattr(choice.delta, "role"):
                        partial["delta"]["role"] = choice.delta.role

                    # Fix bug: hasattr() only takes 2 arguments, not 3
                    if hasattr(choice.delta, "tool_calls"):
                        partial["delta"]["tool_calls"] = choice.delta.tool_calls
                    if hasattr(chunk, "content_filter_results"):
                        partial["delta"][
                            "content_filter_results"
                        ] = chunk.content_filter_results

                    chunk_choices.append(partial)

                response_data["choices"] = chunk_choices
                yield f"data: {json.dumps(response_data)}\n\n"

        # After streaming completes, store the full content in the database
        if full_content:
            # Process and format content for display
            formatted_content = full_content

            # Replace the existing regex pattern with this simpler one that matches <think> tags
            if is_deepseek and full_content:
                import re

                # Use this simpler regex pattern for <think> tags
                thinkRegex = r"<think>([\s\S]*?)<\/think>"

                matches = re.findall(thinkRegex, full_content)

                # Apply formatting to each thinking block
                for i, match in enumerate(matches):
                    thinking_html = f"""<div class="thinking-process">
                    <div class="thinking-header">
                        <button class="thinking-toggle" aria-expanded="true">
                        <span class="toggle-icon">▼</span> Thinking Process
                        </button>
                    </div>
                    <div class="thinking-content">
                        <pre class="thinking-pre">{match}</pre>
                    </div>
                    </div>"""

                    # Replace the original thinking tags with formatted HTML
                    formatted_content = formatted_content.replace(
                        f"<think>{match}</think>", thinking_html, 1
                    )

            # Create user message
            user_msg = Conversation(
                session_id=session_id,
                role="user",
                content=message,
                model=model_name,
            )

            # Create assistant message with formatted content and raw response
            assistant_msg = Conversation(
                session_id=session_id,
                role="assistant",
                content=full_content,
                formatted_content=formatted_content,
                model=model_name,
                raw_response={"streaming": True, "final_content": full_content},
            )

            # Store messages in database
            await save_conversation(
                get_db_session,
                session_id,
                model_name,
                message,
                full_content,
                formatted_content,
                response,
            )

    except Exception as e:
        logger.exception("[ChatRouter] SSE streaming error")
        error_payload = {
            "error": {
                "message": "Streaming error occurred",
                "code": 500,
                "type": "server_error",
                "details": str(e)
            }
        }
        # Yield an SSE event indicating a structured error
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
    try:
        client_wrapper = await get_model_client_dependency(model)
        client = client_wrapper["client"]
        return StreamingResponse(
            generate_stream_chunks(
                message,
                client,
                model,
                developer_config,
                reasoning_effort,
                db,
                session_id
            ),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.exception(f"/chat/sse streaming error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
