import asyncio
import ssl
import json
import os
from sqlalchemy import text
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
        await conn.execute(
            text(
                """
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
        """
            )
        )

        # Create users table
        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY,
                email VARCHAR(120) UNIQUE NOT NULL,
                hashed_password VARCHAR NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                requires_password_reset BOOLEAN DEFAULT FALSE,
                password_reset_reason VARCHAR(100)
            )
        """
            )
        )

        # Create conversations table with better model tracking
        await conn.execute(
            text(
                """
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
                service_tier VARCHAR(50),
                version INTEGER DEFAULT 1 NOT NULL
            )
        """
            )
        )

        # Create uploaded_files table
        await conn.execute(
            text(
                """
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
        """
            )
        )

        # Create vector_stores table
        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS vector_stores (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                azure_id VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                file_metadata JSONB
            )
        """
            )
        )

        # Create file_citations table
        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS file_citations (
                id UUID PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
                file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
                snippet TEXT NOT NULL,
                position INTEGER,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                file_metadata JSONB
            )
        """
            )
        )

        # Create app_configurations table
        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS app_configurations (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB NOT NULL,
                description TEXT,
                is_secret BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """
            )
        )

        # Create model_usage_stats table with improved tracking
        await conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS model_usage_stats (
                id SERIAL PRIMARY KEY,
                model VARCHAR(50) NOT NULL,
                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                prompt_tokens INTEGER NOT NULL,
                completion_tokens INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                reasoning_tokens INTEGER,
                cached_tokens INTEGER,
                active_tokens INTEGER,
                thinking_process JSONB,
                token_details JSONB,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                tracking_id VARCHAR(64),
                model_metadata JSONB,
                usage_metadata JSONB,
                extra_metadata JSONB
            )
        """
            )
        )

        # Create model_transitions table for tracking model switches
        await conn.execute(
            text(
                """
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
                transition_metadata JSONB,
                server_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """
            )
        )

        # Create assistants table
        await conn.execute(
            text(
                """
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
                assistant_metadata JSONB
            )
        """
            )
        )

        # First add any missing columns, then create indexes
        try:
            # Add tracking_id to conversations if not exists
            await conn.execute(
                text(
                    """
                ALTER TABLE conversations
                ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(64)
            """
                )
            )

            # Add password reset columns to users if not exists
            await conn.execute(
                text(
                    """
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS requires_password_reset BOOLEAN DEFAULT FALSE
            """
                )
            )
            
            await conn.execute(
                text(
                    """
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS password_reset_reason VARCHAR(100)
            """
                )
            )

            # Remove content_analysis - this is causing the TooManyColumnsError
            # await conn.execute(
            #     text(
            #         """
            #     ALTER TABLE model_usage_stats
            #     ADD COLUMN IF NOT EXISTS content_analysis JSONB
            # """
            #     )
            # )

            # Add token_details to model_usage_stats if not exists
            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS token_details JSONB
            """
                )
            )

            # Add model_metadata to model_usage_stats if not exists
            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS model_metadata JSONB
            """
                )
            )

            # Add tracking_id to model_usage_stats if not exists
            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(64)
            """
                )
            )

            # Add columns to model_usage_stats that are in the ORM but not in database

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS cached_tokens INTEGER
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS active_tokens INTEGER
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER
            """
                )
            )

            # Add missing columns
            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS model_type VARCHAR(20) NOT NULL DEFAULT 'standard'
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS deepseek_specific_tokens INTEGER
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS o_series_specific_tokens INTEGER
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS o_series_effort VARCHAR(20)
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                ADD COLUMN IF NOT EXISTS deepseek_thoughts INTEGER
            """
                )
            )

            # Only drop content_analysis which is not in our ORM
            await conn.execute(
                text(
                    """
                ALTER TABLE conversations
                ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL
            """
                )
            )
            await conn.execute(
                text(
                    """
                ALTER TABLE model_usage_stats
                DROP COLUMN IF EXISTS content_analysis
            """
                )
            )

            # We need to recreate the model_usage_stats table with the correct schema
            # since ALTER TABLE is hitting the PostgreSQL column limit
            try:
                # First, check if the columns exist before attempting any migration
                columns_result = await conn.execute(
                    text(
                        """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_name = 'model_usage_stats'
                        AND (column_name = 'usage_metadata' OR column_name = 'extra_metadata')
                        """
                    )
                )
                missing_columns = [row[0] for row in columns_result]
                
                if len(missing_columns) < 2:
                    print(f"Found {len(missing_columns)} of 2 required metadata columns. Will attempt to recreate table.")
                    
                    # Create a temporary table with the correct schema
                    await conn.execute(
                        text(
                            """
                            CREATE TABLE IF NOT EXISTS model_usage_stats_new (
                                id SERIAL PRIMARY KEY,
                                model VARCHAR(50) NOT NULL,
                                session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
                                prompt_tokens INTEGER NOT NULL,
                                completion_tokens INTEGER NOT NULL,
                                total_tokens INTEGER NOT NULL,
                                reasoning_tokens INTEGER,
                                cached_tokens INTEGER,
                                active_tokens INTEGER,
                                token_details JSONB,
                                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                tracking_id VARCHAR(64),
                                model_metadata JSONB,
                                usage_metadata JSONB,
                                extra_metadata JSONB,
                                model_type VARCHAR(20) NOT NULL DEFAULT 'standard',
                                deepseek_specific_tokens INTEGER,
                                o_series_specific_tokens INTEGER,
                                o_series_effort VARCHAR(20),
                                deepseek_thoughts INTEGER
                            )
                            """
                        )
                    )
                    
                    # Copy data from old table to new one, handling missing columns
                    await conn.execute(
                        text(
                            """
                            INSERT INTO model_usage_stats_new(
                                model, session_id, prompt_tokens, completion_tokens,
                                total_tokens, reasoning_tokens, cached_tokens,
                                active_tokens, token_details, timestamp,
                                tracking_id, model_metadata, model_type,
                                deepseek_specific_tokens, o_series_specific_tokens,
                                o_series_effort, deepseek_thoughts
                            )
                            SELECT
                                model, session_id, prompt_tokens, completion_tokens,
                                total_tokens, reasoning_tokens, cached_tokens,
                                active_tokens, token_details, timestamp,
                                tracking_id, model_metadata, model_type,
                                deepseek_specific_tokens, o_series_specific_tokens,
                                o_series_effort, deepseek_thoughts
                            FROM model_usage_stats
                            """
                        )
                    )
                    
                    # Drop the old table
                    await conn.execute(text("DROP TABLE model_usage_stats"))
                    
                    # Rename the new table
                    await conn.execute(text("ALTER TABLE model_usage_stats_new RENAME TO model_usage_stats"))
                    
                    print("Successfully recreated model_usage_stats table with all required columns")
            except Exception as e:
                print(f"Error recreating model_usage_stats table: {e}")
                # Commit current transaction to prevent cascading failures
                await conn.execute(text("COMMIT"))
                # Start a new transaction
                await conn.execute(text("BEGIN"))

            # Add created_at and updated_at to app_configurations if not exists
            await conn.execute(
                text(
                    """
                ALTER TABLE app_configurations
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            """
                )
            )

            await conn.execute(
                text(
                    """
                ALTER TABLE app_configurations
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            """
                )
            )

            # Align existing tables with ORM definitions
            await conn.execute(
                text(
                    "ALTER TABLE model_transitions ALTER COLUMN session_id SET NOT NULL"
                )
            )
            await conn.execute(
                text(
                    "ALTER TABLE model_transitions ADD COLUMN IF NOT EXISTS transition_metadata JSONB"
                )
            )
            await conn.execute(
                text(
                    "ALTER TABLE model_transitions ADD COLUMN IF NOT EXISTS extra_metadata JSONB"
                )
            )
            await conn.execute(
                text(
                    "ALTER TABLE model_transitions ADD COLUMN IF NOT EXISTS server_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"
                )
            )

            await conn.execute(
                text("ALTER TABLE uploaded_files ALTER COLUMN session_id SET NOT NULL")
            )

            await conn.execute(
                text("ALTER TABLE sessions ALTER COLUMN expires_at DROP NOT NULL")
            )
            await conn.execute(
                text("ALTER TABLE sessions ALTER COLUMN request_count SET NOT NULL")
            )

            await conn.execute(
                text(
                    "ALTER TABLE file_citations ALTER COLUMN conversation_id SET NOT NULL"
                )
            )

            # Remove usage_metadata and extra_metadata columns to prevent TooManyColumnsError
            # These columns are already defined in the CREATE TABLE statement for model_usage_stats

            await conn.execute(
                text("ALTER TABLE conversations ALTER COLUMN session_id SET NOT NULL")
            )

            # Ensure pinned, archived columns match ORM (not null, default false)
            await conn.execute(
                text("""
                    ALTER TABLE conversations
                    ADD COLUMN IF NOT EXISTS pinned BOOLEAN
                """)
            )
            await conn.execute(
                text("""
                    ALTER TABLE conversations
                    ADD COLUMN IF NOT EXISTS archived BOOLEAN
                """)
            )
            await conn.execute(
                text("""
                    UPDATE conversations
                    SET pinned = false
                    WHERE pinned IS NULL
                """)
            )
            await conn.execute(
                text("""
                    UPDATE conversations
                    SET archived = false
                    WHERE archived IS NULL
                """)
            )
            await conn.execute(
                text("""
                    ALTER TABLE conversations
                    ALTER COLUMN pinned SET DEFAULT false,
                    ALTER COLUMN pinned SET NOT NULL
                """)
            )
            await conn.execute(
                text("""
                    ALTER TABLE conversations
                    ALTER COLUMN archived SET DEFAULT false,
                    ALTER COLUMN archived SET NOT NULL
                """)
            )

            await conn.execute(
                text("ALTER TABLE vector_stores ALTER COLUMN session_id SET NOT NULL")
            )

            # Remove old "metadata" columns
            await conn.execute(
                text("ALTER TABLE model_usage_stats DROP COLUMN IF EXISTS metadata")
            )
            await conn.execute(
                text(
                    "ALTER TABLE model_usage_stats DROP COLUMN IF EXISTS thinking_process"
                )
            )
            await conn.execute(
                text("ALTER TABLE model_transitions DROP COLUMN IF EXISTS metadata")
            )
        except Exception as e:
            print(f"Error adding columns or dropping old metadata columns: {e}")

        # Add missing indexes with transaction error handling
        index_statements = [
            "CREATE INDEX IF NOT EXISTS ix_vector_stores_status ON vector_stores (status)",
            "CREATE INDEX IF NOT EXISTS ix_vector_stores_session_id ON vector_stores (session_id)",
            "CREATE INDEX IF NOT EXISTS ix_conversations_tracking_id ON conversations (tracking_id)",
            "CREATE INDEX IF NOT EXISTS ix_conversations_session_id ON conversations (session_id)",
            "CREATE INDEX IF NOT EXISTS ix_conversations_timestamp ON conversations (timestamp)",
            "CREATE INDEX IF NOT EXISTS ix_conversations_model ON conversations (model)",
            "CREATE INDEX IF NOT EXISTS ix_file_citations_file_id ON file_citations (file_id)",
            "CREATE INDEX IF NOT EXISTS ix_sessions_expires_at ON sessions (expires_at)",
            "CREATE INDEX IF NOT EXISTS ix_sessions_created_at ON sessions (created_at)",
            "CREATE INDEX IF NOT EXISTS ix_model_usage_stats_timestamp ON model_usage_stats (timestamp)",
            "CREATE INDEX IF NOT EXISTS ix_model_usage_stats_session_model ON model_usage_stats (session_id, model)",
            "CREATE INDEX IF NOT EXISTS ix_model_usage_stats_model ON model_usage_stats (model)",
            "CREATE INDEX IF NOT EXISTS ix_model_usage_stats_tracking_id ON model_usage_stats (tracking_id)",
            "CREATE INDEX IF NOT EXISTS ix_assistants_created_at ON assistants (created_at)",
            "CREATE INDEX IF NOT EXISTS ix_model_transitions_tracking_id ON model_transitions (tracking_id)",
            "CREATE INDEX IF NOT EXISTS ix_model_transitions_models ON model_transitions (from_model, to_model)",
            "CREATE INDEX IF NOT EXISTS ix_model_transitions_session_id ON model_transitions (session_id)",
            "CREATE INDEX IF NOT EXISTS ix_model_transitions_timestamp ON model_transitions (timestamp)",
        ]

        for stmt in index_statements:
            try:
                await conn.execute(text(stmt))
            except Exception as e:
                print(f"Error creating index: {e}")
                # Commit current transaction to prevent cascading failures
                await conn.execute(text("COMMIT"))
                # Start a new transaction
                await conn.execute(text("BEGIN"))

        # Create all needed indexes with transaction error handling
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
            "CREATE INDEX IF NOT EXISTS ix_uploaded_files_upload_time ON uploaded_files(upload_time)",  # Ensure missing index
            "CREATE INDEX IF NOT EXISTS ix_uploaded_files_status ON uploaded_files(status)",  # Ensure missing index
            # Model transitions indexes
            "CREATE INDEX IF NOT EXISTS ix_file_citations_conversation_id ON file_citations(conversation_id)",
            "CREATE INDEX IF NOT EXISTS ix_uploaded_files_session_id ON uploaded_files(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_session_id ON model_transitions(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_models ON model_transitions(from_model, to_model)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_timestamp ON model_transitions(timestamp)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_tracking_id ON model_transitions(tracking_id)",
            "CREATE INDEX IF NOT EXISTS idx_model_transitions_server_created ON model_transitions(server_created_at)",
            # Assistants indexes
            "CREATE INDEX IF NOT EXISTS idx_assistants_created_at ON assistants(created_at)",
        ]

        for stmt in index_statements:
            try:
                await conn.execute(text(stmt))
            except Exception as e:
                print(f"Error creating index: {e}")
                # Commit current transaction to prevent cascading failures
                await conn.execute(text("COMMIT"))
                # Start a new transaction
                await conn.execute(text("BEGIN"))

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
                "api_version": os.getenv(
                    "AZURE_OPENAI_API_VERSION", "2025-02-01-preview"
                ),
                "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
                "api_key": "",  # Never store API keys in database
                "model_type": "o-series",
                "requires_reasoning_effort": True,
            },
            "DeepSeek-R1": {
                "name": "DeepSeek-R1",  # This is the model name passed to the API
                "description": "DeepSeek-R1 model that supports chain-of-thought reasoning",
                "max_tokens": 64000,
                "supports_streaming": True,
                "supports_temperature": True,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
                "api_version": os.getenv(
                    "AZURE_INFERENCE_API_VERSION", "2024-05-01-preview"
                ),
                "azure_endpoint": os.getenv(
                    "AZURE_INFERENCE_ENDPOINT", ""
                ),  # Contains the deployment name in URL
                "api_key": "",  # Never store API keys in database
                "model_type": "deepseek",
                "enable_thinking": True,
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
                "api_version": os.getenv(
                    "AZURE_OPENAI_API_VERSION", "2025-02-01-preview"
                ),
                "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
                "api_key": "",  # Never store API keys in database
                "model_type": "o-series",
                "requires_reasoning_effort": True,
            },
        }

        # Ensure "DeepSeek-R1" is included in the model_configs entry
        existing_config = await conn.execute(
            text(
                """
            SELECT value FROM app_configurations WHERE key = 'model_configs'
        """
            )
        )
        existing_config = existing_config.scalar()

        if existing_config:
            # existing_config is already a dict, so skip json.loads
            updated_config = (
                existing_config
                if isinstance(existing_config, dict)
                else json.loads(existing_config)
            )
            updated_config["DeepSeek-R1"] = model_configs["DeepSeek-R1"]
            await conn.execute(
                text(
                    """
                UPDATE app_configurations
                SET value = :config_value,
                    description = 'Azure OpenAI model configurations',
                    is_secret = true,
                    updated_at = CURRENT_TIMESTAMP
                WHERE key = 'model_configs'
            """
                ),
                {"config_value": json.dumps(updated_config)},
            )
        else:
            # Insert model_configs if it doesn't exist
            await conn.execute(
                text(
                    """
                INSERT INTO app_configurations (key, value, description, is_secret)
                VALUES (
                    'model_configs',
                    :config_value,
                    'Azure OpenAI model configurations',
                    true
                )
            """
                ),
                {"config_value": json.dumps(model_configs)},
            )


if __name__ == "__main__":
    asyncio.run(init_database())
