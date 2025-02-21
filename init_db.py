import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import config

async def init_database():
    """Initialize the database and create tables"""
    engine = create_async_engine(config.POSTGRES_URL)
    
    try:
        async with engine.begin() as conn:
            # Create sessions table
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id UUID PRIMARY KEY,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    last_activity TIMESTAMPTZ DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL
                );"""))

        async with engine.begin() as conn:
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
                );"""))

        async with engine.begin() as conn:
            # Create enhanced uploaded_files table
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
                );"""))

        async with engine.begin() as conn:
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
                );"""))

        async with engine.begin() as conn:
            # Create file_citations table
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS file_citations (
                    id UUID PRIMARY KEY,
                    conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
                    file_id UUID REFERENCES uploaded_files(id) ON DELETE CASCADE,
                    citation_text TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );"""))

        async with engine.begin() as conn:
            # Create typing_activity table
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS typing_activity (
                    session_id UUID REFERENCES sessions(id),
                    user_id UUID NOT NULL,
                    last_activity TIMESTAMPTZ DEFAULT NOW(),
                    PRIMARY KEY (session_id, user_id)
                );"""))

        print("✅ Database tables created successfully!")
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(init_database())