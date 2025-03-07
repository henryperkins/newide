#!/usr/bin/env python3
"""
Test script for the Sentry MCP server.
This script demonstrates how to use the get_sentry_issue tool to retrieve and analyze a Sentry issue.
"""

import json
import subprocess
import sys

def test_sentry_mcp():
    """Test the Sentry MCP server by using the get_sentry_issue tool."""
    print("Testing Sentry MCP server...")
    
    # Example Sentry issue ID or URL
    # In a real scenario, you would use an actual Sentry issue ID or URL
    issue_id_or_url = "EXAMPLE-ISSUE-ID"
    
    # Create a JSON payload for the MCP tool
    payload = {
        "server_name": "github.com/modelcontextprotocol/servers/tree/main/src/sentry",
        "tool_name": "get_sentry_issue",
        "arguments": {
            "issue_id_or_url": issue_id_or_url
        }
    }
    
    print(f"Attempting to retrieve Sentry issue: {issue_id_or_url}")
    print("Note: This is a demonstration. In a real scenario, you would need a valid Sentry issue ID or URL.")
    print("Since we're using a placeholder issue ID, the server will return an error, which is expected.")
    
    # In a real application, you would use the MCP SDK to call the tool
    # For demonstration purposes, we're just showing the payload that would be sent
    print("\nMCP Tool Call Payload:")
    print(json.dumps(payload, indent=2))
    
    print("\nTo use this tool in Claude, you would use:")
    print(f"""
<use_mcp_tool>
<server_name>github.com/modelcontextprotocol/servers/tree/main/src/sentry</server_name>
<tool_name>get_sentry_issue</tool_name>
<arguments>
{{
  "issue_id_or_url": "{issue_id_or_url}"
}}
</arguments>
</use_mcp_tool>
""")

if __name__ == "__main__":
    test_sentry_mcp()
