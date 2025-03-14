"""
Utilities for distributed tracing and performance monitoring with Sentry.

Enhancements:
-------------
- Added 'log_args' parameter in trace_function for optional logging of function args/kwargs.
- Updated docstrings for clarity.
- Minor improvement to add_breadcrumb logger call.
- Added specialized AI/ML operation tracing
- Added performance measurement utilities
- Added distributed tracing support with trace context propagation
- Added custom measurement utilities for tracking key metrics
"""
import asyncio
import functools
import inspect
import time
from typing import Optional, Dict, Any, Callable, TypeVar, cast, Union, List
from contextlib import contextmanager

import sentry_sdk
from logging_config import get_logger

# Type variables for function decorators
F = TypeVar('F', bound=Callable[..., Any])
T = TypeVar('T')

logger = get_logger(__name__)

def trace_function(
    op: str,
    name: Optional[str] = None,
    log_args: bool = False,
    **tags: str
) -> Callable[[F], F]:
    """
    Decorator to trace a function with Sentry.

    Args:
        op: The operation type for the span (e.g. "model.inference", "db.query", etc.)
        name: Custom name for the span (defaults to the function name if None).
        log_args: Whether to record function args/kwargs in the Sentry span (False by default).
        **tags: Additional tags to set on the span (e.g. model_name="DeepSeek-R1").

    Returns:
        Decorated function that wraps execution in a Sentry span.
    """
    def decorator(func: F) -> F:
        func_name = name or func.__name__

        # Attempt to retrieve the file and line number for the target function
        source_file = inspect.getsourcefile(func)
        source_line = None
        try:
            _, line_num = inspect.getsourcelines(func)
            source_line = line_num
        except Exception:
            # In some environments, getsourcefile/getsourcelines can fail (e.g. for built-ins).
            pass

        is_async = asyncio.iscoroutinefunction(func)

        if is_async:
            # ----------------------------------------------------------------
            # Async wrapper
            # ----------------------------------------------------------------
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                with sentry_sdk.start_span(op=op, description=func_name) as span:
                    # Add code context if available
                    if source_file:
                        span.set_data("code.filepath", source_file)
                    if source_line is not None:
                        span.set_data("code.lineno", source_line)
                    span.set_data("code.function", func.__name__)
                    span.set_data("code.namespace", func.__module__)

                    # Add custom tags
                    for tag_key, tag_value in tags.items():
                        span.set_tag(tag_key, tag_value)

                    # Optionally log the function arguments
                    if log_args:
                        span.set_data("args", repr(args))
                        span.set_data("kwargs", repr(kwargs))

                    start_time = time.time()
                    try:
                        result = await func(*args, **kwargs)
                        span.set_data("success", True)
                        return result
                    except Exception as e:
                        span.set_data("success", False)
                        span.set_data("error.type", e.__class__.__name__)
                        span.set_data("error.message", str(e))
                        raise
                    finally:
                        duration = time.time() - start_time
                        span.set_data("duration_seconds", duration)
                        logger.info(
                            f"Function {func_name} completed in {duration:.4f}s",
                            extra={"duration": duration, "operation": op}
                        )

            return cast(F, async_wrapper)
        else:
            # ----------------------------------------------------------------
            # Sync wrapper
            # ----------------------------------------------------------------
            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                with sentry_sdk.start_span(op=op, description=func_name) as span:
                    # Add code context if available
                    if source_file:
                        span.set_data("code.filepath", source_file)
                    if source_line is not None:
                        span.set_data("code.lineno", source_line)
                    span.set_data("code.function", func.__name__)
                    span.set_data("code.namespace", func.__module__)

                    # Add custom tags
                    for tag_key, tag_value in tags.items():
                        span.set_tag(tag_key, tag_value)

                    # Optionally log the function arguments
                    if log_args:
                        span.set_data("args", repr(args))
                        span.set_data("kwargs", repr(kwargs))

                    start_time = time.time()
                    try:
                        result = func(*args, **kwargs)
                        span.set_data("success", True)
                        return result
                    except Exception as e:
                        span.set_data("success", False)
                        span.set_data("error.type", e.__class__.__name__)
                        span.set_data("error.message", str(e))
                        raise
                    finally:
                        duration = time.time() - start_time
                        span.set_data("duration_seconds", duration)
                        logger.info(
                            f"Function {func_name} completed in {duration:.4f}s",
                            extra={"duration": duration, "operation": op}
                        )

            return cast(F, sync_wrapper)

    return decorator

