# routers/chat.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from openai import AzureOpenAI
from models import ChatMessage, ReasoningEffort
from database import get_db_session, Conversation
from clients import get_azure_client
from errors import create_error_response
from utils import count_tokens, calculate_model_timeout
from logging_config import input_logger, response_logger, logger
import config
from time import perf_counter
import datetime

router = APIRouter(prefix="/chat")

@router.post("/")
async def chat(
    chat_message: ChatMessage,
    db_session: AsyncSession = Depends(get_db_session),
    azure_client: AzureOpenAI = Depends(get_azure_client),
):
    start_time = perf_counter()
    session_id = chat_message.session_id
    logger.info(f"[session {session_id}] Chat request received")
    input_logger.info(f"[session {session_id}] Message received. Length: {len(chat_message.message)} chars")

    # Build initial messages list
    messages = []
    if chat_message.developer_config:
        # Always prefix with Formatting re-enabled for o1 models
        model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
        if "o1" in model_name:
            messages.append({
                "role": "developer",
                "content": f"Formatting re-enabled - {chat_message.developer_config.lstrip('Formatting re-enabled - ')}"
            })
        else:
            messages.append({
                "role": "developer",
                "content": chat_message.developer_config
            })
    messages.append({"role": "user", "content": chat_message.message})

    # Retrieve conversation history from the database
    result = await db_session.execute(
        text("SELECT role, content FROM conversations WHERE session_id = :session_id ORDER BY timestamp ASC"),
        {"session_id": session_id},
    )
    history = result.mappings().all()
    if history:
        messages = [{"role": row["role"], "content": row["content"]} for row in history] + messages

    # Format messages per API schema
    formatted_messages = []
    if chat_message.developer_config:
        formatted_messages.append({
            "role": "developer",
            "content": [{"type": "text", "text": chat_message.developer_config}],
        })
    for msg in history:
        message = {
            "role": msg["role"],
            "content": ([{"type": "text", "text": msg["content"]}]
                        if isinstance(msg["content"], str)
                        else msg["content"]),
        }
        if "name" in msg:
            message["name"] = msg["name"]
        formatted_messages.append(message)
    formatted_messages.append({
        "role": "user",
        "content": [{"type": "text", "text": chat_message.message}],
    })

    # Define parameters according to API schema
    model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
    is_o_series = (any(m in model_name for m in ["o1-", "o3-"]) and "preview" not in model_name)
    
    # Bypassed vision validation for dev speed
    
    params = {
        "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "messages": formatted_messages,
        "stream": chat_message.stream if hasattr(chat_message, "stream") else False,
        "response_format": {"type": chat_message.response_format} if chat_message.response_format else None,
        "max_completion_tokens": chat_message.max_completion_tokens,
    }

    # o-series specific parameters
    if is_o_series:
        params.update({
            "reasoning_effort": chat_message.reasoning_effort.value,
            "max_completion_tokens": min(chat_message.max_completion_tokens or 40000, 100000)
        })
    else:
        # Standard model parameters
        params.update({
            "temperature": 0.7,
            "top_p": 0.95,
            "presence_penalty": 0,
            "frequency_penalty": 0.1
        })
    if chat_message.response_format:
        params["response_format"] = {"type": chat_message.response_format}

    logger.info(f"Using API parameters for {'o-series' if is_o_series else 'standard'} model: {str(params)}")

    original_reasoning_effort = params.get("reasoning_effort", "medium")
    retry_attempts = 0
    max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 1
    retry_reasoning_efforts = []
    timeouts_used = []
    error_msg = ""

    while True:
        current_reasoning = params.get("reasoning_effort", "medium")
        timeout = calculate_model_timeout(formatted_messages, model_name, current_reasoning)
        if retry_attempts > 0:
            backoff_multiplier = config.O_SERIES_BACKOFF_MULTIPLIER ** retry_attempts
            timeout *= backoff_multiplier
        timeouts_used.append(timeout)
        logger.info(f"Attempt {retry_attempts+1}/{max_retries+1} with {current_reasoning} reasoning, timeout: {timeout:.1f}s")
        azure_client.timeout = timeout  # Set timeout for this attempt

        try:
            attempt_start = perf_counter()
            if params.get("stream"):
                # Handle streaming response for o3-mini
                collected_messages = []
                collected_tokens = {"prompt": 0, "completion": 0, "total": 0}
                async for chunk in azure_client.chat.completions.create(**params):
                    if chunk.choices[0].delta.content is not None:
                        collected_messages.append(chunk.choices[0].delta.content)
                    if hasattr(chunk, "usage"):
                        collected_tokens = {
                            "prompt": chunk.usage.prompt_tokens,
                            "completion": chunk.usage.completion_tokens,
                            "total": chunk.usage.total_tokens
                        }
                response_content = "".join(collected_messages)
                # Create a response object similar to non-streaming response
                response = type('StreamResponse', (), {
                    'choices': [type('Choice', (), {
                        'message': type('Message', (), {'content': response_content})(),
                        'finish_reason': chunk.choices[0].finish_reason if hasattr(chunk.choices[0], 'finish_reason') else None,
                        'content_filter_results': getattr(chunk.choices[0], 'content_filter_results', None)
                    })()],
                    'usage': type('Usage', (), collected_tokens)(),
                    'system_fingerprint': getattr(chunk, 'system_fingerprint', None),
                    'prompt_filter_results': getattr(chunk, 'prompt_filter_results', None)
                })()
            else:
                response = azure_client.chat.completions.create(**params)
            elapsed = perf_counter() - attempt_start
            logger.info(f"Request completed in {elapsed:.2f}s using {current_reasoning} reasoning")
            break
        except Exception as e:
            elapsed = perf_counter() - attempt_start
            error_msg = str(e).lower()
            retry_reasoning_efforts.append(current_reasoning)
            if retry_attempts >= max_retries:
                logger.exception(f"[session {session_id}] All {retry_attempts+1} attempts failed after {elapsed:.2f}s")
                raise create_error_response(
                    status_code=503,
                    code="service_timeout",
                    message="Service temporarily unavailable - all retry attempts failed",
                    error_type="timeout",
                    inner_error={
                        "original_error": error_msg,
                        "total_elapsed_seconds": perf_counter() - start_time,
                        "reasoning_attempts": [original_reasoning_effort] + retry_reasoning_efforts,
                        "timeouts_used": timeouts_used,
                    },
                )
            retry_attempts += 1
            if is_o_series and current_reasoning != "low":
                if current_reasoning == "high" and retry_attempts == 1:
                    params["reasoning_effort"] = "medium"
                    logger.warning(f"Request timed out after {elapsed:.2f}s with high reasoning. Retrying with medium reasoning.")
                else:
                    params["reasoning_effort"] = "low"
                    logger.warning(f"Request timed out after {elapsed:.2f}s with {current_reasoning} reasoning. Retrying with low reasoning.")
            else:
                logger.warning(f"Request timed out after {elapsed:.2f}s with {current_reasoning} reasoning. Retrying with increased timeout.")

    elapsed_total = perf_counter() - start_time
    tokens = {
        "prompt": response.usage.prompt_tokens if response.usage else 0,
        "completion": response.usage.completion_tokens if response.usage else 0,
        "total": response.usage.total_tokens if response.usage else 0,
    }
    logger.info(f"Chat completed in {elapsed_total:.2f}s - Tokens used: {tokens['total']} (prompt: {tokens['prompt']}, completion: {tokens['completion']})")

    assistant_msg = response.choices[0].message.content
    response_logger.info(f"[session {session_id}] Response generated. Length: {len(assistant_msg)} chars. Preview: {assistant_msg[:100]}{'...' if len(assistant_msg) > 100 else ''}")

    # Save conversation to database
    user_msg = Conversation(session_id=session_id, role="user", content=chat_message.message)
    assistant_msg_obj = Conversation(session_id=session_id, role="assistant", content=assistant_msg)
    db_session.add(user_msg)
    db_session.add(assistant_msg_obj)
    await db_session.execute(text("UPDATE sessions SET last_activity = NOW() WHERE id = :session_id"), {"session_id": session_id})
    await db_session.commit()

    logger.info(f"Chat request completed in {perf_counter() - start_time:.2f}s - Tokens used: {tokens}")
    final_response = {
        "response": assistant_msg,
        "usage": {
            "prompt_tokens": tokens["prompt"],
            "completion_tokens": tokens["completion"],
            "total_tokens": tokens["total"],
        },
    }
    # Include detailed token usage for o-series models
    if is_o_series and hasattr(response.usage, "completion_tokens_details"):
        completion_details = response.usage.completion_tokens_details
        final_response["usage"]["completion_details"] = {
            "reasoning_tokens": completion_details.reasoning_tokens if hasattr(completion_details, "reasoning_tokens") else None,
        }
        if hasattr(response.usage, "prompt_tokens_details"):
            final_response["usage"]["prompt_details"] = {
                "cached_tokens": response.usage.prompt_tokens_details.cached_tokens
            }
    if hasattr(response, "choices") and response.choices:
        choice = response.choices[0]
        if hasattr(choice, "finish_reason"):
            final_response["finish_reason"] = choice.finish_reason
        if hasattr(choice, "content_filter_results"):
            final_response["content_filter_results"] = choice.content_filter_results
    if hasattr(response, "system_fingerprint"):
        final_response["system_fingerprint"] = response.system_fingerprint
    if hasattr(response, "prompt_filter_results"):
        final_response["prompt_filter_results"] = response.prompt_filter_results

    return final_response
