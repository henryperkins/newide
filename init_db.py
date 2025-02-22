from sqlalchemy import create_engine, text
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
import config

async def init_database():
    """Initialize the database with required tables."""
    
    engine = create_async_engine(config.POSTGRES_URL)
    
    async with engine.begin() as conn:
        # Create sessions table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_model VARCHAR(50),
                metadata JSONB
            )
        """))

        # Create conversations table with model tracking
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                role VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                model VARCHAR(50),
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                metadata JSONB
            )
        """))

        # Create uploaded_files table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                filename VARCHAR(255) NOT NULL,
                content TEXT,
                status VARCHAR(50),
                chunk_count INTEGER,
                metadata JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create app_configurations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS app_configurations (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB NOT NULL,
                description TEXT,
                is_secret BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create model_usage_stats table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS model_usage_stats (
                id SERIAL PRIMARY KEY,
                model VARCHAR(50) NOT NULL,
                session_id UUID REFERENCES sessions(id),
                prompt_tokens INTEGER NOT NULL,
                completion_tokens INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                reasoning_tokens INTEGER,
                cached_tokens INTEGER,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                metadata JSONB
            )
        """))

        # Create indexes
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
            CREATE INDEX IF NOT EXISTS idx_conversations_model ON conversations(model);
            CREATE INDEX IF NOT EXISTS idx_uploaded_files_session_id ON uploaded_files(session_id);
            CREATE INDEX IF NOT EXISTS idx_model_usage_stats_model ON model_usage_stats(model);
            CREATE INDEX IF NOT EXISTS idx_model_usage_stats_session_id ON model_usage_stats(session_id);
            CREATE INDEX IF NOT EXISTS idx_model_usage_stats_timestamp ON model_usage_stats(timestamp);
        """))

        # Add any missing columns to existing tables
        try:
            await conn.execute(text("""
                ALTER TABLE conversations 
                ADD COLUMN IF NOT EXISTS model VARCHAR(50)
            """))
            
            await conn.execute(text("""
                ALTER TABLE sessions 
                ADD COLUMN IF NOT EXISTS last_model VARCHAR(50)
            """))
        except Exception as e:
            print(f"Error adding columns: {e}")

if __name__ == "__main__":
    asyncio.run(init_database())
