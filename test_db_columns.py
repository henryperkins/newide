#\!/usr/bin/env python

import asyncio
from database import AsyncSessionLocal
from sqlalchemy import text

async def test_query():
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conversations'"))
        for row in result:
            print(row)

if __name__ == "__main__":
    asyncio.run(test_query())
