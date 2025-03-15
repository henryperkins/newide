from sqlalchemy import (
    Column,
    String,
    DateTime,
    Text,
    Boolean,
    Integer,
    ForeignKey,
    BigInteger,
    text,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException

Base = declarative_base()


# -------------------------------------------------------------------------
# Sessions
# -------------------------------------------------------------------------
from sqlalchemy.orm import relationship

class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_created_at", "created_at"),
        Index("ix_sessions_expires_at", "expires_at"),
        Index("ix_sessions_activity", "last_activity"),
    )

    conversations = relationship(
        "Conversation",
        backref="session_obj",
        cascade="all, delete-orphan",
        passive_deletes=True
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
        """
        Tiered rate limit via a token bucket approach.
        Adjust default/burst per model or user tier.
        """
        now = datetime.now(timezone.utc)
        default_limit = 20  # req/min
        burst_limit = 5
        if self.last_model and "o1" in self.last_model.lower():
            default_limit = 5
            burst_limit = 1

        if not hasattr(self, "token_bucket") or self.token_bucket is None:
            self.token_bucket = float(burst_limit)

        if self.last_request:
            elapsed = (now - self.last_request).total_seconds()
        else:
            elapsed = 60  # assume full refill if first time

        refill_rate = default_limit / 60.0
        self.token_bucket = min(
            self.token_bucket + elapsed * refill_rate,
            float(burst_limit)
        )

        if self.token_bucket < 1.0:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": "Tiered rate limit exceeded",
                    "retry_after": 60,
                },
                headers={"Retry-After": "60"},
            )

        self.token_bucket -= 1.0
        self.last_request = now
        return True