def trace_db_query(query_type: str) -> Callable[[F], F]:
    """
    Specialized decorator for tracing database queries.

    Args:
        query_type: Type of database query (e.g., 'select', 'insert', 'update').

    Returns:
        Decorated function that reports the query operation type to Sentry.
    """
    return trace_function(op="db.query", name=f"db.{query_type}", db_operation=query_type)

def trace_http_request(method: str, url_pattern: str) -> Callable[[F], F]:
    """
    Specialized decorator for tracing outbound or client HTTP requests.

    Args:
        method: HTTP method (GET, POST, etc.).
        url_pattern: Pattern or identifier for the URL endpoint.

    Returns:
        Decorated function that reports the HTTP request details to Sentry.
    """
    return trace_function(
        op="http.client", 
        name=f"{method} {url_pattern}", 
        http_request_method=method
    )

def trace_file_operation(operation: str) -> Callable[[F], F]:
    """
    Specialized decorator for tracing file operations.

    Args:
        operation: Type of file operation (read, write, delete).

    Returns:
        Decorated function that reports file operation details to Sentry.
    """
    return trace_function(op="file.operation", name=f"file.{operation}")

def trace_ai_operation(model_name: str, operation: str = "inference") -> Callable[[F], F]:
    """
    Specialized decorator for tracing AI/ML operations.

    Args:
        model_name: Name of the AI model being used (e.g., "gpt-4", "claude-3-opus").
        operation: Type of AI operation (e.g., "inference", "embedding", "tokenization").

    Returns:
        Decorated function that reports AI operation details to Sentry.
    """
    return trace_function(
        op="ai.operation", 
        name=f"ai.{operation}", 
        ai_model=model_name,
        ai_operation_type=operation
    )

def trace_rag_operation(source: str, operation: str = "retrieval") -> Callable[[F], F]:
    """
    Specialized decorator for tracing RAG (Retrieval Augmented Generation) operations.

    Args:
        source: The data source being used for retrieval (e.g., "azure_search", "vector_db").
        operation: Type of RAG operation (e.g., "retrieval", "augmentation", "generation").

    Returns:
        Decorated function that reports RAG operation details to Sentry.
    """
    return trace_function(
        op="rag.operation", 
        name=f"rag.{operation}", 
        rag_source=source,
        rag_operation_type=operation
    )

@contextmanager
def trace_block(description: str, op: str, **data: Any):
    """
    Context manager for tracing a block of code with Sentry.
    
    Useful for short, manual instrumentation around a piece of logic or 
    a code block that doesn’t fit into a function-based decorator.

    Args:
        description: Describes the block of code being executed.
        op: Operation type (e.g. "db.query", "cache.check").
        data: Additional data to attach to the span.

    Yields:
        Sentry span that you can optionally modify inside the block.
    """
    with sentry_sdk.start_span(op=op, description=description) as span:
        for key, value in data.items():
            span.set_data(key, value)

        start_time = time.time()
        try:
            yield span
            span.set_data("success", True)
        except Exception as e:
            span.set_data("success", False)
            span.set_data("error.type", e.__class__.__name__)
            span.set_data("error.message", str(e))
            raise
        finally:
            duration = time.time() - start_time
            span.set_data("duration_seconds", duration)

@contextmanager
def profile_block(description: str, op: str = "code.profile", **data: Any):
    """
    Context manager specifically for profiling a block of code,
    mirrored after trace_block but semantically named for profiling.

    Args:
        description: Describes what's being profiled.
        op: Operation type (default "code.profile").
        data: Additional data to attach to the span.

    Yields:
        Sentry span that you can optionally modify inside the block.
    """
    with sentry_sdk.start_span(op=op, description=description) as span:
        for key, value in data.items():
            span.set_data(key, value)

        start_time = time.time()
        try:
            yield span
            span.set_data("success", True)
        except Exception as e:
            span.set_data("success", False)
            span.set_data("error.type", e.__class__.__name__)
            span.set_data("error.message", str(e))
            raise
        finally:
            duration = time.time() - start_time
            span.set_data("duration_seconds", duration)

