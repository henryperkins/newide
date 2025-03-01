from sqlalchemy import Column, String, DateTime, Text, Boolean, Integer, ForeignKey, BigInteger, text, func, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException

Base = declarative_base()

# -------------------------------------------------------------------------
# Sessions
# -------------------------------------------------------------------------
class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index('ix_sessions_created_at', 'created_at'),
        Index('ix_sessions_expires_at', 'expires_at'),
    )
    
    id = Column(PGUUID, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_activity = Column(DateTime(timezone=True), server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_model = Column(String(50), nullable=True)
    session_metadata = Column(JSONB, nullable=True)
    # Rate limiting columns
    request_count = Column(Integer, default=0, nullable=False)
    last_request = Column(DateTime(timezone=True), server_default=text("NOW()"))
    
    def check_rate_limit(self):
        """Check if session exceeds rate limit (10 requests/minute)"""
        if self.request_count >= 10:
            # Get timezone-aware current time
            now = datetime.now(timezone.utc)
            one_minute_ago = now - timedelta(minutes=1)

            # Force timezone-aware comparison
            if self.last_request and self.last_request.astimezone(timezone.utc) > one_minute_ago:
                reset_time = self.last_request + timedelta(minutes=1)
                seconds_remaining = int((reset_time - now).total_seconds())
                
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": "rate_limit_exceeded",
                        "message": "Rate limit exceeded: 10 requests per minute",
                        "retry_after": seconds_remaining
                    },
                    headers={"Retry-After": str(seconds_remaining)}
                )
        
        # Update rate limit counters
        now = datetime.now(timezone.utc)
        one_minute_ago = now - timedelta(minutes=1)
        
        if self.last_request and self.last_request.astimezone(timezone.utc) < one_minute_ago:
            # Reset counter if more than a minute has passed
            self.request_count = 1
        else:
            # Increment counter
            self.request_count += 1
            
        self.last_request = now
        return True

