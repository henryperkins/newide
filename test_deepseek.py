import asyncio
import aiohttp
import json
import uuid

async def test_deepseek_streaming():
    """Test DeepSeek-R1 model streaming functionality"""
    print("Testing DeepSeek-R1 streaming...")
    
    # Create a session ID
    session_id = str(uuid.uuid4())
    print(f"Session ID: {session_id}")
    
    # Set up the request parameters
    model = "DeepSeek-R1"
    message = "Write a short poem about debugging code"
    developer_config = "Formatting re-enabled - use markdown code blocks"
    reasoning_effort = "medium"
    enable_thinking = "true"
    
    # Construct the URL
    url = f"http://localhost:8000/api/chat/sse?session_id={session_id}&model={model}&message={message}&developer_config={developer_config}&reasoning_effort={reasoning_effort}&enable_thinking={enable_thinking}"
    
    print(f"Making request to: {url}")
    
    # Make the request
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status == 200:
                print("Connection established, receiving streaming response...")
                
                # Process the SSE stream
                buffer = ""
                async for line in response.content:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        data = line[6:]  # Remove 'data: ' prefix
                        try:
                            json_data = json.loads(data)
                            if 'choices' in json_data and json_data['choices']:
                                for choice in json_data['choices']:
                                    if 'delta' in choice and 'content' in choice['delta']:
                                        content = choice['delta']['content']
                                        buffer += content
                                        print(content, end='', flush=True)
                            elif 'error' in json_data:
                                print(f"\nError: {json_data['error']}")
                        except json.JSONDecodeError:
                            print(f"\nInvalid JSON: {data}")
                
                print("\n\nStreaming completed.")
                print(f"Total content length: {len(buffer)}")
            else:
                print(f"Error: {response.status} {response.reason}")
                text = await response.text()
                print(f"Response: {text}")

if __name__ == "__main__":
    asyncio.run(test_deepseek_streaming())