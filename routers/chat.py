import json
import uuid
import time
from typing import Optional, List, Dict, Any, Union
from uuid import UUID

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func
from azure.core.exceptions import HttpResponseError

from database import get_db_session, AsyncSessionLocal  # Corrected import
from clients import get_model_client
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
    session_id: UUID = Query(...),
    role: str = Query(...),
    content: str = Query(...),
    db: AsyncSession = Depends(get_db_session),
    current_user: Optional[User] = Depends(get_current_user),
):
    try:
        from sqlalchemy import insert

        values = {"session_id": session_id, "role": role, "content": content}

        # Add user_id if authenticated
        if current_user:
            values["user_id"] = current_user.id

        stmt = insert(Conversation).values(**values)
        await db.execute(stmt)
        await db.commit()
        return {"status": "success"}
    except Exception as e:
        await db.rollback()
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


@router.post("/", response_model=ChatCompletionResponse)
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

        # Get the client
        try:
            client = await get_model_client(request.model)
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
            response = client.chat.completions.create(
                messages=params["messages"],
                temperature=params.get("temperature"),
                max_tokens=params.get("max_tokens"),
                reasoning_effort=params.get("reasoning_effort", "medium"),
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
    reasoning_effort: str,
    db: AsyncSession,
    session_id: str,
):
    """
    Async generator that yields SSE data chunks from streaming responses.
    Handles both AzureOpenAI and ChatCompletionsClient.
    """
    # Prepare parameters based on client type and model
    is_inference_client = isinstance(client, ChatCompletionsClient)
    is_deepseek = model_name.lower().startswith("deepseek")

    # Prepare parameters based on client type and model
    params = {
        "messages": [{"role": "user", "content": message}],
        "temperature": config.DEEPSEEK_R1_DEFAULT_TEMPERATURE if is_deepseek else 0.7,
        "max_tokens": (
            config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            if is_deepseek
            else config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
        ),
    }

    # Handle reasoning effort for o-series models
    if not is_deepseek:
        params["reasoning_effort"] = reasoning_effort

    full_content = ""

    try:
        if is_inference_client and is_deepseek:
            # Stream with Azure AI Inference client
            stream_response = client.complete(
                model=model_name,
                messages=params["messages"],
                temperature=params.get("temperature"),
                max_tokens=params.get("max_tokens"),
                stream=True,
            )

            # Azure AI Inference streaming
            for chunk in stream_response:
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

                    if hasattr(choice, "message") and hasattr(
                        choice.message, "content"
                    ):
                        content_part = choice.message.content
                        full_content += content_part
                        partial["delta"]["content"] = content_part

                    if hasattr(choice, "delta", None):
                        partial["delta"]["role"] = getattr(choice.delta, "role", None)

                    # If there are any tool calls or filter results, pass them along
                    if hasattr(choice.delta, "tool_calls", None):
                        partial["delta"]["tool_calls"] = choice.delta.tool_calls
                    if hasattr(chunk, "content_filter_results"):
                        partial["delta"][
                            "content_filter_results"
                        ] = chunk.content_filter_results

                    chunk_choices.append(partial)

                response_data["choices"] = chunk_choices
                yield f"data: {json.dumps(response_data)}\n\n"

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

                    if hasattr(choice.delta, "content", None):
                        content_part = choice.delta.content
                        full_content += content_part
                        partial["delta"]["content"] = content_part

                    if hasattr(choice.delta, "role", None):
                        partial["delta"]["role"] = choice.delta.role

                    # If there are any tool calls or filter results, pass them along
                    if hasattr(choice.delta, "tool_calls", None):
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
            if model_name == "DeepSeek-R1" and full_content:
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
        error_payload = {"error": str(e)}
        # Yield an SSE event indicating an error
        yield f"data: {json.dumps(error_payload)}\n\n"
