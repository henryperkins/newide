import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential
from config import AZURE_INFERENCE_ENDPOINT, AZURE_INFERENCE_CREDENTIAL, AZURE_INFERENCE_DEPLOYMENT
import re

client = ChatCompletionsClient(
    endpoint=AZURE_INFERENCE_ENDPOINT,
    credential=AzureKeyCredential(AZURE_INFERENCE_CREDENTIAL),
)

async def get_chat_response(messages: list) -> str:
    from azure.ai.inference.models import SystemMessage, UserMessage
    
    # Convert message format to DeepSeek-R1 expected structure
    converted_messages = []
    for msg in messages:
        if msg["role"] == "system":
            converted_messages.append(SystemMessage(content=msg["content"]))
        elif msg["role"] in ["user", "assistant"]:
            converted_messages.append(UserMessage(content=msg["content"], role=msg["role"]))
    
    response = client.complete(
        messages=converted_messages,
        max_tokens=40000,
        temperature=0.0
    )
    
    # Extract thinking and answer from response
    content = response.choices[0].message.content
    match = re.search(r"<think>(.*?)</think>(.*)", content, re.DOTALL)
    
    if match:
        return match.group(2).strip()  # Return just the answer
    return content

# ----------------------------------------------------------------------------------
# 1. Service Initialization
# ----------------------------------------------------------------------------------

def get_model_stats_service(db_session: AsyncSession) -> ModelStatsService:
    """Get or create a ModelStatsService instance."""
    return ModelStatsService(db_session)

# ----------------------------------------------------------------------------------
# 2. Token Management (Updated for DeepSeek-R1)
# ----------------------------------------------------------------------------------

class TokenManager:
    @staticmethod
    def get_model_limits(model_name: str) -> Dict[str, int]:
        """Get token limits for a specific model"""
        model_config = config.MODEL_CONFIGS.get(model_name, {})
        return {
            "max_tokens": model_config.get("max_tokens", 4096),
            "max_context_tokens": model_config.get("max_tokens", 4096) * 0.8  # 80% for context
        }

    @staticmethod
    async def count_context_tokens(context: List[Dict[str, Any]], model_name: str) -> Dict[str, int]:
        """Count tokens in context and return availability info"""
        limits = TokenManager.get_model_limits(model_name)
        context_tokens = sum(count_tokens(msg["content"]) for msg in context)
        
        return {
            "context_tokens": context_tokens,
            "available_tokens": limits["max_tokens"] - context_tokens,
            "max_tokens": limits["max_tokens"]
        }

# ----------------------------------------------------------------------------------
# 3. File Context Management
# ----------------------------------------------------------------------------------

async def get_file_context(
    session_id: str,
    file_ids: List[str],
    db_session: AsyncSession
) -> List[Dict[str, Any]]:
    """
    Retrieve file content and metadata for use in the chat context.
    """
    file_context = []
    try:
        # If no specific files requested, include all "ready" session files.
        if not file_ids:
            result = await db_session.execute(
                text("""
                    SELECT id FROM uploaded_files 
                    WHERE session_id = :session_id 
                      AND (status = 'ready' OR status IS NULL)
                      AND (metadata IS NULL 
                           OR metadata->>'azure_processing' != 'failed')
                """),
                {"session_id": session_id}
            )
            file_ids = [str(row[0]) for row in result.fetchall()]

        for file_id in file_ids:
            # Check if this file has chunks
            result = await db_session.execute(
                text("""
                    SELECT chunk_count, filename 
                    FROM uploaded_files 
                    WHERE id = :file_id::uuid
                """),
                {"file_id": file_id}
            )
            file_info = result.fetchone()
            if not file_info:
                continue

            chunk_count, filename = file_info
            if chunk_count and chunk_count > 1:
                # Handle chunked files
                result = await db_session.execute(
                    text("""
                        SELECT uf.content, uf.filename, uf.metadata
                        FROM uploaded_files uf
                        WHERE uf.status = 'chunk'
                          AND uf.metadata->>'parent_file_id' = :parent_id
                        ORDER BY (uf.metadata->>'chunk_index')::int
                    """),
                    {"parent_id": file_id}
                )
                chunks = result.fetchall()

                for i, (content, chunk_filename, metadata) in enumerate(chunks):
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except Exception:
                            metadata = {}

                    file_context.append({
                        "filename": f"{filename} (chunk {i+1}/{len(chunks)})",
                        "content": content,
                        "metadata": metadata
                    })
            else:
                # Handle single files
                result = await db_session.execute(
                    text("""
                        SELECT content, filename, metadata 
                        FROM uploaded_files 
                        WHERE id = :file_id::uuid
                    """),
                    {"file_id": file_id}
                )
                file_data = result.fetchone()
                if file_data:
                    content, single_filename, metadata = file_data
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except Exception:
                            metadata = {}
                    file_context.append({
                        "filename": single_filename,
                        "content": content,
                        "metadata": metadata
                    })

        return file_context

    except Exception as e:
        logger.error(f"Error retrieving file context: {e}")
        return []

