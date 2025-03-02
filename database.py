import ssl
import json
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from typing import AsyncGenerator
import config
from fastapi import Depends

# Import models from consolidated models.py
from models import Base

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
    json_serializer=lambda obj: json.dumps(obj, default=str),
    pool_size=20,
    max_overflow=10,
    pool_recycle=300
)

# Create a session maker for async sessions
AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

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
