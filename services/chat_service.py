# chat_service.py

import time
import uuid
from time import perf_counter
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

# AzureOpenAI & specific error handling
from openai import AzureOpenAI
from openai import OpenAIError

import openai
from logging_config import logger
import config
from models import Conversation
from pydantic_models import ChatMessage


# If you prefer a uniform error response dict:
def create_error_response(
    status_code: int,
    code: str,
    message: str,
    error_type: str = "service_error",
    inner_error: str = "",
):
    """
    Example function to create a uniform error response dict.
    If you prefer to raise HTTPException, you can do that instead.
    """
    return {
        "status_code": status_code,
        "detail": {
            "error": {
                "code": code,
                "message": message,
                "type": error_type,
                "inner_error": inner_error,
            }
        },
    }


class TokenManager:
    """
    Example token manager for counting tokens and limiting context size.
    You can adapt or remove if your code doesn't need it.
    """

    @staticmethod
    async def get_model_limits(model_name: str) -> Dict[str, int]:
        """Get token limits for a specific model from database or use default."""
        # Get model configs from database
        from services.config_service import ConfigService
        from database import AsyncSessionLocal
        
        try:
            async with AsyncSessionLocal() as config_db:
                config_service = ConfigService(config_db)
                model_configs = await config_service.get_config("model_configs")
                
            model_config = model_configs.get(model_name, {}) if model_configs else {}
        except Exception:
            model_config = {}
            
        # fallback to e.g. 4096 if not defined
        max_tokens = model_config.get("max_tokens", 4096)
        return {
            "max_tokens": max_tokens,
            # e.g. 80% of total tokens for context
            "max_context_tokens": int(max_tokens * 0.8),
        }

    @staticmethod
    def count_tokens(text_content: str) -> int:
        """
        Naive token count for demonstration.
        Replace with GPT token counting (e.g. tiktoken) if you need accuracy.
        """
        return len(text_content.split())

    @staticmethod
    def sum_context_tokens(messages: List[Dict[str, Any]]) -> int:
        """Sum token usage across all messages."""
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += TokenManager.count_tokens(content)
            elif isinstance(content, list):
                # If content is structured in a list, handle accordingly
                for item in content:
                    if isinstance(item, dict):
                        total += TokenManager.count_tokens(item.get("text", ""))
                    elif isinstance(item, str):
                        total += TokenManager.count_tokens(item)
        return total