# ----------------------------------------------------------------------------------
# 4. Message Formatting
# ----------------------------------------------------------------------------------

def format_messages(
    chat_message: ChatMessage, 
    history: List[Dict[str, Any]], 
    model_name: str
) -> List[Dict[str, Any]]:
    """
    Build the list of formatted messages for the Azure OpenAI API.
    """
    formatted = []
    model_config = config.MODEL_CONFIGS.get(model_name, {})
    is_o_series = not model_config.get("supports_temperature", True)

    # If there's developer_config, prepend it as a "developer" role message
    if getattr(chat_message, 'developer_config', None):
        formatted.append({
            "role": "developer" if is_o_series else "system",
            "content": chat_message.developer_config
        })

    # Add conversation history
    for msg in history:
        formatted.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    # Add the current user's message
    formatted.append({
        "role": "user",
        "content": chat_message.message
    })

    return formatted

# ----------------------------------------------------------------------------------
# 5. API Parameter Building
# ----------------------------------------------------------------------------------

async def build_api_params_with_search(
    formatted_messages: List[Dict[str, Any]], 
    chat_message: ChatMessage, 
    model_name: str,
    file_ids: Optional[List[str]] = None,
    session_id: Optional[str] = None,
    use_file_search: bool = False
) -> Dict[str, Any]:
    """
    Build the parameters for the Azure OpenAI Chat Completion API call.
    """
    model_config = config.MODEL_CONFIGS.get(model_name, {})

    # Base parameters
    params: Dict[str, Any] = {
        "messages": formatted_messages,
        "stream": model_config.get("supports_streaming", True) and validate_streaming(model_name)
    }

    # Model-specific parameters
    if model_config.get("supports_temperature", True):
        params.update({
            "temperature": getattr(chat_message, 'temperature', 0.7),
            "max_tokens": model_config.get("max_tokens", 4096)
        })
        
        # Optional parameters for non-o-series models
        for param in ['top_p', 'frequency_penalty', 'presence_penalty']:
            if hasattr(chat_message, param):
                params[param] = getattr(chat_message, param)
    else:
        # O-series specific parameters
        params["max_completion_tokens"] = (
            getattr(chat_message, 'max_completion_tokens', None) 
            or model_config.get("max_tokens", 40000)
        )
        if hasattr(chat_message, 'reasoning_effort'):
            params["reasoning_effort"] = chat_message.reasoning_effort

    # Response format (if supported)
    if getattr(chat_message, 'response_format', None):
        params["response_format"] = {"type": chat_message.response_format}

    # Azure Search Integration
    if use_file_search and session_id:
        azure_search_endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
        azure_search_key = os.getenv("AZURE_SEARCH_KEY")
        if not azure_search_endpoint or not azure_search_key:
            raise ValueError("Azure Search configuration incomplete")

        azure_search_index = f"index-{session_id}"
        file_filter = f"search.in(id, '{','.join(file_ids)}')" if file_ids else None

        params["data_sources"] = [{
            "type": "azure_search",
            "parameters": {
                "endpoint": azure_search_endpoint,
                "index_name": azure_search_index,
                "authentication": {
                    "type": "api_key",
                    "key": azure_search_key
                },
                "query_type": "vector_semantic_hybrid",
                "fields_mapping": config.AZURE_SEARCH_FIELDS,
                "strictness": 3,
                "top_n_documents": 5,
                "filter": quote(file_filter) if file_filter else None
            }
        }]
        logger.info(f"Added Azure AI Search integration for index: {azure_search_index}")

    return params

