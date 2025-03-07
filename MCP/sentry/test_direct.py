#!/usr/bin/env python3
"""
Direct test script for the Sentry MCP server.
This script attempts to import and use the mcp_server_sentry module directly.
"""

import sys
import traceback

def test_direct_import():
    """Test direct import of the mcp_server_sentry module."""
    print("Testing direct import of mcp_server_sentry...")
    
    try:
        import mcp_server_sentry
        print(f"Successfully imported mcp_server_sentry module: {mcp_server_sentry}")
        print(f"Module location: {mcp_server_sentry.__file__}")
        print(f"Module version: {getattr(mcp_server_sentry, '__version__', 'Unknown')}")
        
        # Try to access some functionality
        print("\nTrying to access module functionality...")
        if hasattr(mcp_server_sentry, 'main'):
            print("Found 'main' function")
        else:
            print("No 'main' function found")
            
        # List all attributes
        print("\nModule attributes:")
        for attr in dir(mcp_server_sentry):
            if not attr.startswith('__'):
                print(f"- {attr}")
                
    except ImportError as e:
        print(f"Failed to import mcp_server_sentry: {e}")
        traceback.print_exc()
    except Exception as e:
        print(f"Unexpected error: {e}")
        traceback.print_exc()

def test_mcp_import():
    """Test import of the mcp module."""
    print("\nTesting import of mcp module...")
    
    try:
        import mcp
        print(f"Successfully imported mcp module: {mcp}")
        print(f"Module location: {mcp.__file__}")
        print(f"Module version: {getattr(mcp, '__version__', 'Unknown')}")
        
        # List all attributes
        print("\nModule attributes:")
        for attr in dir(mcp):
            if not attr.startswith('__'):
                print(f"- {attr}")
                
    except ImportError as e:
        print(f"Failed to import mcp: {e}")
        traceback.print_exc()
    except Exception as e:
        print(f"Unexpected error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    test_direct_import()
    test_mcp_import()
    
    print("\nPython path:")
    for path in sys.path:
        print(f"- {path}")
