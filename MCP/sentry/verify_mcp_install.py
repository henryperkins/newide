#!/usr/bin/env python3
"""
Verification script for Sentry MCP installation.
This script verifies that the Sentry MCP server is installed correctly and can be started.
"""

import importlib.metadata
import subprocess
import sys
import os

def check_package_versions():
    """Check installed package versions."""
    packages = ["mcp", "mcp-server-sentry"]
    print("Checking installed package versions:")
    
    for package in packages:
        try:
            version = importlib.metadata.version(package)
            print(f"✓ {package}: v{version}")
        except importlib.metadata.PackageNotFoundError:
            print(f"✗ {package}: Not installed")
            return False
    
    return True

def try_start_server():
    """Try to start the Sentry MCP server."""
    print("\nAttempting to start the Sentry MCP server (will exit after 5 seconds):")
    
    # The token is not valid but we're just testing if it can start
    cmd = [sys.executable, "-m", "mcp_server_sentry", "--auth-token", "test_token"]
    
    try:
        # Start the process and kill it after 5 seconds
        process = subprocess.Popen(
            cmd, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Wait for 5 seconds and then terminate
        import time
        time.sleep(5)
        process.terminate()
        
        stdout, stderr = process.communicate(timeout=2)
        
        # Check if there were any import errors
        if "ModuleNotFoundError" in stderr or "ImportError" in stderr:
            print("✗ Server failed to start due to missing modules:")
            print(stderr)
            return False
        else:
            print("✓ Server started successfully (and was terminated after 5 seconds)")
            return True
            
    except subprocess.TimeoutExpired:
        process.kill()
        print("✓ Server is running (killed after timeout)")
        return True
    except Exception as e:
        print(f"✗ Error starting server: {e}")
        return False

def check_python_environment():
    """Check the Python environment."""
    print("\nChecking Python environment:")
    print(f"✓ Python executable: {sys.executable}")
    print(f"✓ Python version: {sys.version}")
    
    # Check if we're in a virtual environment
    in_venv = sys.prefix != sys.base_prefix
    if in_venv:
        print(f"✓ Running in virtual environment: {sys.prefix}")
    else:
        print("✗ Not running in a virtual environment")
        return False
    
    return True

def show_mcp_config_advice():
    """Show advice for configuring MCP."""
    print("\nMCP Configuration Advice:")
    print("-" * 50)
    print("Make sure your MCP configuration points to the correct Python interpreter:")
    print('{\n  "mcpServers": {')
    print('    "github.com/modelcontextprotocol/servers/tree/main/src/sentry": {')
    print(f'      "command": "{sys.executable}",')
    print('      "args": [')
    print('        "-m",')
    print('        "mcp_server_sentry",')
    print('        "--auth-token",')
    print('        "YOUR_SENTRY_AUTH_TOKEN"')
    print('      ],')
    print('      "disabled": false,')
    print('      "autoApprove": []')
    print('    }')
    print('  }')
    print('}')
    print("-" * 50)

def main():
    """Main verification function."""
    print("=" * 60)
    print("Sentry MCP Installation Verification")
    print("=" * 60)
    
    env_ok = check_python_environment()
    packages_ok = check_package_versions()
    server_ok = try_start_server()
    
    print("\nVerification Results:")
    print(f"- Python Environment: {'✓' if env_ok else '✗'}")
    print(f"- Required Packages: {'✓' if packages_ok else '✗'}")
    print(f"- Server Startup: {'✓' if server_ok else '✗'}")
    
    if env_ok and packages_ok and server_ok:
        print("\n✅ Sentry MCP installation is working correctly!")
    else:
        print("\n❌ Sentry MCP installation has issues.")
        
    show_mcp_config_advice()

if __name__ == "__main__":
    main()