"""
Utilities for distributed tracing and performance monitoring with Sentry.
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

def trace_function(op: str, name: Optional[str] = None, **tags: str) -> Callable[[F], F]:
    """
    Decorator to trace a function with Sentry.
    
    Args:
        op: The operation type for the span
        name: Optional custom name for the span (defaults to function name)
        tags: Additional tags to add to the span
        
    Returns:
        Decorated function
    """
    def decorator(func: F) -> F:
        func_name = name or func.__name__
        
        # Get function file and line number for source code context
        source_file = inspect.getsourcefile(func)
        source_line = inspect.getsourcelines(func)[1]
        
        # Check if the function is async
        is_async = asyncio.iscoroutinefunction(func)
        
        if is_async:
            # Async wrapper for coroutine functions
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                with sentry_sdk.start_span(op=op, description=func_name) as span:
                    # Add source code context
                    if source_file:
                        span.set_data("code.filepath", source_file)
                        span.set_data("code.lineno", source_line)
                        span.set_data("code.function", func.__name__)
                        span.set_data("code.namespace", func.__module__)
                    
                    # Add custom tags
                    for tag_key, tag_value in tags.items():
                        span.set_tag(tag_key, tag_value)
                    
                    start_time = time.time()
                    try:
                        result = await func(*args, **kwargs)  # Use await here
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
            # Synchronous wrapper for regular functions
            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                with sentry_sdk.start_span(op=op, description=func_name) as span:
                    # Add source code context
                    if source_file:
                        span.set_data("code.filepath", source_file)
                        span.set_data("code.lineno", source_line)
                        span.set_data("code.function", func.__name__)
                        span.set_data("code.namespace", func.__module__)
                    
                    # Add custom tags
                    for tag_key, tag_value in tags.items():
                        span.set_tag(tag_key, tag_value)
                    
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
        query_type: Type of database query (e.g., 'select', 'insert', 'update')
        
    Returns:
        Decorated function
    """
    return trace_function(op="db.query", name=f"db.{query_type}", db_operation=query_type)

def trace_http_request(method: str, url_pattern: str) -> Callable[[F], F]:
    """
    Specialized decorator for tracing HTTP requests.
    
    Args:
        method: HTTP method (GET, POST, etc.)
        url_pattern: Pattern of the URL being requested
        
    Returns:
        Decorated function
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
        operation: Type of file operation (read, write, delete)
        
    Returns:
        Decorated function
    """
    return trace_function(op="file.operation", name=f"file.{operation}")

@contextmanager
def trace_block(description: str, op: str, **data: Any):
    """
    Context manager for tracing a block of code.
    
    Args:
        description: Description of the operation
        op: Operation type
        data: Additional data to add to the span
        
    Yields:
        The Sentry span
    """
    with sentry_sdk.start_span(op=op, description=description) as span:
        # Set span data
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
    Context manager for profiling a block of code.
    
    Args:
        description: Description of the operation
        op: Operation type
        data: Additional data to add to the span
        
    Yields:
        The Sentry span
    """
    with sentry_sdk.start_span(op=op, description=description) as span:
        # Set span data
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
    Create a new transaction for a logical operation.
    
    Args:
        name: Transaction name
        op: Operation type
        data: Additional data for the transaction
        
    Returns:
        The Sentry transaction
    """
    transaction = sentry_sdk.start_transaction(name=name, op=op)
    
    # Set transaction data
    for key, value in data.items():
        transaction.set_data(key, value)
    
    # Set as current transaction
    sentry_sdk.Hub.current.scope.transaction = transaction
    
    return transaction

def set_user_context(user_id: Optional[str] = None, username: Optional[str] = None, 
                    email: Optional[str] = None, **extra_data: Any):
    """
    Set user context for Sentry events.
    
    Args:
        user_id: User ID
        username: Username
        email: User email
        extra_data: Additional user data
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
    
    logger.debug(f"Set Sentry user context: {user_id or 'anonymous'}")

def add_breadcrumb(category: str, message: str, level: str = "info", **data: Any):
    """
    Add a breadcrumb to the current Sentry scope.
    
    Args:
        category: Breadcrumb category
        message: Breadcrumb message
        level: Breadcrumb level (debug, info, warning, error, critical)
        data: Additional data for the breadcrumb
    """
    sentry_sdk.add_breadcrumb(
        category=category,
        message=message,
        level=level,
        data=data
    )
    
    # Also log to the application logger if level is warning or higher
    if level in ("warning", "error", "critical"):
        log_level = getattr(logger, level)
        log_level(message, extra=data)
