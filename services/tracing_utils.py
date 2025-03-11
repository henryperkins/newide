"""
Utilities for distributed tracing and performance monitoring with Sentry.

Enhancements:
-------------
- Added 'log_args' parameter in trace_function for optional logging of function args/kwargs.
- Updated docstrings for clarity.
- Minor improvement to add_breadcrumb logger call.
"""
import asyncio
import functools
import inspect
import time
from typing import Optional, Dict, Any, Callable, TypeVar, cast
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
        description: Describes what’s being profiled.
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