# --------------------------------------------------------------------------
# Main Chat Logic
# --------------------------------------------------------------------------
async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: AzureOpenAI,
    model_name: Optional[str] = None,
) -> dict:
    """
    Processes a single chat message, calling AzureOpenAI to get a response,
    and stores conversation data in the DB.

    :param chat_message: The inbound message object (includes user text, session_id, etc.)
    :param db_session: SQLAlchemy AsyncSession for DB operations.
    :param azure_client: AzureOpenAI client to interact with (already constructed).
    :param model_name: Optional override of the model name; can also be in chat_message.

    :return: A dict matching ChatCompletionResponse shape (with 'choices', 'usage', etc.).
    """

    start_time = perf_counter()
    session_id = chat_message.session_id

    # Determine final model to use
    model_name = model_name or config.AZURE_OPENAI_DEPLOYMENT_NAME
    
    # Get model configs from database
    from services.config_service import ConfigService
    from database import AsyncSessionLocal
    
    try:
        async with AsyncSessionLocal() as config_db:
            config_service = ConfigService(config_db)
            model_configs = await config_service.get_config("model_configs")
            
        if not model_configs or model_name not in model_configs:
            logger.warning(f"Model '{model_name}' is not defined in database model_configs")
            # Continue anyway, we'll set defaults later
    except Exception as e:
        logger.error(f"Error fetching model_configs: {str(e)}")
        # Continue with execution

    logger.info(
        f"[session {session_id}] Processing chat request for model: {model_name}"
    )
    user_content = chat_message.message or ""

    # Build messages array for AzureOpenAI
    messages = []
    # If there's a developer/system config, prepend it:
    if getattr(chat_message, "developer_config", None):
        messages.append({"role": "system", "content": chat_message.developer_config})

    # Retrieve conversation history from DB
    existing_history = await fetch_conversation_history(db_session, session_id)

    max_count = 15
    if len(existing_history) > max_count:
        older_part = existing_history[:-max_count]
        summary_text = await summarize_messages(older_part)
        existing_history = existing_history[-max_count:]
        existing_history.insert(0, {"role": "system", "content": summary_text})

    messages.extend(existing_history)

    # Add the new user message
    messages.append({"role": "user", "content": user_content})

    # Check token usage
    token_info = await TokenManager.get_model_limits(model_name)
    context_tokens = TokenManager.sum_context_tokens(messages)
    if context_tokens >= token_info["max_context_tokens"]:
        logger.warning(
            f"[session {session_id}] Context tokens ({context_tokens}) "
            f"approaching or exceeding limit ({token_info['max_context_tokens']})."
        )
        # Consider truncating older messages or summarizing them if needed.

    # Build AzureOpenAI request parameters
    params = {"messages": messages, "model": model_name, "stream": False}  # Non-streaming by default

    # Configure model parameters
    # First try to get model config from database
    from services.config_service import ConfigService
    from database import AsyncSessionLocal
    
    async with AsyncSessionLocal() as config_db:
        config_service = ConfigService(config_db)
        db_model_configs = await config_service.get_config("model_configs")
        
    # Use database config if available, otherwise fall back to config.MODEL_CONFIGS
    model_config = db_model_configs.get(model_name, {}) if db_model_configs else {}
    
    # Check if this is an o-series model or DeepSeek model
    is_o_series = model_name.lower().startswith('o1') or model_name.lower().startswith('o3')
    is_deepseek = model_name.lower() == 'deepseek-r1'
    
    if is_o_series:
        # For o-series models, use reasoning_effort and max_completion_tokens
        reasoning_effort = getattr(chat_message, "reasoning_effort", "medium")
        params["reasoning_effort"] = reasoning_effort
        
        max_completion_tokens = getattr(chat_message, "max_completion_tokens", 4096)
        params["max_completion_tokens"] = max_completion_tokens
        
        # For o-series models, we need to use developer role instead of system
        if messages and messages[0].get("role") == "system":
            messages[0]["role"] = "developer"
            
        # Add formatting re-enabled to message if not already present
        if messages:
            first_role = messages[0].get("role")
            if first_role == "developer" and not messages[0].get("content", "").startswith("Formatting re-enabled"):
                messages[0]["content"] = "Formatting re-enabled - use markdown code blocks. " + messages[0].get("content", "")
    elif is_deepseek:
        # For DeepSeek-R1, use temperature and max_tokens as per documentation
        params["temperature"] = chat_message.temperature if chat_message.temperature is not None else 0.7
        
        # DeepSeek uses max_tokens, not max_completion_tokens
        max_tokens = getattr(chat_message, "max_completion_tokens", 4096)
        params["max_tokens"] = min(max_tokens, model_config.get("max_tokens", 4096))
        
        # DeepSeek-R1 uses system role
        # Add formatting re-enabled to message if not already present
        if messages:
            first_role = messages[0].get("role")
            if first_role == "system" and not messages[0].get("content", "").startswith("Formatting re-enabled"):
                messages[0]["content"] = "Formatting re-enabled - use markdown code blocks. " + messages[0].get("content", "")
    else:
        # For standard models, use temperature and max_tokens
        params["temperature"] = (
            chat_message.temperature if chat_message.temperature is not None else 0.7
        )
        max_completion_tokens = getattr(chat_message, "max_completion_tokens", 1024)
        params["max_tokens"] = min(max_completion_tokens, model_config.get("max_tokens", 4096))

    # If user wants file context or additional data, inject here
    if getattr(chat_message, "include_files", False) and chat_message.file_ids:
        # Example placeholder for file retrieval logic:
        # file_contents = await get_file_contents(db_session, chat_message.file_ids)
        # for fcontent in file_contents:
        #     params["messages"].append({"role": "system", "content": f"File context: {fcontent}"})
        pass

    # ----------------------------------------------------------------------
    # Call to AzureOpenAI
    # ----------------------------------------------------------------------
    try:
        # Call the OpenAI API synchronously (without await)
        response = azure_client.chat.completions.create(**params)
    except OpenAIError as e:
        logger.exception(
            f"[session {session_id}] AzureOpenAI API call failed: {str(e)}"
        )

        # Attempt to extract a code or relevant message if available
        error_code = getattr(e, "code", "api_error")
        error_message = str(e)
        # Some e.response objects may contain more detailed info:
        if getattr(e, "response", None) and getattr(e.response, "data", None):
            error_message = f"{error_message}. Details: {e.response.data}"

        err = create_error_response(
            status_code=503,
            code=error_code,
            message="Error during Azure OpenAI call",
            error_type="api_call_error",
            inner_error=error_message,
        )
        raise ValueError(err["detail"])
    except Exception as e:
        # Log the full error details for internal debugging
        logger.exception(
            f"[session {session_id}] An unexpected error occurred: {str(e)}"
        )
        
        # Create a sanitized error response that doesn't expose implementation details
        err = create_error_response(
            status_code=500,
            code="internal_server_error",
            message="An unexpected error occurred during processing.",
            error_type="internal_server_error",
            inner_error="Internal server error"  # Don't expose actual error details externally
        )
        raise ValueError(err["detail"])

    # Extract content from the response
    if not response.choices or len(response.choices) == 0:
        logger.warning(f"[session {session_id}] No choices returned from AzureOpenAI.")
        content = ""
    else:
        content = response.choices[0].message.content
        
        # Process DeepSeek-R1 responses if needed
        if model_name == "DeepSeek-R1" and content:
            # By default, keep the thinking process for DeepSeek-R1
            # Application can decide to filter it out if needed
            logger.debug(f"[session {session_id}] DeepSeek response received with <think> tags: {('<think>' in content)}")

    elapsed = perf_counter() - start_time
    logger.info(f"[session {session_id}] Chat completion finished in {elapsed:.2f}s")

    # Prepare a response in the style of ChatCompletionResponse
    usage_raw = getattr(response, "usage", None)
    usage_data = {}
    if usage_raw:
        usage_data = {
            "prompt_tokens": getattr(usage_raw, "prompt_tokens", 0),
            "completion_tokens": getattr(usage_raw, "completion_tokens", 0),
            "total_tokens": getattr(usage_raw, "total_tokens", 0),
        }
    
    resp_data = {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage_data,
    }
    
    # Process and format content for display if needed
    formatted_content = content
    
    # For DeepSeek models, preserve thinking tags but format them for HTML display
    if model_name == "DeepSeek-R1" and content:
        # Preserve and format thinking tags for DeepSeek
        thinkRegex = r'<think>([\s\S]*?)<\/think>'
        import re
        
        matches = re.findall(thinkRegex, content)
        formatted_content = content
        
        # Apply formatting to each thinking block
        for i, match in enumerate(matches):
            thinking_html = f'''<div class="thinking-process">
              <div class="thinking-header">
                <button class="thinking-toggle" aria-expanded="true">
                  <span class="toggle-icon">▼</span> Thinking Process
                </button>
              </div>
              <div class="thinking-content">
                <pre class="thinking-pre">{match}</pre>
              </div>
            </div>'''
            
            # Replace the original thinking tags with the formatted HTML
            formatted_content = formatted_content.replace(f'<think>{match}</think>', thinking_html, 1)
    
    # Save conversation to DB before sending to frontend, including raw response and formatted content
    await save_conversation(db_session, session_id, model_name, user_content, content, formatted_content, response)

    return resp_data


