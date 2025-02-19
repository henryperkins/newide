import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import config

async def init_database():
    """Initialize the database and create tables"""
    engine = create_async_engine(config.POSTGRES_URL)
    
    try:
        async with engine.begin() as conn:
            # Create database if it doesn't exist
            # Create tables separately to avoid multi-command prepared statement issue
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id UUID PRIMARY KEY,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    last_activity TIMESTAMPTZ DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL
                );"""))

            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    session_id UUID REFERENCES sessions(id),
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TIMESTAMPTZ DEFAULT NOW()
                );"""))

            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS uploaded_files (
                    id UUID PRIMARY KEY,
                    session_id UUID REFERENCES sessions(id),
                    filename TEXT NOT NULL,
                    content TEXT NOT NULL,
                    size BIGINT NOT NULL,
                    upload_time TIMESTAMPTZ DEFAULT NOW()
                );"""))

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
