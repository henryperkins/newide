#!/usr/bin/env python3
"""
Simple test script to verify connection to DeepSeek-R1D2 endpoint.
This script tests the Azure AI Inference SDK connection directly,
bypassing the rest of the application.
"""

import os
import sys
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError

# Configuration for DeepSeek-R1D2
ENDPOINT = "https://DeepSeek-R1D2.eastus2.models.ai.azure.com"
API_KEY = "M6Dbj2dcZ1Eb2If33ecVZ5jXK3yvVlOx"
MODEL_ID = "DeepSeek-R1"
API_VERSION = "2024-05-01-preview"


def test_connection():
    """Test connection to DeepSeek-R1D2 endpoint"""
    print(f"Testing connection to: {ENDPOINT}")
    print(f"Model: {MODEL_ID}")
    print(f"API Version: {API_VERSION}")
    
    try:
        # Create client
        client = ChatCompletionsClient(
            endpoint=ENDPOINT,
            credential=AzureKeyCredential(API_KEY),
            api_version=API_VERSION,
            model=MODEL_ID
        )
        
        # Simple test message
        messages = [
            {"role": "user", "content": "Hello, please respond with a simple greeting."}
        ]
        
        print("\nSending test request...")
        response = client.complete(
            messages=messages,
            max_tokens=100
        )
        
        print("\n--- RESPONSE ---")
        print(f"Response content: {response.choices[0].message.content}")
        print(f"Token usage: {response.usage.total_tokens} total tokens")
        print(f"  - Prompt tokens: {response.usage.prompt_tokens}")
        print(f"  - Completion tokens: {response.usage.completion_tokens}")
        print("\nConnection test SUCCESSFUL!")
        return True
        
    except HttpResponseError as e:
        print(f"\nHTTP Error: {e.status_code} - {e.message}")
        if e.status_code == 401:
            print("Authentication error. Please check your API key.")
        elif e.status_code == 404:
            print("Endpoint not found. Please check your endpoint URL.")
        else:
            print(f"Error details: {e.error}")
        return False
        
    except Exception as e:
        print(f"\nUnexpected error: {str(e)}")
        return False


if __name__ == "__main__":
    success = test_connection()
    sys.exit(0 if success else 1)
