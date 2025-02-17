import asyncio
import config
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text


async def test_connection():
    engine = create_async_engine(
        config.POSTGRES_URL  # Use the same config as main app
    )
    try:
        async with engine.connect() as conn:
            # Verify connection by executing a simple query
            await conn.execute(text("SELECT 1"))
            print("✅ Successfully connected to PostgreSQL!")
    except Exception as e:
        print(f"❌ Connection failed: {e}")
    finally:
        await engine.dispose()

asyncio.run(test_connection())
