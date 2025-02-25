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
                
                # Check if data has the expected structure
                if not isinstance(data, dict):
                    print("ERROR: Response is not a dictionary")
                    return False
                    
                # Check all model objects have required fields
                for model_id, model_config in data.items():
                    print(f"\nChecking model: {model_id}")
                    required_fields = ['name', 'description', 'max_tokens', 'supports_streaming', 
                                      'supports_temperature', 'api_version', 'azure_endpoint']
                    
                    for field in required_fields:
                        if field not in model_config:
                            print(f"  ERROR: Missing required field '{field}'")
                            return False
                        else:
                            print(f"  ✓ Found '{field}': {model_config[field]}")
                
                return True
                
    except Exception as e:
        print(f"Exception: {e}")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_model_api())
    print(f"\nAPI test {'PASSED' if result else 'FAILED'}")
