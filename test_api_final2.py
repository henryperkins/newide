import asyncio
import aiohttp
import json

async def test_model_api():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://localhost:8000/api/config/models') as response:
                print(f"Status: {response.status}")
                data = await response.json()
                print("Full response:\n" + json.dumps(data, indent=2))
                return True
    except Exception as e:
        print(f"Exception: {e}")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_model_api())
    print(f"\nAPI test {'PASSED' if result else 'FAILED'}")
