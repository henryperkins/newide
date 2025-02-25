#!/usr/bin/env python
# test_thinking.py - Test DeepSeek-R1 thinking process functionality

import asyncio
import json
import os
from datetime import datetime

import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
model_name = "DeepSeek-R1"
azure_inference_endpoint = os.getenv("AZURE_INFERENCE_ENDPOINT")
azure_inference_credential = os.getenv("AZURE_INFERENCE_CREDENTIAL")
api_version = "2025-01-01-preview"

# Test messages that should trigger thinking
TEST_MESSAGES = [
    "Explain the concept of recursion in programming and provide an example.",
    "What are the pros and cons of microservices vs monolithic architecture?",
    "Write a simple Python function to find all prime numbers below 100.",
    "Explain the difference between supervised and unsupervised learning in machine learning."
]

async def test_thinking_process():
    """Test the DeepSeek-R1 thinking process functionality"""
    
    if not azure_inference_endpoint or not azure_inference_credential:
        print("Error: Azure Inference credentials not set in environment variables")
        return
    
    url = f"{azure_inference_endpoint.rstrip('/')}/openai/deployments/{model_name}/chat/completions?api-version={api_version}"
    
    headers = {
        "Content-Type": "application/json",
        "api-key": azure_inference_credential
    }
    
    # Create a unique session ID for this test
    session_id = f"thinking-test-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    print(f"Testing DeepSeek-R1 thinking process with session: {session_id}")
    print(f"URL: {url}")
    print("-" * 80)
    
    async with httpx.AsyncClient(timeout=120) as client:
        for i, message in enumerate(TEST_MESSAGES):
            print(f"\nTest {i+1}: {message[:50]}...")
            
            # Prepare request payload
            payload = {
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a helpful AI assistant. Show your thinking process using <think>...</think> tags."
                    },
                    {
                        "role": "user",
                        "content": message
                    }
                ],
                "reasoning_effort": "high",  # Use high reasoning effort to encourage thinking
                "max_tokens": 4000,
                "model": model_name,
                "temperature": 0.7,
                "session_id": session_id
            }
            
            # Send the request
            try:
                print("Sending request...")
                start_time = datetime.now()
                response = await client.post(url, headers=headers, json=payload)
                
                # Calculate response time
                response_time = (datetime.now() - start_time).total_seconds()
                
                if response.status_code == 200:
                    data = response.json()
                    content = data["choices"][0]["message"]["content"]
                    
                    # Check if thinking process is included
                    has_thinking = "<think>" in content and "</think>" in content
                    
                    print(f"Response received in {response_time:.2f} seconds")
                    print(f"Has thinking process: {has_thinking}")
                    
                    if has_thinking:
                        # Extract thinking process
                        thinking_start = content.find("<think>") + 7
                        thinking_end = content.find("</think>")
                        thinking = content[thinking_start:thinking_end].strip()
                        
                        # Print a snippet of the thinking process
                        print("\nThinking process snippet:")
                        print("-" * 40)
                        print(thinking[:300] + "..." if len(thinking) > 300 else thinking)
                        print("-" * 40)
                    else:
                        print("No thinking process found in response")
                        
                else:
                    print(f"Error: {response.status_code} - {response.text}")
            
            except Exception as e:
                print(f"Exception: {str(e)}")
            
            print("-" * 80)
            
            # Sleep between requests to avoid rate limiting
            if i < len(TEST_MESSAGES) - 1:
                await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(test_thinking_process())