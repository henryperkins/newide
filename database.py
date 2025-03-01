import ssl
import json
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, BigInteger, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy import text
from fastapi import Depends
import config
from typing import AsyncGenerator

# Create an SSL context for Azure Database for PostgreSQL
ssl_context = ssl.create_default_context()
ssl_context.verify_mode = ssl.CERT_REQUIRED
ssl_context.check_hostname = True

# Load the root certificate
try:
    ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
except Exception as e:
    raise RuntimeError(f"Failed to load SSL certificate: {e}")

# Construct PostgreSQL connection URL with proper SSL mode
POSTGRES_URL = (
    f"postgresql+asyncpg://{config.settings.POSTGRES_USER}:{config.settings.POSTGRES_PASSWORD}"
    f"@{config.settings.POSTGRES_HOST}:{config.settings.POSTGRES_PORT}/{config.settings.POSTGRES_DB}?ssl=true"
)

# Create async engine with SSL context
engine = create_async_engine(
    POSTGRES_URL,
    connect_args={
        "ssl": ssl_context
    },
    json_serializer=lambda obj: json.dumps(obj, default=str)
)

# Create a session maker for async sessions
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

# Base class for ORM models
Base = declarative_base()

class SessionModel(Base):
    """ORM model for user sessions. (Renamed to avoid overshadowing)"""
    __tablename__ = "sessions"
    id = Column(PGUUID, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_activity = Column(DateTime(timezone=True), server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Track model preferences and transitions
    last_model = Column(String(50), nullable=True)
    session_metadata = Column(JSONB, nullable=True)
    request_count = Column(Integer, default=0)
    last_request = Column(DateTime(timezone=True), server_default=text("NOW()"))

class Conversation(Base):
    """ORM model for conversation messages."""
    __tablename__ = "conversations"
    __table_args__ = (
        Index('ix_conversations_session_timestamp', 'session_id', 'timestamp'),
        Index('ix_conversations_model', 'model'),  # Index by model for analytics
        Index('ix_conversations_tracking_id', 'tracking_id'),  # Index for tracking model transitions
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=False)
    user_id = Column(PGUUID, ForeignKey("users.id", ondelete='SET NULL'), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    formatted_content = Column(Text, nullable=True)
    raw_response = Column(JSONB, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    system_fingerprint = Column(String(64), nullable=True)
    model = Column(String(50), nullable=True)
    tracking_id = Column(String(64), nullable=True)  # For tracking model transitions
    prompt_filter_results = Column(JSONB, nullable=True)
    content_filter_results = Column(JSONB, nullable=True)
    model_version = Column(String(50), nullable=True)
    service_tier = Column(String(50), nullable=True)

class UploadedFile(Base):
    """Enhanced ORM model for uploaded files."""
    __tablename__ = "uploaded_files"
    
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=False)
    filename = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    size = Column(BigInteger, nullable=False)
    upload_time = Column(DateTime(timezone=True), server_default=text("NOW()"))
    
    # New fields for enhanced file handling
    file_type = Column(String(50))  # MIME type or file extension
    status = Column(String(20), default="ready")  # ready, processing, error, chunk
    chunk_count = Column(Integer, default=1)  # Number of chunks for large files
    token_count = Column(Integer)  # Estimated token count
    embedding_id = Column(String(255), nullable=True)  # For vector store reference
    file_metadata = Column(JSONB, nullable=True)  # Renamed from metadata
    azure_status = Column(String(20), nullable=True)  # Status of Azure processing

class VectorStore(Base):
    """ORM model for vector stores."""
    __tablename__ = "vector_stores"
    
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=False)
    name = Column(Text, nullable=False)
    azure_id = Column(String(255), nullable=True)  # Azure vector store ID
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    status = Column(String(20), default="active")
    file_metadata = Column(JSONB, nullable=True)  # Renamed from metadata

class FileCitation(Base):
    """ORM model for file citations in conversation."""
    __tablename__ = "file_citations"

    id = Column(PGUUID, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete='CASCADE'), nullable=False)
    file_id = Column(PGUUID, ForeignKey("uploaded_files.id", ondelete='SET NULL'), nullable=True)
    snippet = Column(Text, nullable=False)  # The cited text
    position = Column(Integer)  # Citation position/index
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    file_metadata = Column(JSONB, nullable=True)  # Renamed from metadata

class ModelUsageStats(Base):
    """ORM model for tracking model usage statistics."""
    __tablename__ = "model_usage_stats"
    __table_args__ = (
        Index('ix_model_usage_stats_model', 'model'),
        Index('ix_model_usage_stats_timestamp', 'timestamp'),
        Index('ix_model_usage_stats_session_model', 'session_id', 'model'),
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    model = Column(String(50), nullable=False)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=True)
    prompt_tokens = Column(Integer, nullable=False)
    completion_tokens = Column(Integer, nullable=False)
    total_tokens = Column(Integer, nullable=False)
    reasoning_tokens = Column(Integer, nullable=True)  # Track o-series processing tokens
    cached_tokens = Column(Integer, nullable=True)     # Track cached tokens for efficiency
    content_analysis = Column(JSONB, nullable=True)    # Store DeepSeek thinking process
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    # Track model transition events
    tracking_id = Column(String(64), nullable=True)    # Match with conversation tracking_id
    usage_metadata = Column(JSONB, nullable=True)
    
class ModelTransition(Base):
    """New ORM model for tracking model switching events."""
    __tablename__ = "model_transitions"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=False)
    from_model = Column(String(50), nullable=True)  # Null for first model
    to_model = Column(String(50), nullable=False)
    tracking_id = Column(String(64), nullable=True)  # For correlation with conversations
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    success = Column(Integer, default=1)  # 1=success, 0=failed
    error_message = Column(Text, nullable=True) 
    duration_ms = Column(Integer, nullable=True)  # Time taken for switch
    transition_metadata = Column(JSONB, nullable=True)  # Additional switching metadata

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to provide an async database session.

    Yields:
        AsyncSession: An async database session.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