@contextmanager
def ai_operation_block(model_name: str, operation_type: str = "inference", **data: Any):
    """
    Context manager specifically for tracing AI operations.
    
    Args:
        model_name: Name of the AI model being used.
        operation_type: Type of AI operation (default "inference").
        data: Additional data to attach to the span.
        
    Yields:
        Sentry span that you can optionally modify inside the block.
    """
    # Create a container for token counts that will be accessible within the context
    token_counts = {}
    
    with sentry_sdk.start_span(op="ai.operation", description=f"{operation_type} with {model_name}") as span:
        span.set_tag("ai.model", model_name)
        span.set_tag("ai.operation_type", operation_type)
        
        for key, value in data.items():
            span.set_data(key, value)
            
        start_time = time.time()
        try:
            # Pass both the span and token_counts to the context
            yield (span, token_counts)
            span.set_data("success", True)
        except Exception as e:
            span.set_data("success", False)
            span.set_data("error.type", e.__class__.__name__)
            span.set_data("error.message", str(e))
            raise
        finally:
            duration = time.time() - start_time
            span.set_data("duration_seconds", duration)
            # Add token counts if they were set during the operation
            for token_type, count in token_counts.items():
                span.set_data(f"ai.{token_type}_tokens", count)

def create_transaction(name: str, op: str, **data: Any):
    """
    Create a new top-level transaction for a logical operation.

    Typically used for higher-level processes that might contain multiple 
    function calls or sub-operations. E.g., "user.signup.flow" or "chat.process".

    Args:
        name: The transaction name.
        op: The operation type/category.
        **data: Additional key/value data to attach.

    Returns:
        The created Sentry transaction object.
    """
    transaction = sentry_sdk.start_transaction(name=name, op=op)
    for key, value in data.items():
        transaction.set_data(key, value)

    # Make this transaction the current scope transaction
    sentry_sdk.Hub.current.scope.transaction = transaction
    
    return transaction

def create_distributed_transaction(
    name: str, 
    op: str, 
    trace_id: Optional[str] = None,
    parent_span_id: Optional[str] = None,
    **data: Any
):
    """
    Create a transaction that continues a trace from another service.
    
    This is useful for distributed tracing across multiple services or
    between backend and frontend.
    
    Args:
        name: The transaction name.
        op: The operation type/category.
        trace_id: Optional trace ID to continue. If None, a new one is created.
        parent_span_id: Optional parent span ID. Required if trace_id is provided.
        **data: Additional key/value data to attach.
        
    Returns:
        The created Sentry transaction object.
    """
    if trace_id and not parent_span_id:
        logger.warning("parent_span_id is required when trace_id is provided")
        
    trace_context = {}
    if trace_id:
        trace_context["trace_id"] = trace_id
    if parent_span_id:
        trace_context["parent_span_id"] = parent_span_id
        
    transaction = sentry_sdk.start_transaction(
        name=name, 
        op=op,
        **trace_context
    )
    
    for key, value in data.items():
        transaction.set_data(key, value)

    # Make this transaction the current scope transaction
    sentry_sdk.Hub.current.scope.transaction = transaction
    
    return transaction

def get_trace_context() -> Dict[str, str]:
    """
    Get the current trace context for propagation to other services.
    
    Returns:
        Dictionary with trace_id and span_id if a transaction is active,
        otherwise an empty dictionary.
    """
    hub = sentry_sdk.Hub.current
    if not hub:
        return {}
        
    span = hub.scope.span
    if not span:
        return {}
        
    return {
        "trace_id": span.trace_id,
        "span_id": span.span_id
    }

def set_measurement(name: str, value: Union[float, int], unit: str = ""):
    """
    Set a custom measurement on the current transaction.
    
    Args:
        name: Name of the measurement.
        value: Numeric value of the measurement.
        unit: Optional unit of measurement (e.g., "millisecond", "byte").
    """
    transaction = sentry_sdk.Hub.current.scope.transaction
    if not transaction:
        logger.warning(f"Cannot set measurement '{name}': No active transaction")
        return
        
    if unit:
        transaction.set_measurement(name, value, unit)
    else:
        transaction.set_measurement(name, value)
        
