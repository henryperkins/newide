"""Database connection configuration for the application using asyncio PostgreSQL driver."""

# Standard library imports
import ssl
import json
import time
from typing import AsyncGenerator, Optional, Dict, Any, Type, TypeVar, cast
from contextlib import asynccontextmanager
import functools

# Third-party imports
from fastapi import Depends
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import Select, Insert, Update, Delete
from sqlalchemy import text, event
import sentry_sdk

# Local imports
import config
from models import Base
from logging_config import get_logger

# Setup module logger
logger = get_logger(__name__)

# Type variables
T = TypeVar('T', bound=DeclarativeBase)

# Create an SSL context for Azure Database for PostgreSQL
ssl_context = ssl.create_default_context()
ssl_context.verify_mode = ssl.CERT_REQUIRED
ssl_context.check_hostname = True

# Load the root certificate
try:
    ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
except Exception as e:
    error_msg = f"Failed to load SSL certificate: {e}"
    logger.error(error_msg)
    sentry_sdk.capture_exception(e)
    raise RuntimeError(error_msg) from e

# Construct PostgreSQL connection URL with proper SSL mode
POSTGRES_URL = (
    f"postgresql+asyncpg://{config.settings.POSTGRES_USER}:{config.settings.POSTGRES_PASSWORD}"
    f"@{config.settings.POSTGRES_HOST}:{config.settings.POSTGRES_PORT}/"
    f"{config.settings.POSTGRES_DB}?ssl=true"
)

# Create async engine with SSL context
engine = create_async_engine(
    POSTGRES_URL,
    connect_args={"ssl": ssl_context},
    json_serializer=lambda obj: json.dumps(obj, default=str),
    pool_size=15,
    max_overflow=5,
    pool_recycle=180,
    pool_pre_ping=True,
    pool_timeout=30
)

# Create a session maker for async sessions
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

# Setup Sentry DB tracing
@event.listens_for(engine.sync_engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """
    SQLAlchemy event hook that captures query timing and creates Sentry spans.
    """
    # Store execution start time in the connection info
    conn.info.setdefault("query_start_time", []).append(time.time())
    
    # Get operation type from the statement
    operation = statement.split()[0].lower() if statement else "unknown"
    
    # Create a Sentry span for this query
    span = sentry_sdk.start_span(
        op="db.query",
        description=f"db.{operation}"
    )
    
    # Store the span in the connection info
    conn.info.setdefault("sentry_spans", []).append(span)
    
    # Set span data
    span.set_data("db.system", "postgresql")
    span.set_data("db.name", config.settings.POSTGRES_DB)
    span.set_data("db.operation", operation)
    span.set_data("server.address", config.settings.POSTGRES_HOST)
    span.set_data("server.port", config.settings.POSTGRES_PORT)
    
    # Add a truncated version of the statement for debugging
    if len(statement) > 1000:
        statement_truncated = statement[:1000] + "..."
    else:
        statement_truncated = statement
    
    span.set_data("db.statement", statement_truncated)
    
    # Add breadcrumb for query
    sentry_sdk.add_breadcrumb(
        category="db",
        message=f"DB Query: {operation}",
        level="info"
    )

@event.listens_for(engine.sync_engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """
    SQLAlchemy event hook that captures query result and completion time.
    """
    # Get execution time
    start_time = conn.info["query_start_time"].pop()
    execution_time = time.time() - start_time
    
    # Get the span
    span = conn.info["sentry_spans"].pop()
    
    # Set execution time
    span.set_data("duration_seconds", execution_time)
    
    # Get result info for SELECT queries
    if statement.strip().upper().startswith("SELECT"):
        try:
            row_count = cursor.rowcount
            span.set_data("db.rows_affected", row_count)
        except:
            pass
    
    # Finish the span
    span.finish()
    
    # Log slow queries
    if execution_time > 0.5:  # 500ms threshold for slow queries
        logger.warning(
            f"Slow database query took {execution_time:.4f}s",
            extra={
                "execution_time": execution_time,
                "query": statement[:100] + "..." if len(statement) > 100 else statement
            }
        )

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to provide an async database session with Sentry tracing.

    Yields:
        AsyncSession: An async database session.
    """
    with sentry_sdk.start_span(op="db.session", description="Database Session"):
        async with AsyncSessionLocal() as session:
            try:
                yield session
            except Exception as e:
                # Capture database errors
                sentry_sdk.capture_exception(e)
                logger.error(f"Database session error: {str(e)}")
                raise
            finally:
                await session.close()

# Helper for tracing database operations
@asynccontextmanager
async def traced_session():
    """
    Context manager that provides a database session with automatic Sentry tracing.
    
    Example:
        async with traced_session() as session:
            result = await session.execute(query)
    """
    transaction = sentry_sdk.start_transaction(
        name="database_operation",
        op="db"
    )
    
    try:
        async with AsyncSessionLocal() as session:
            sentry_sdk.add_breadcrumb(
                category="db",
                message="Database session started",
                level="info"
            )
            yield session
            transaction.set_data("success", True)
    except Exception as e:
        transaction.set_data("success", False)
        transaction.set_data("error.type", e.__class__.__name__)
        transaction.set_data("error.message", str(e))
        sentry_sdk.capture_exception(e)
        logger.error(f"Database error: {str(e)}")
        raise
    finally:
        transaction.finish()
        
# Enhanced database operations with tracing
async def traced_execute(session: AsyncSession, statement, params=None):
    """
    Execute a SQL statement with Sentry tracing.
    
    Args:
        session: SQLAlchemy session
        statement: SQL statement to execute
        params: Parameter values
        
    Returns:
        Result of the execution
    """
    operation = statement.split()[0].lower() if isinstance(statement, str) else "unknown"
    
    with sentry_sdk.start_span(op="db.execute", description=f"db.{operation}") as span:
        start_time = time.time()
        try:
            result = await session.execute(statement, params)
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