#!/usr/bin/env python3
"""
Simplified test script for the Sentry MCP server.
This script tests a basic connection to the Sentry API without using the MCP server.
"""

import os
import sys
import httpx

def test_sentry_connection():
    """Test a direct connection to the Sentry API."""
    print("Testing direct connection to Sentry API...")
    
    # Use the auth token from our MCP settings
    auth_token = "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"
    
    if not auth_token:
        print("ERROR: No Sentry auth token provided")
        return False
    
    # Try to make a simple request to the Sentry API
    try:
        base_url = "https://sentry.io/api/0/"
        with httpx.Client(base_url=base_url) as client:
            response = client.get(
                "organizations/", 
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            
            if response.status_code == 200:
                print("✓ Successfully connected to Sentry API")
                print(f"Retrieved {len(response.json())} organization(s)")
                for org in response.json():
                    print(f"  - {org.get('name', 'Unknown')} (slug: {org.get('slug', 'unknown')})")
                return True
            elif response.status_code == 401:
                print("✗ Authentication failed: Invalid auth token")
                return False
            else:
                print(f"✗ Request failed with status code: {response.status_code}")
                print(f"Response: {response.text}")
                return False
    except Exception as e:
        print(f"✗ Error connecting to Sentry API: {e}")
        return False

if __name__ == "__main__":
    print("Sentry Connection Test")
    print("=" * 60)
    
    success = test_sentry_connection()
    
    print("\nTest Results:")
    print(f"Sentry API Connection: {'✓' if success else '✗'}")
    
    print("\nNext Steps:")
    if success:
        print("1. The Sentry authentication token is valid and working correctly.")
        print("2. However, there might be syntax errors in the MCP server implementation.")
        print("3. Consider updating to a newer version of the mcp-server-sentry package.")
    else:
        print("1. Check if your Sentry authentication token is valid.")
        print("2. Ensure you have the correct permissions in Sentry.")
        print("3. Verify your network connection to sentry.io.")
