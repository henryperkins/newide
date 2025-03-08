# Sentry MCP Server Documentation

## Overview

The Sentry MCP server provides tools to retrieve and analyze issues from Sentry.io. This server allows you to inspect error reports, stacktraces, and other debugging information from your Sentry account.

## Installation

The Sentry MCP server has been installed using pip:

```bash
pip install mcp-server-sentry
```

## Configuration

The server has been configured in the Cline MCP settings file at:
`/home/azureuser/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

```json
"github.com/modelcontextprotocol/servers/tree/main/src/sentry": {
  "command": "python",
  "args": ["-m", "mcp_server_sentry", "--auth-token", "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"],
  "disabled": false,
  "autoApprove": []
}
```

## Available Tools

### get_sentry_issue

This tool allows you to retrieve and analyze a Sentry issue by ID or URL.

**Input Parameters:**
- `issue_id_or_url` (string): Sentry issue ID or URL to analyze

**Returns:**
- Issue details including:
  - Title
  - Issue ID
  - Status
  - Level
  - First seen timestamp
  - Last seen timestamp
  - Event count
  - Full stacktrace

## Usage Examples

### Example 1: Retrieving a Sentry Issue

To retrieve a Sentry issue, you can use the following MCP tool call:

```
<use_mcp_tool>
<server_name>github.com/modelcontextprotocol/servers/tree/main/src/sentry</server_name>
<tool_name>get_sentry_issue</tool_name>
<arguments>
{
  "issue_id_or_url": "YOUR_ISSUE_ID_OR_URL"
}
</arguments>
</use_mcp_tool>
```

Replace `YOUR_ISSUE_ID_OR_URL` with a valid Sentry issue ID or URL.

### Example 2: Analyzing a Sentry Issue from a URL

If you have a Sentry issue URL, you can use it directly:

```
<use_mcp_tool>
<server_name>github.com/modelcontextprotocol/servers/tree/main/src/sentry</server_name>
<tool_name>get_sentry_issue</tool_name>
<arguments>
{
  "issue_id_or_url": "https://sentry.io/organizations/your-org/issues/12345/"
}
</arguments>
</use_mcp_tool>
```

## Troubleshooting

If you encounter issues with the Sentry MCP server:

1. Ensure your Sentry authentication token is valid
2. Check that the server is running by using the MCP inspector:
   ```
   npx @modelcontextprotocol/inspector python -m mcp_server_sentry --auth-token YOUR_SENTRY_TOKEN
   ```
3. Verify that all dependencies are installed correctly
4. Check the server logs for any error messages

## Current Status

The Sentry MCP server has been successfully installed and configured. If you encounter issues, make sure that:

1. You're using the Python interpreter from the project's virtual environment
2. The MCP configuration file points to the correct Python interpreter path
3. Both `mcp` and `mcp-server-sentry` packages are installed in the virtual environment

You can verify your installation by running the verification script:
```bash
source /home/azureuser/newide/venv/bin/activate
python /home/azureuser/newide/MCP/sentry/verify_mcp_install.py
```

## Additional Resources

- [Sentry MCP Server GitHub Repository](https://github.com/modelcontextprotocol/servers/tree/main/src/sentry)
- [Sentry Documentation](https://docs.sentry.io/)
- [Model Context Protocol Documentation](https://modelcontextprotocol.github.io/)
