#!/usr/bin/env python3
"""
A fixed version of the Sentry MCP server that works around syntax and error handling issues.
"""

import asyncio
import os
import sys
import traceback
from dataclasses import dataclass
from typing import Optional, Union, Dict, Any, List
from urllib.parse import urlparse

import httpx
from mcp.server import Server, NotificationOptions
from mcp.server.models import InitializationOptions
from mcp.types import (
    Tool, TextContent, ImageContent, EmbeddedResource, PromptMessage, GetPromptResult, 
    Prompt, PromptArgument
)

# Enable debug logging
DEBUG = True
def debug_log(message):
    if DEBUG:
        import os
        log_path = os.path.join(os.environ.get("TEMP", "C:\\Windows\\Temp"), "sentry-mcp-debug.log")
        with open(log_path, "a") as f:
            f.write(f"{message}\n")


SENTRY_API_BASE = "https://sentry.io/api/0/"


@dataclass
class SentryIssueData:

    title: str
    issue_id: str
    status: str
    level: str
    first_seen: str
    last_seen: str
    count: int
    stacktrace: str

    def to_text(self) -> str:
        return f"""
Sentry Issue: {self.title}
Issue ID: {self.issue_id}
Status: {self.status}
Level: {self.level}
First Seen: {self.first_seen}
Last Seen: {self.last_seen}
Event Count: {self.count}

{self.stacktrace}
        """

    def to_prompt_result(self) -> GetPromptResult:
        try:
            return GetPromptResult(
                description=f"Sentry Issue: {self.title}",
                messages=[
                    PromptMessage(
                        role="user", 
                        content=TextContent(type="text", text=self.to_text())
                    )
                ]
            )
        except Exception as e:
            debug_log(f"Error in to_prompt_result: {str(e)}")
            debug_log(traceback.format_exc())
            raise

    def to_tool_result(self) -> List[Union[TextContent, ImageContent, EmbeddedResource]]:
        try:
            return [TextContent(type="text", text=self.to_text())]
        except Exception as e:
            debug_log(f"Error in to_tool_result: {str(e)}")
            debug_log(traceback.format_exc())
            # Return a simpler text content as fallback
            return [TextContent(type="text", text=f"Error formatting Sentry issue: {str(e)}")]


class SentryError(Exception):
    pass


def extract_issue_id(issue_id_or_url: str) -> str:
    """
    Extracts the Sentry issue ID from either a full URL or a standalone ID.
    """
    try:
        if not issue_id_or_url:
            raise SentryError("Missing issue_id_or_url argument")

        if issue_id_or_url.startswith(("http://", "https://")):
            parsed_url = urlparse(issue_id_or_url)
            if not parsed_url.hostname or not parsed_url.hostname.endswith(".sentry.io"):
                raise SentryError("Invalid Sentry URL. Must be a URL ending with .sentry.io")

            path_parts = parsed_url.path.strip("/").split("/")
            if len(path_parts) < 2 or path_parts[0] != "issues":
                raise SentryError(
                    "Invalid Sentry issue URL. Path must contain '/issues/{issue_id}'"
                )

            issue_id = path_parts[-1]
        else:
            issue_id = issue_id_or_url

        return issue_id
    except Exception as e:
        debug_log(f"Error in extract_issue_id: {str(e)}")
        debug_log(traceback.format_exc())
        raise


def create_stacktrace(latest_event: dict) -> str:
    """
    Creates a formatted stacktrace string from the latest Sentry event.
    """
    try:
        stacktraces = []
        for entry in latest_event.get("entries", []):
            if entry.get("type") != "exception":
                continue

            exception_data = entry.get("data", {}).get("values", [])
            for exception in exception_data:
                exception_type = exception.get("type", "Unknown")
                exception_value = exception.get("value", "")
                stacktrace = exception.get("stacktrace", {})

                stacktrace_text = f"Exception: {exception_type}: {exception_value}\n\n"
                if stacktrace:
                    stacktrace_text += "Stacktrace:\n"
                    for frame in stacktrace.get("frames", []):
                        filename = frame.get("filename", "Unknown")
                        lineno = frame.get("lineno", "?")
                        function = frame.get("function", "Unknown")

                        stacktrace_text += f"{filename}:{lineno} in {function}\n"

                        if "context" in frame:
                            context = frame["context"]
                            for ctx_line in context:
                                if isinstance(ctx_line, list) and len(ctx_line) > 1:
                                    stacktrace_text += f"    {ctx_line[1]}\n"

                        stacktrace_text += "\n"

                stacktraces.append(stacktrace_text)

        return "\n".join(stacktraces) if stacktraces else "No stacktrace found"
    except Exception as e:
        debug_log(f"Error in create_stacktrace: {str(e)}")
        debug_log(traceback.format_exc())
        return f"Error parsing stacktrace: {str(e)}"


