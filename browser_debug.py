import asyncio
import aiohttp

async def check_api_endpoint():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://localhost:8000/api/config/models') as response:
                print(f"Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    print("Response data:")
                    print(data)
                else:
                    print(f"Error: {await response.text()}")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(check_api_endpoint())