# -------------------------------------------------------------------------
# User Authentication
# -------------------------------------------------------------------------
class User(Base):
    __tablename__ = 'users'
    id = Column(PGUUID, primary_key=True)
    email = Column(String(120), unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

# -------------------------------------------------------------------------
# Conversations
# -------------------------------------------------------------------------
class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        Index('ix_conversations_session_id', 'session_id'),
        Index('ix_conversations_timestamp', 'timestamp'),
        Index('ix_conversations_model', 'model'),
        Index('ix_conversations_tracking_id', 'tracking_id'),
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(PGUUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    formatted_content = Column(Text, nullable=True)
    raw_response = Column(JSONB, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    system_fingerprint = Column(String(64), nullable=True)
    model = Column(String(50), nullable=True)
    tracking_id = Column(String(64), nullable=True)  # For model switch reliability
    # optional metadata columns
    prompt_filter_results = Column(JSONB, nullable=True)
    content_filter_results = Column(JSONB, nullable=True)
    model_version = Column(String(50), nullable=True)
    service_tier = Column(String(50), nullable=True)

# -------------------------------------------------------------------------
# Uploaded Files
# -------------------------------------------------------------------------
class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    __table_args__ = (
        Index('ix_uploaded_files_session_id', 'session_id'),
        Index('ix_uploaded_files_upload_time', 'upload_time'),
        Index('ix_uploaded_files_status', 'status'),
    )
    
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    filename = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    size = Column(BigInteger, nullable=False, server_default="0")
    upload_time = Column(DateTime(timezone=True), server_default=text("NOW()"))
    file_type = Column(String(50), nullable=True)
    status = Column(String(20), default="ready")
    chunk_count = Column(Integer, default=1)
    token_count = Column(Integer, nullable=True)
    embedding_id = Column(String(255), nullable=True)
    file_metadata = Column(JSONB, nullable=True)
    azure_status = Column(String(20), nullable=True)

# -------------------------------------------------------------------------
# Vector Stores
# -------------------------------------------------------------------------
class VectorStore(Base):
    __tablename__ = "vector_stores"
    __table_args__ = (
        Index('ix_vector_stores_session_id', 'session_id'),
        Index('ix_vector_stores_status', 'status'),
    )
    
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    azure_id = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    status = Column(String(20), default="active")
    file_metadata = Column(JSONB, nullable=True)

# -------------------------------------------------------------------------
# File Citations
# -------------------------------------------------------------------------
class FileCitation(Base):
    __tablename__ = "file_citations"
    __table_args__ = (
        Index('ix_file_citations_conversation_id', 'conversation_id'),
        Index('ix_file_citations_file_id', 'file_id'),
    )
    
    id = Column(PGUUID, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    file_id = Column(PGUUID, ForeignKey("uploaded_files.id", ondelete="SET NULL"), nullable=True)
    snippet = Column(Text, nullable=False)
    position = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    file_metadata = Column(JSONB, nullable=True)

# -------------------------------------------------------------------------
# App Configuration
# -------------------------------------------------------------------------
class AppConfiguration(Base):
    __tablename__ = "app_configurations"

    key = Column(String, primary_key=True)
    value = Column(JSONB, nullable=False)
    description = Column(Text, nullable=True)
    is_secret = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"), onupdate=text("NOW()"))

# -------------------------------------------------------------------------
# Model Usage Stats
# -------------------------------------------------------------------------
class ModelUsageStats(Base):
    __tablename__ = "model_usage_stats"
    __table_args__ = (
        Index('ix_model_usage_stats_model', 'model'),
        Index('ix_model_usage_stats_timestamp', 'timestamp'),
        Index('ix_model_usage_stats_session_model', 'session_id', 'model'),
        Index('ix_model_usage_stats_tracking_id', 'tracking_id'),
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    model = Column(String(50), nullable=False)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    prompt_tokens = Column(Integer, nullable=False)
    completion_tokens = Column(Integer, nullable=False)
    total_tokens = Column(Integer, nullable=False)
    reasoning_tokens = Column(Integer, nullable=True)  # Track o-series processing tokens
    cached_tokens = Column(Integer, nullable=True)     # Track cached tokens for efficiency
    content_analysis = Column(JSONB, nullable=True)    # Store DeepSeek thinking process
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    tracking_id = Column(String(64), nullable=True)    # Match with conversation tracking_id
    usage_metadata = Column(JSONB, nullable=True)

# -------------------------------------------------------------------------
# Model Transitions
# -------------------------------------------------------------------------
class ModelTransition(Base):
    __tablename__ = "model_transitions"
    __table_args__ = (
        Index('ix_model_transitions_session_id', 'session_id'),
        Index('ix_model_transitions_models', 'from_model', 'to_model'),
        Index('ix_model_transitions_timestamp', 'timestamp'),
        Index('ix_model_transitions_tracking_id', 'tracking_id'),
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    from_model = Column(String(50), nullable=True)  # Null for first model
    to_model = Column(String(50), nullable=False)
    tracking_id = Column(String(64), nullable=True)  # For correlation with conversations
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    success = Column(Integer, default=1)  # 1=success, 0=failed
    error_message = Column(Text, nullable=True) 
    duration_ms = Column(Integer, nullable=True)  # Time taken for switch
    transition_metadata = Column(JSONB, nullable=True)  # Additional switching metadata

# -------------------------------------------------------------------------
# Assistants
# -------------------------------------------------------------------------
class Assistant(Base):
    __tablename__ = "assistants"
    __table_args__ = (
        Index('ix_assistants_created_at', 'created_at'),
    )
    
    id = Column(String(255), primary_key=True)
    object = Column(String(50), default="assistant")
    created_at = Column(BigInteger, nullable=False)  # Unix timestamp
    name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    model = Column(String(255), nullable=False)
    instructions = Column(Text, nullable=True)
    tools = Column(JSONB, default=lambda: [])  # Default to empty array
    file_ids = Column(JSONB, default=lambda: [])  # Default to empty array
    assistant_metadata = Column(JSONB, nullable=True)  # Renamed from 'metadata' to avoid conflict