async def handle_sentry_issue(
    http_client: httpx.AsyncClient, auth_token: str, issue_id_or_url: str
) -> SentryIssueData:
    """
    Handle a Sentry issue request, fetching the issue details and returning a structured response.
    """
    try:
        issue_id = extract_issue_id(issue_id_or_url)
        debug_log(f"Extracted issue ID: {issue_id}")

        # Fetch issue data
        try:
            response = await http_client.get(
                f"issues/{issue_id}/", 
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            if response.status_code == 401:
                debug_log("Authorization error: 401 Unauthorized")
                return SentryIssueData(
                    title="Authentication Error",
                    issue_id=issue_id,
                    status="error",
                    level="error",
                    first_seen="unknown",
                    last_seen="unknown",
                    count=0,
                    stacktrace="Error: Unauthorized. Please check your Sentry auth token."
                )
            
            response.raise_for_status()
            issue_data = response.json()
            debug_log(f"Received issue data for {issue_id}")
        except httpx.HTTPStatusError as e:
            debug_log(f"HTTP error fetching issue: {str(e)}")
            
            status_msg = "unknown"
            if e.response.status_code == 404:
                status_msg = "not found"
            elif e.response.status_code == 403:
                status_msg = "access denied"
            
            return SentryIssueData(
                title=f"HTTP Error {e.response.status_code}",
                issue_id=issue_id,
                status=status_msg,
                level="error",
                first_seen="unknown",
                last_seen="unknown",
                count=0,
                stacktrace=f"Error fetching Sentry issue: HTTP {e.response.status_code}\n{e.response.text}"
            )
        
        # Fetch issue hashes and latest event
        stacktrace = "No stacktrace available"
        try:
            hashes_response = await http_client.get(
                f"issues/{issue_id}/hashes/",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            hashes_response.raise_for_status()
            hashes = hashes_response.json()
            
            if hashes and len(hashes) > 0 and "latestEvent" in hashes[0]:
                latest_event = hashes[0]["latestEvent"]
                stacktrace = create_stacktrace(latest_event)
                debug_log("Successfully retrieved stacktrace")
        except Exception as e:
            debug_log(f"Error fetching hashes: {str(e)}")
            stacktrace = f"Could not retrieve stacktrace: {str(e)}"

        # Create and return the issue data
        return SentryIssueData(
            title=issue_data.get("title", "Unknown Title"),
            issue_id=issue_id,
            status=issue_data.get("status", "unknown"),
            level=issue_data.get("level", "unknown"),
            first_seen=issue_data.get("firstSeen", "unknown"),
            last_seen=issue_data.get("lastSeen", "unknown"),
            count=issue_data.get("count", 0),
            stacktrace=stacktrace
        )

    except SentryError as e:
        debug_log(f"SentryError: {str(e)}")
        return SentryIssueData(
            title="Sentry Error",
            issue_id=issue_id_or_url,
            status="error",
            level="error",
            first_seen="unknown",
            last_seen="unknown",
            count=0,
            stacktrace=f"Error: {str(e)}"
        )
    except Exception as e:
        debug_log(f"Unexpected error: {str(e)}")
        debug_log(traceback.format_exc())
        return SentryIssueData(
            title="Unexpected Error",
            issue_id=issue_id_or_url,
            status="error",
            level="error",
            first_seen="unknown",
            last_seen="unknown",
            count=0,
            stacktrace=f"An unexpected error occurred: {str(e)}\n\n{traceback.format_exc()}"
        )


async def serve(auth_token: str):
    """
    Set up and run the Sentry MCP server.
    """
    debug_log("Starting Sentry MCP server")
    server = Server("sentry")
    http_client = httpx.AsyncClient(base_url=SENTRY_API_BASE)

    @server.list_prompts()
    async def handle_list_prompts() -> list[Prompt]:
        debug_log("Called handle_list_prompts")
        return [
            Prompt(
                name="sentry-issue",
                description="Retrieve a Sentry issue by ID or URL",
                arguments=[
                    PromptArgument(
                        name="issue_id_or_url",
                        description="Sentry issue ID or URL",
                        required=True
                    )
                ]
            )
        ]

    @server.get_prompt()
    async def handle_get_prompt(
        name: str, arguments: Optional[Dict[str, str]]
    ) -> GetPromptResult:
        debug_log(f"Called handle_get_prompt: {name}, {arguments}")
        try:
            if name != "sentry-issue":
                debug_log(f"Unknown prompt: {name}")
                return GetPromptResult(
                    description="Error",
                    messages=[
                        PromptMessage(
                            role="user", 
                            content=TextContent(type="text", text=f"Unknown prompt: {name}")
                        )
                    ]
                )

            issue_id_or_url = (arguments or {}).get("issue_id_or_url", "")
            if not issue_id_or_url:
                debug_log("Missing issue_id_or_url argument")
                return GetPromptResult(
                    description="Error",
                    messages=[
                        PromptMessage(
                            role="user", 
                            content=TextContent(type="text", text="Missing issue_id_or_url argument")
                        )
                    ]
                )
                
            issue_data = await handle_sentry_issue(http_client, auth_token, issue_id_or_url)
            return issue_data.to_prompt_result()
        except Exception as e:
            debug_log(f"Error in handle_get_prompt: {str(e)}")
            debug_log(traceback.format_exc())
            return GetPromptResult(
                description="Error",
                messages=[
                    PromptMessage(
                        role="user", 
                        content=TextContent(type="text", text=f"Error: {str(e)}")
                    )
                ]
            )

    @server.list_tools()
    async def handle_list_tools() -> list[Tool]:
        debug_log("Called handle_list_tools")
        return [
            Tool(
                name="get_sentry_issue",
                description="""Retrieve and analyze a Sentry issue by ID or URL.""",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "issue_id_or_url": {
                            "type": "string",
                            "description": "Sentry issue ID or URL to analyze"
                        }
                    },
                    "required": ["issue_id_or_url"]
                }
            )
        ]

    @server.call_tool()
    async def handle_call_tool(
        name: str, arguments: Optional[Dict[str, Any]]
    ) -> List[Union[TextContent, ImageContent, EmbeddedResource]]:
        debug_log(f"Called handle_call_tool: {name}, {arguments}")
        try:
            if name != "get_sentry_issue":
                debug_log(f"Unknown tool: {name}")
                return [TextContent(type="text", text=f"Unknown tool: {name}")]

            if not arguments or "issue_id_or_url" not in arguments:
                debug_log("Missing issue_id_or_url argument")
                return [TextContent(type="text", text="Missing issue_id_or_url argument")]

            issue_data = await handle_sentry_issue(http_client, auth_token, arguments["issue_id_or_url"])
            result = issue_data.to_tool_result()
            debug_log(f"Successfully generated tool result: {type(result)}")
            return result
        except Exception as e:
            debug_log(f"Error in handle_call_tool: {str(e)}")
            debug_log(traceback.format_exc())
            return [TextContent(type="text", text=f"Error: {str(e)}\n\n{traceback.format_exc()}")]

    debug_log("Server handlers registered")
    return server


