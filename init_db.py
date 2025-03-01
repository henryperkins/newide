import asyncio
import ssl
import json
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import config
from database import engine

async def init_database():
    """Initialize the database with required tables."""
    
    # Create proper SSL context with certificate verification
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = True
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
    
    async with engine.begin() as conn:
        # Create sessions table with improved model tracking
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE,
                last_model VARCHAR(50),
                session_metadata JSONB,
                request_count INTEGER DEFAULT 0,
                last_request TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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

        # Create conversations table with better model tracking
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                formatted_content TEXT,
                raw_response JSONB,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                system_fingerprint VARCHAR(64),
                model VARCHAR(50),
                tracking_id VARCHAR(64),
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

        # Create vector_stores table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vector_stores (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                azure_id VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                file_metadata JSONB
            )
        """))

        # Create file_citations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS file_citations (
                id UUID PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
                file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
                snippet TEXT NOT NULL,
                position INTEGER,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                file_metadata JSONB
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

        # Create model_usage_stats table with improved tracking
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS model_usage_stats (
                id SERIAL PRIMARY KEY,
                model VARCHAR(50) NOT NULL,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                prompt_tokens INTEGER NOT NULL,
                completion_tokens INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                reasoning_tokens INTEGER,
                cached_tokens INTEGER,
                content_analysis JSONB,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                tracking_id VARCHAR(64),
                usage_metadata JSONB
            )
        """))
        
        # Create model_transitions table for tracking model switches
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS model_transitions (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                from_model VARCHAR(50),
                to_model VARCHAR(50) NOT NULL,
                tracking_id VARCHAR(64),
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                success INTEGER DEFAULT 1,
                error_message TEXT,
                duration_ms INTEGER,
                transition_metadata JSONB
            )
        """))

        # Create assistants table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS assistants (
                id VARCHAR(255) PRIMARY KEY,
                object VARCHAR(50) DEFAULT 'assistant',
                created_at BIGINT NOT NULL,
                name VARCHAR(255),
                description TEXT,
                model VARCHAR(255) NOT NULL,
                instructions TEXT,
                tools JSONB DEFAULT '[]'::jsonb,
                file_ids JSONB DEFAULT '[]'::jsonb,
                metadata JSONB
            )
        """))

        # First add any missing columns, then create indexes
        try:
            # Add tracking_id to conversations if not exists
            await conn.execute(text("""
                ALTER TABLE conversations
                ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(64)
            """))
            
            # Add content_analysis to model_usage_stats if not exists
            await conn.execute(text("""
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS content_analysis JSONB
            """))
            
            # Add tracking_id to model_usage_stats if not exists
            await conn.execute(text("""
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(64)
            """))
            
            # Add created_at and updated_at to app_configurations if not exists
            await conn.execute(text("""
                ALTER TABLE app_configurations
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            """))
            
            await conn.execute(text("""
                ALTER TABLE app_configurations
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            """))
        except Exception as e:
            print(f"Error adding columns: {e}")
        
        # Create all needed indexes
        index_statements = [
            # Sessions indexes
            "CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
            
            # Conversations indexes
            "CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp)",
            "CREATE INDEX IF NOT EXISTS idx_conversations_model ON conversations(model)",
            "CREATE INDEX IF NOT EXISTS idx_conversations_tracking_id ON conversations(tracking_id)",
            
            # Uploaded files indexes
            "CREATE INDEX IF NOT EXISTS idx_uploaded_files_session_id ON uploaded_files(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_uploaded_files_upload_time ON uploaded_files(upload_time)",
            "CREATE INDEX IF NOT EXISTS idx_uploaded_files_status ON uploaded_files(status)",
            
            # Vector stores indexes
            "CREATE INDEX IF NOT EXISTS idx_vector_stores_session_id ON vector_stores(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_vector_stores_status ON vector_stores(status)",
            
            # File citations indexes
            "CREATE INDEX IF NOT EXISTS idx_file_citations_conversation_id ON file_citations(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_file_citations_file_id ON file_citations(file_id)",
            
            # Model usage stats indexes
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_model ON model_usage_stats(model)",
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_session_id ON model_usage_stats(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_timestamp ON model_usage_stats(timestamp)",
            "CREATE INDEX IF NOT EXISTS idx_model_usage_stats_tracking_id ON model_usage_stats(tracking_id)",
            
            # Model transitions indexes
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_session_id ON model_transitions(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_models ON model_transitions(from_model, to_model)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_timestamp ON model_transitions(timestamp)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_tracking_id ON model_transitions(tracking_id)",
            
            # Assistants indexes
            "CREATE INDEX IF NOT EXISTS idx_assistants_created_at ON assistants(created_at)"
        ]
        
        for stmt in index_statements:
            await conn.execute(text(stmt))
        
        # Insert model configuration in the format expected by ClientPool
        import json
        import os
        
        # Create model_configs entries for o1, o3-mini, and DeepSeek-R1
        model_configs = {
            "o1": {
                "name": "o1",
                "description": "Azure OpenAI o1 high performance model",
                "max_tokens": 40000,
                "supports_streaming": False,
                "supports_temperature": False,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
                "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview"),
                "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
                "api_key": "",  # Never store API keys in database
                "model_type": "o-series",
                "requires_reasoning_effort": True
            },
            "DeepSeek-R1": {
                "name": "DeepSeek-R1",  # This is the model name passed to the API
                "description": "DeepSeek-R1 model that supports chain-of-thought reasoning",
                "max_tokens": 32000,
                "supports_streaming": True,
                "supports_temperature": True,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
                "api_version": os.getenv("AZURE_INFERENCE_API_VERSION", "2024-05-01-preview"),
                "azure_endpoint": os.getenv("AZURE_INFERENCE_ENDPOINT", ""),  # Contains the deployment name in URL
                "api_key": "",  # Never store API keys in database
                "model_type": "deepseek",
                "enable_thinking": True
            },
            "o3-mini": {
                "name": "o3-mini",
                "description": "Azure OpenAI o3-mini model with streaming support",
                "max_tokens": 200000,
                "supports_streaming": True,
                "supports_temperature": False,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
                "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview"),
                "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
                "api_key": "",  # Never store API keys in database
                "model_type": "o-series",
                "requires_reasoning_effort": True
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
                is_secret = EXCLUDED.is_secret,
                updated_at = CURRENT_TIMESTAMP
        """), {"config_value": json.dumps(model_configs)})

if __name__ == "__main__":
    asyncio.run(init_database())
