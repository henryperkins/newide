# database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, BigInteger, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy import text
from fastapi import Depends
import config

# Create the async database engine
engine = create_async_engine(
    config.POSTGRES_URL,
    pool_size=20,
    max_overflow=10,
    pool_recycle=3600
)

# Create a session maker for async sessions
AsyncSessionLocal = sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
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
        Index('ix_conversations_session_id', 'session_id'),
        Index('ix_conversations_timestamp', 'timestamp'),
        Index('ix_conversations_session_timestamp', 'session_id', 'timestamp')
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id", ondelete='CASCADE'), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"))

class UploadedFile(Base):
    """ORM model for uploaded files."""
    __tablename__ = "uploaded_files"
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id"), nullable=False)
    filename = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    size = Column(BigInteger, nullable=False)
    upload_time = Column(DateTime(timezone=True), server_default=text("NOW()"))

async def get_db_session() -> AsyncSession:
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
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )"""))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )"""))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                size BIGINT NOT NULL,
                upload_time TIMESTAMPTZ DEFAULT NOW()
            )"""))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS typing_activity (
                session_id UUID REFERENCES sessions(id),
                user_id UUID NOT NULL,
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (session_id, user_id)
            )"""))
