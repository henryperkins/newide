from sqlalchemy import Column, String, DateTime, Text, Boolean, Integer, ForeignKey, BigInteger, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.ext.declarative import declarative_base

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
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    system_fingerprint = Column(String(64), nullable=True)
    model = Column(String(50), nullable=True)
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
    reasoning_tokens = Column(Integer, nullable=True)
    cached_tokens = Column(Integer, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    # Renamed to avoid conflict with SQLAlchemy's reserved 'metadata'
    usage_metadata = Column(JSONB, nullable=True)