async def main_async(auth_token: str):
    """
    Async main function to start the server.
    """
    debug_log(f"Starting main_async with auth token length: {len(auth_token)}")
    import mcp.server.stdio
    
    try:
        async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
            debug_log("Got stdio streams")
            server = await serve(auth_token)
            debug_log("Server initialized, starting run")
            
            capabilities = server.get_capabilities(
                notification_options=NotificationOptions(),
                experimental_capabilities={}
            )
            debug_log(f"Server capabilities: {capabilities}")
            
            init_options = InitializationOptions(
                server_name="sentry",
                server_version="0.4.2-fixed",
                capabilities=capabilities
            )
            debug_log("Initialization options created, running server")
            
            await server.run(
                read_stream,
                write_stream,
                init_options
            )
    except Exception as e:
        debug_log(f"Error in main_async: {str(e)}")
        debug_log(traceback.format_exc())
        sys.exit(1)


def main():
    """
    Main entry point.
    """
    debug_log("Starting fixed Sentry MCP server")
    import argparse
    
    parser = argparse.ArgumentParser(description="Fixed Sentry MCP Server")
    parser.add_argument(
        "--auth-token", 
        required=True,
        help="Sentry authentication token"
    )
    
    args = parser.parse_args()
    debug_log(f"Got auth token (length: {len(args.auth_token)})")
    
    try:
        asyncio.run(main_async(args.auth_token))
    except Exception as e:
        debug_log(f"Error in main: {str(e)}")
        debug_log(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
