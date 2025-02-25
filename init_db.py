from sqlalchemy import create_engine, text
import asyncio
import ssl
from sqlalchemy.ext.asyncio import create_async_engine
import config

async def init_database():
    """Initialize the database with required tables."""
    
    # Create proper SSL context with certificate verification
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = True
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
    
    engine = create_async_engine(
        config.POSTGRES_URL,
        connect_args={"ssl": ssl_context}
    )
    
    async with engine.begin() as conn:
        # Create sessions table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE,
                last_model VARCHAR(50),
                session_metadata JSONB
            )
        """))

        # Create users table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY,
                email VARCHAR(120) UNIQUE NOT NULL,
                hashed_password VARCHAR NOT NULL,
                is_active BOOLEAN DEFAULT TRUE
            )
        """))

        # Create conversations table with model tracking
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                system_fingerprint VARCHAR(64),
                model VARCHAR(50),
                prompt_filter_results JSONB,
                content_filter_results JSONB,
                model_version VARCHAR(50),
                service_tier VARCHAR(50)
            )
        """))

        # Create uploaded_files table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                size BIGINT NOT NULL DEFAULT 0,
                upload_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                file_type VARCHAR(50),
                status VARCHAR(20) DEFAULT 'ready',
                chunk_count INTEGER DEFAULT 1,
                token_count INTEGER,
                embedding_id VARCHAR(255),
                file_metadata JSONB,
                azure_status VARCHAR(20)
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
                usage_metadata JSONB
            )
        """))

        # First add any missing columns, then create indexes
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
        
        # Now create indexes
        index_statements = [
            "CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp)",
            "CREATE INDEX IF NOT EXISTS idx_conversations_model ON conversations(model)",
            "CREATE INDEX IF NOT EXISTS idx_uploaded_files_session_id ON uploaded_files(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_model ON model_usage_stats(model)",
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_session_id ON model_usage_stats(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_timestamp ON model_usage_stats(timestamp)"
        ]
        
        for stmt in index_statements:
            await conn.execute(text(stmt))
        
        # Insert model configuration in the format expected by ClientPool
        import json
        import os
        
        # Create a model_configs entry with o1hp as a key
        model_configs = {
            "o1hp": {
                "name": "o1hp",
                "description": "Azure OpenAI o1 high performance model",
                "max_tokens": 40000, 
                "supports_streaming": False, 
                "supports_temperature": False, 
                "base_timeout": 120.0, 
                "max_timeout": 300.0,
                "token_factor": 0.05,
                "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview"),
                "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
                "api_key": ""  # Never store API keys in database
            }
        }
        
        await conn.execute(text("""
            INSERT INTO app_configurations (key, value, description, is_secret)
            VALUES (
                'model_configs',
                :config_value,
                'Azure OpenAI model configurations',
                true
            )
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                description = EXCLUDED.description,
                is_secret = EXCLUDED.is_secret
        """), {"config_value": json.dumps(model_configs)})

if __name__ == "__main__":
    asyncio.run(init_database())