# --------------------------------------------------------------------------
# Auxiliary DB Logic
# --------------------------------------------------------------------------
async def fetch_conversation_history(
    db_session: AsyncSession, session_id: str
) -> List[Dict[str, Any]]:
    """
    Example: retrieve prior conversation messages from the DB.
    Return them in a format suitable for the LLM: e.g., [{"role": ..., "content": ...}, ...].
    """
    result = await db_session.execute(
        text(
            """
            SELECT role, content
            FROM conversations
            WHERE session_id = :session_id
            ORDER BY timestamp ASC
        """
        ),
        {"session_id": session_id},
    )
    rows = result.mappings().all()

    history = []
    for row in rows:
        history.append({"role": row.role, "content": row.content})
    return history


async def save_conversation(
    db_session: AsyncSession,
    session_id: str,
    model_name: str,
    user_text: str,
    assistant_text: str,
    formatted_assistant_text: str = None,
    raw_response: Any = None,
):
    """
    Save the user's message and the assistant's message to the DB,
    plus update session info if needed.
    
    Parameters:
    - db_session: Database session
    - session_id: Session identifier
    - model_name: Name of the model used
    - user_text: Original user message
    - assistant_text: Original assistant response text
    - formatted_assistant_text: HTML/markdown formatted response for display
    - raw_response: Complete JSON response from the model API
    """
    try:
        # Create user message
        user_msg = Conversation(
            session_id=session_id, 
            role="user", 
            content=user_text, 
            model=model_name
        )
        
        # Create assistant message with formatted content and raw response
        assistant_msg = Conversation(
            session_id=session_id,
            role="assistant",
            content=assistant_text,
            formatted_content=formatted_assistant_text if formatted_assistant_text else assistant_text,
            model=model_name,
            raw_response=raw_response.model_dump() if raw_response and hasattr(raw_response, "model_dump") else 
                        (raw_response.__dict__ if raw_response else None)
        )

        db_session.add(user_msg)
        db_session.add(assistant_msg)

        # Optionally update a "sessions" table to track last activity
        await db_session.execute(
            text(
                """
                UPDATE sessions
                SET last_activity = NOW(),
                    last_model = :model_name
                WHERE id = :session_id
            """
            ),
            {"session_id": session_id, "model_name": model_name},
        )

        await db_session.commit()

    except Exception as e:
        logger.error(f"Failed to save conversation to the database: {str(e)}")
        await db_session.rollback()  # rollback any uncommitted changes
        raise  # re-raise the exception (or handle differently if desired)
    finally:
        # If each route uses its own session lifecycle, it's safe to close here.
        await db_session.close()
async def summarize_messages(messages: List[Dict[str, Any]]) -> str:
    """
    Summarize older messages into a single, concise system message.
    """
    combined_text = "\n".join(f"{m['role'].capitalize()}: {m['content']}" for m in messages)
    try:
        # Example: using openai.Completion to summarize
        response = openai.Completion.create(
            engine="text-davinci-003",
            prompt=f"Summarize the following chat:\n\n{combined_text}\n\nBrief Summary:",
            max_tokens=150
        )
        return response["choices"][0]["text"].strip()
    except Exception as e:
        return "Summary of older messages: [Error fallback] " + str(e)