def set_ai_token_counts(prompt_tokens: int, completion_tokens: int, total_tokens: Optional[int] = None, token_counts_dict: Optional[Dict[str, int]] = None):
    """
    Set token count measurements for AI operations on the current span or transaction.
    
    Args:
        prompt_tokens: Number of tokens in the prompt.
        completion_tokens: Number of tokens in the completion.
        total_tokens: Optional total token count. If None, calculated as prompt + completion.
        token_counts_dict: Optional dictionary to update with token counts (for use with ai_operation_block).
    """
    if total_tokens is None:
        total_tokens = prompt_tokens + completion_tokens
    
    # If a token_counts_dict was provided (from ai_operation_block), update it
    if token_counts_dict is not None:
        token_counts_dict["prompt"] = prompt_tokens
        token_counts_dict["completion"] = completion_tokens
        token_counts_dict["total"] = total_tokens
    
    # Get the current span and set data directly
    span = sentry_sdk.get_current_span()
    if span:
        span.set_data("ai.prompt_tokens", prompt_tokens)
        span.set_data("ai.completion_tokens", completion_tokens)
        span.set_data("ai.total_tokens", total_tokens)
    else:
        logger.warning("Cannot set token counts: No active span")
    
    # Set measurements on the transaction
    transaction = sentry_sdk.Hub.current.scope.transaction
    if transaction:
        transaction.set_measurement("ai.prompt_tokens", prompt_tokens)
        transaction.set_measurement("ai.completion_tokens", completion_tokens)
        transaction.set_measurement("ai.total_tokens", total_tokens)

def set_user_context(user_id: Optional[str] = None, username: Optional[str] = None, 
                     email: Optional[str] = None, **extra_data: Any):
    """
    Set user context for Sentry events, enabling correlation of errors 
    and traces to a particular user identity.

    Args:
        user_id: Unique user ID
        username: Username or handle
        email: User's email address
        **extra_data: Additional user-related data you want to record
    """
    user_data = {}
    if user_id:
        user_data["id"] = user_id
    if username:
        user_data["username"] = username
    if email:
        user_data["email"] = email

    user_data.update(extra_data)
    sentry_sdk.set_user(user_data)

    logger.debug(f"Set Sentry user context: {user_id or 'anonymous'}", extra=user_data)

def add_breadcrumb(category: str, message: str, level: str = "info", **data: Any):
    """
    Add a breadcrumb to the current Sentry scope. Breadcrumbs are 
    low-level logs or events that can help diagnose issues leading up 
    to an error.

    Args:
        category: The category or type of breadcrumb (e.g. 'http', 'user-action').
        message: Descriptive message.
        level: Severity level for the breadcrumb ('debug', 'info', 'warning', 'error', 'critical').
        **data: Additional key/value pairs for context.
    """
    sentry_sdk.add_breadcrumb(
        category=category,
        message=message,
        level=level,
        data=data
    )
    
    # Also log to the application logger at the appropriate level
    if level in ("warning", "error", "critical"):
        getattr(logger, level)(f"[breadcrumb] {message}", extra=data)
    else:
        logger.debug(f"[breadcrumb] {message}", extra=data)
        
def add_ai_prompt_breadcrumb(prompt: Union[str, List[Dict[str, str]]], model: str):
    """
    Add a breadcrumb for an AI prompt, with special handling for different prompt formats.
    
    Args:
        prompt: The prompt text or messages array sent to the AI model.
        model: The AI model name.
    """
    # For privacy reasons, we'll truncate the prompt if it's too long
    MAX_PROMPT_LENGTH = 500
    
    if isinstance(prompt, str):
        truncated_prompt = prompt[:MAX_PROMPT_LENGTH] + ("..." if len(prompt) > MAX_PROMPT_LENGTH else "")
        prompt_data = {"prompt_text": truncated_prompt}
    else:
        # For message-based prompts (e.g., ChatGPT), summarize the structure
        roles = [msg.get("role", "unknown") for msg in prompt if isinstance(msg, dict)]
        prompt_data = {
            "format": "messages",
            "message_count": len(prompt),
            "roles": roles
        }
        
        # Include a sample of the last user message if available
        user_messages = [msg.get("content", "") for msg in prompt 
                         if isinstance(msg, dict) and msg.get("role") == "user"]
        if user_messages:
            last_user_msg = user_messages[-1]
            if isinstance(last_user_msg, str):
                truncated_msg = last_user_msg[:MAX_PROMPT_LENGTH] + ("..." if len(last_user_msg) > MAX_PROMPT_LENGTH else "")
                prompt_data["last_user_message_sample"] = truncated_msg
    
    add_breadcrumb(
        category="ai.prompt",
        message=f"AI prompt sent to {model}",
        data={
            "model": model,
            **prompt_data
        }
    )