# -------------------------------------------------------------------------
# User Authentication
# -------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"
    id = Column(PGUUID, primary_key=True)
    email = Column(String(120), unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    requires_password_reset = Column(Boolean, default=False)
    password_reset_reason = Column(String)


# -------------------------------------------------------------------------
# Conversations
# -------------------------------------------------------------------------
class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        Index("ix_conversations_session_id", "session_id"),
        Index("ix_conversations_timestamp", "timestamp"),
        Index("ix_conversations_model", "model"),
        Index("ix_conversations_tracking_id", "tracking_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(
        PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(PGUUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    formatted_content = Column(
        Text,
        nullable=True,
        comment="Sanitized HTML content with CSP restrictions",
        info={
            "check": "formatted_content IS NULL OR formatted_content ~ '^[a-zA-Z0-9<>&; ]+$'"
        },
    )
    pinned = Column(Boolean, default=False, nullable=False)
    archived = Column(Boolean, default=False, nullable=False)
    title = Column(String(200), default=None, nullable=True)

    raw_response = Column(
        JSONB,
        nullable=True,
        comment="Trimmed response metadata only",
        info={"check": "octet_length(raw_response::text) < 1024"},
    )
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    system_fingerprint = Column(String(64), nullable=True)
    model = Column(String(50), nullable=True)
    tracking_id = Column(String(64), nullable=True)  # For model switch reliability
    # optional metadata columns
    prompt_filter_results = Column(JSONB, nullable=True)
    content_filter_results = Column(JSONB, nullable=True)
    model_version = Column(String(50), nullable=True)
    service_tier = Column(String(50), nullable=True)
    # Add version column for optimistic locking
    version = Column(Integer, default=1, nullable=False)

class ConversationSession(Base):
    __tablename__ = "conversation_sessions"
    session_id = Column(PGUUID, ForeignKey("sessions.id"), primary_key=True)
    conversation_id = Column(PGUUID, ForeignKey("conversations.id"), primary_key=True)
    context_snapshot = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


# -------------------------------------------------------------------------
# Uploaded Files
# -------------------------------------------------------------------------
class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    __table_args__ = (
        Index("ix_uploaded_files_session_id", "session_id"),
        Index("ix_uploaded_files_upload_time", "upload_time"),
        Index("ix_uploaded_files_status", "status"),
    )

    id = Column(PGUUID, primary_key=True)
    session_id = Column(
        PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
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

class ConversationHistory(Base):
    __tablename__ = "conversation_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"))
    content = Column(Text, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    valid_from = Column(DateTime(timezone=True), server_default=text("NOW()"))
    valid_to = Column(DateTime(timezone=True), nullable=True)
    azure_status = Column(String(20), nullable=True)


# -------------------------------------------------------------------------
# Vector Stores
# -------------------------------------------------------------------------
class VectorStore(Base):
    __tablename__ = "vector_stores"
    __table_args__ = (
        Index("ix_vector_stores_session_id", "session_id"),
        Index("ix_vector_stores_status", "status"),
    )

    id = Column(PGUUID, primary_key=True)
    session_id = Column(
        PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
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
        Index("ix_file_citations_conversation_id", "conversation_id"),
        Index("ix_file_citations_file_id", "file_id"),
    )

    id = Column(PGUUID, primary_key=True)
    conversation_id = Column(
        Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    file_id = Column(
        PGUUID, ForeignKey("uploaded_files.id", ondelete="SET NULL"), nullable=True
    )
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
    updated_at = Column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=text("NOW()")
    )


# -------------------------------------------------------------------------
# Model Usage Stats
# -------------------------------------------------------------------------
class ModelUsageStats(Base):
    __tablename__ = "model_usage_stats"
    __table_args__ = (
        Index("ix_model_usage_stats_model", "model"),
        Index("ix_model_usage_stats_timestamp", "timestamp"),
        Index("ix_model_usage_stats_session_model", "session_id", "model"),
        Index("ix_model_usage_stats_tracking_id", "tracking_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    model = Column(String(50), nullable=False)
    model_type = Column(String(20), nullable=False)  # 'deepseek' or 'o_series'
    session_id = Column(
        PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True
    )
    prompt_tokens = Column(Integer, nullable=False)
    completion_tokens = Column(Integer, nullable=False)
    total_tokens = Column(Integer, nullable=False)
    deepseek_specific_tokens = Column(Integer, nullable=True)
    o_series_specific_tokens = Column(Integer, nullable=True)
    o_series_effort = Column(String(20), nullable=True)  # Only O-series
    deepseek_thoughts = Column(Integer, nullable=True)  # Count of thinking blocks
    cached_tokens = Column(Integer, nullable=True)  # For token caching stats
    active_tokens = Column(Integer, nullable=True)  # Non-cached tokens
    token_details = Column(JSONB, nullable=True)  # Full token details from response
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    tracking_id = Column(String(64), nullable=True)
    model_metadata = Column(JSONB, nullable=True)  # Consolidated metadata column
    usage_metadata = Column(JSONB, nullable=True)  # Added from schema warnings
    reasoning_tokens = Column(Integer, nullable=True)
    extra_metadata = Column(JSONB, nullable=True)  # Added from schema warnings


# -------------------------------------------------------------------------
# Model Transitions
# -------------------------------------------------------------------------
class ModelTransition(Base):
    __tablename__ = "model_transitions"
    __table_args__ = (
        Index("ix_model_transitions_session_id", "session_id"),
        Index("ix_model_transitions_models", "from_model", "to_model"),
        Index("ix_model_transitions_timestamp", "timestamp"),
        Index("ix_model_transitions_tracking_id", "tracking_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(
        PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    from_model = Column(String(50), nullable=True)  # Null for first model
    to_model = Column(String(50), nullable=False)
    tracking_id = Column(
        String(64), nullable=True
    )  # For correlation with conversations
    timestamp = Column(
        DateTime(timezone=True), server_default=text("NOW()"), index=True
    )
    success = Column(Integer, default=1)  # 1=success, 0=failed
    # Add server-side timestamp for ordering
    server_created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    error_message = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)  # Time taken for switch
    transition_metadata = Column(JSONB, nullable=True)  # Additional switching metadata
    extra_metadata = Column(JSONB, nullable=True)  # Add missing metadata column


# -------------------------------------------------------------------------
# Assistants
# -------------------------------------------------------------------------
class Assistant(Base):
    __tablename__ = "assistants"
    __table_args__ = (Index("ix_assistants_created_at", "created_at"),)

    id = Column(String(255), primary_key=True)
    object = Column(String(50), default="assistant")
    created_at = Column(BigInteger, nullable=False)  # Unix timestamp
    name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    model = Column(String(255), nullable=False)
    instructions = Column(Text, nullable=True)
    tools = Column(JSONB, default=lambda: [])  # Default to empty array
    file_ids = Column(JSONB, default=lambda: [])  # Default to empty array
    assistant_metadata = Column(
        JSONB, nullable=True
    )  # Renamed from 'metadata' to avoid conflict