# ----------------------------------------------------------------------------------
# 6. Main Chat Processing
# ----------------------------------------------------------------------------------

async def process_chat_message(
    chat_message: ChatMessage,
    db_session: AsyncSession,
    azure_client: AzureOpenAI,
    model_name: Optional[str] = None
) -> dict:
    """
    Process a chat message with model selection and context management.
    """
    start_time = perf_counter()
    session_id = chat_message.session_id
    
    # Use specified model or default
    model_name = model_name or config.AZURE_OPENAI_DEPLOYMENT_NAME
    if model_name not in config.MODEL_CONFIGS:
        raise ValueError(f"Invalid model name: {model_name}")

    logger.info(f"[session {session_id}] Chat request received for model: {model_name}")
    input_logger.info(
        f"[session {session_id}] Message received. Length: {len(chat_message.message)} chars"
    )

    # Get conversation history
    result = await db_session.execute(
        text("""
            SELECT role, content
            FROM conversations
            WHERE session_id = :session_id
            ORDER BY timestamp ASC
        """),
        {"session_id": session_id},
    )
    history = result.mappings().all()

    # Format messages and check token limits
    formatted_messages = format_messages(chat_message, history, model_name)
    token_info = await TokenManager.count_context_tokens(formatted_messages, model_name)
    
    if token_info["context_tokens"] > token_info["max_tokens"] * 0.8:
        logger.warning(f"Context size ({token_info['context_tokens']}) approaching limit ({token_info['max_tokens']})")

    # Handle file context
    file_ids: List[str] = []
    use_file_search = False

    if getattr(chat_message, 'include_files', False):
        file_ids = getattr(chat_message, 'file_ids', []) or []
        use_file_search = getattr(chat_message, 'use_file_search', False)

        if not use_file_search:
            file_context = await get_file_context(session_id, file_ids, db_session)
            if file_context:
                formatted_messages = inject_file_context(formatted_messages, file_context)

    # Build and validate parameters
    try:
        params = await build_api_params_with_search(
            formatted_messages=formatted_messages,
            chat_message=chat_message,
            model_name=model_name,
            file_ids=file_ids,
            session_id=session_id,
            use_file_search=use_file_search
        )
    except Exception as e:
        logger.error(f"Error building API params: {e}")
        raise create_error_response(
            status_code=503,
            code="param_build_error",
            message="Failed to build API parameters",
            error_type="ParameterError",
            inner_error=str(e)
        )

    # Execute API call
    try:
        # Use pre-configured client from clients.py
        response = azure_client.chat.completions.create(**params)
    except Exception as e:
        logger.error(f"Error during API call: {e}")
        raise create_error_response(
            status_code=503,
            code="service_error",
            message="Error during API call",
            error_type="api_call_error",
            inner_error=str(e)
        )

    # Log completion and save to database
    elapsed = perf_counter() - start_time
    logger.info(f"[session {session_id}] Chat completed in {elapsed:.2f}s")
    
    assistant_msg = response.choices[0].message.content
    response_logger.info(
        f"[session {session_id}] Response generated. Length: {len(assistant_msg)} chars"
    )

    # Save conversation
    user_msg_entry = Conversation(
        session_id=session_id, 
        role="user", 
        content=chat_message.message,
        model=model_name
    )
    assistant_msg_entry = Conversation(
        session_id=session_id, 
        role="assistant", 
        content=assistant_msg,
        model=model_name
    )
    
    db_session.add(user_msg_entry)
    db_session.add(assistant_msg_entry)

    await db_session.execute(
        text("""
            UPDATE sessions 
            SET last_activity = NOW(),
                last_model = :model_name
            WHERE id = :session_id
        """),
        {
            "session_id": session_id,
            "model_name": model_name
        }
    )
    await db_session.commit()

    # Record model usage statistics
    stats_service = get_model_stats_service(db_session)
    usage_metadata = {
        "elapsed_time": elapsed,
        "file_count": len(file_ids) if file_ids else 0,
        "use_file_search": use_file_search,
        "context_tokens": token_info["context_tokens"]
    }

    await stats_service.record_usage(
        model=model_name,
        session_id=session_id,
        usage={
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
            "completion_tokens_details": {
                "reasoning_tokens": getattr(response.usage, 'reasoning_tokens', None)
            },
            "prompt_tokens_details": {
                "cached_tokens": getattr(response.usage, 'cached_tokens', 0)
            }
        },
        metadata=usage_metadata
    )

    # Format response
    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "created": int(time.time()),
        "model": model_name,
        "system_fingerprint": getattr(response, 'system_fingerprint', ''),
        "object": "chat.completion",
        "choices": [
            {
                "index": idx,
                "message": {
                    "role": "assistant",
                    "content": choice.message.content,
                    **({"tool_calls": choice.message.tool_calls} if hasattr(choice.message, 'tool_calls') else {})
                },
                "finish_reason": choice.finish_reason,
                "content_filter_results": getattr(choice, 'content_filter_results', {})
            }
            for idx, choice in enumerate(response.choices)
        ],
        "usage": {
            "completion_tokens": response.usage.completion_tokens,
            "prompt_tokens": response.usage.prompt_tokens,
            "total_tokens": response.usage.total_tokens,
            "completion_tokens_details": {
                "reasoning_tokens": getattr(response.usage, 'reasoning_tokens', None)
            },
            "prompt_tokens_details": {
                "cached_tokens": getattr(response.usage, 'cached_tokens', 0)
            }
        },
        "prompt_filter_results": getattr(response, 'prompt_filter_results', [])
    }

