import ssl
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
    }
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

class Session(Base):
    """ORM model for user sessions."""
    __tablename__ = "sessions"
    id = Column(PGUUID, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_activity = Column(DateTime(timezone=True), server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)

class Conversation(Base):
    """ORM model for conversation messages."""
    __tablename__ = "conversations"
    __table_args__ = (
        Index('ix_conversations_session_timestamp', 'session_id', 'timestamp'),
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=False)
    user_id = Column(PGUUID, ForeignKey("users.id", ondelete='SET NULL'), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))
    system_fingerprint = Column(String(64))
    model = Column(String(50), nullable=True)
    prompt_filter_results = Column(JSONB)
    content_filter_results = Column(JSONB)
    model_version = Column(String(50))  # Stores the model version from API response
    service_tier = Column(String(50))   # Stores the service tier from API response

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


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to provide an async database session.

    Yields:
        AsyncSession: An async database session.
    """
    async with AsyncSessionLocal() as session:
        yield session

async def init_database():
    """Initialize the database by creating necessary tables if they don't exist."""
    async with engine.begin() as conn:
        # Drop existing tables to ensure clean slate
        # Remove destructive DROP TABLE commands
        pass  # Let Alembic handle migrations in production
        
        # Create sessions table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )"""))
        
        # Create conversations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                system_fingerprint VARCHAR(64),
                prompt_filter_results JSONB,
                content_filter_results JSONB,
                model_version VARCHAR(50),
                service_tier VARCHAR(50)
            )"""))
        
        # Create uploaded_files table with enhanced fields
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                size BIGINT NOT NULL,
                upload_time TIMESTAMPTZ DEFAULT NOW(),
                file_type VARCHAR(50),
                status VARCHAR(20) DEFAULT 'ready',
                chunk_count INTEGER DEFAULT 1,
                token_count INTEGER,
                embedding_id VARCHAR(255),
                file_metadata JSONB,
                azure_status VARCHAR(20)
            )"""))
        
        # Create vector_stores table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vector_stores (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                azure_id VARCHAR(255),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                status VARCHAR(20) DEFAULT 'active',
                file_metadata JSONB
            )"""))
        
        # Create file_citations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS file_citations (
                id UUID PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
                file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
                snippet TEXT NOT NULL,
                position INTEGER,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                file_metadata JSONB
            )"""))
        
        # Create indexes
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_uploaded_files_session_id 
            ON uploaded_files(session_id)"""))
        
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_uploaded_files_status
            ON uploaded_files(status)"""))
        
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_file_citations_conversation_id
            ON file_citations(conversation_id)"""))
