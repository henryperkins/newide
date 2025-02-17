import asyncio
from main import engine
from sqlalchemy import text

async def check_tables():
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT table_name "
            "FROM information_schema.tables "
            "WHERE table_schema = 'public'"
        ))
        print("Tables:", result.fetchall())

if __name__ == "__main__":
    asyncio.run(check_tables())