def inject_file_context(
    formatted_messages: List[Dict[str, Any]], 
    file_context: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Helper function to inject file context into messages"""
    # Find or create system message
    system_message = next(
        (m for m in formatted_messages if m["role"] in ["developer", "system"]),
        None
    )
    if not system_message:
        system_message = {"role": "developer", "content": []}
        formatted_messages.insert(0, system_message)

    # Add file list to system message
    file_instruction = "\n\nYou have access to the following files:\n"
    for i, file in enumerate(file_context):
        file_instruction += f"{i+1}. {file['filename']}\n"
    file_instruction += "\nRefer to these files when answering questions."

    if isinstance(system_message["content"], list):
        system_message["content"].append({"type": "text", "text": file_instruction})
    else:
        existing = system_message.get("content") or ""
        system_message["content"] = [
            {"type": "text", "text": existing + file_instruction}
        ]

    # Add file contents to user message
    user_message = formatted_messages[-1]
    if user_message["role"] == "user":
        file_content_text = "\n\nHere are the contents of the files:\n\n"
        for i, file in enumerate(file_context):
            file_content_text += f"[File {i+1}: {file['filename']}]\n{file['content']}\n\n"

        if isinstance(user_message["content"], list):
            user_message["content"].append({"type": "text", "text": file_content_text})
        else:
            existing_text = user_message.get("content") or ""
            user_message["content"] = [
                {"type": "text", "text": existing_text + file_content_text}
            ]

    return formatted_messages
