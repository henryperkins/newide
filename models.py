from sqlalchemy import Column, String, DateTime, Text, Boolean, Integer, ForeignKey, BigInteger, text, func
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
    id = Column(PGUUID, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_activity = Column(DateTime(timezone=True), server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_model = Column(String(50), nullable=True)
    # Renamed to avoid conflict with SQLAlchemy's reserved 'metadata'
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
# Conversations
# -------------------------------------------------------------------------
class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(PGUUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    # New field for storing formatted/rendered content with markdown/HTML
    formatted_content = Column(Text, nullable=True)
    # New field for storing the raw JSON response from the model
    raw_response = Column(JSONB, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    system_fingerprint = Column(String(64), nullable=True)
    model = Column(String(50), nullable=True)
    tracking_id = Column(String(64), nullable=True)  # Add tracking ID for model switch reliability
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

class User(Base):
    __tablename__ = 'users'
    id = Column(PGUUID, primary_key=True)
    email = Column(String(120), unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

# -------------------------------------------------------------------------
# Model Usage Stats
# -------------------------------------------------------------------------
class ModelUsageStats(Base):
    __tablename__ = "model_usage_stats"
    id = Column(Integer, primary_key=True, autoincrement=True)
    model = Column(String(50), nullable=False)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    prompt_tokens = Column(Integer, nullable=False)
    completion_tokens = Column(Integer, nullable=False)
    total_tokens = Column(Integer, nullable=False)
    reasoning_tokens = Column(Integer, nullable=True)  # Track o-series processing time
    cached_tokens = Column(Integer, nullable=True)
    content_analysis = Column(JSONB, nullable=True)  # Store DeepSeek's thinking process
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    # Renamed to avoid conflict with SQLAlchemy's reserved 'metadata'
    usage_metadata = Column(JSONB, nullable=True)
