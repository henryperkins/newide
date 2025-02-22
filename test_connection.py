import asyncio
from database import AsyncSessionLocal
from sqlalchemy import text

async def test_db_connection():
    try:
        async with AsyncSessionLocal() as session:
            # Try to execute a simple query using SQLAlchemy text()
            result = await session.execute(text("SELECT 1"))
            print("✅ Successfully connected to the database!")
            print("Query result:", result.scalar())
    except Exception as e:
        print("❌ Failed to connect to the database:")
        print(str(e))

if __name__ == "__main__":
    asyncio.run(test_db_connection())