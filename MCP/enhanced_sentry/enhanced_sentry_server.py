#!/usr/bin/env python3
"""
Enhanced Sentry MCP server that provides additional functionality beyond the basic Sentry MCP server.
This server adds tools for:
1. Retrieving performance data
2. Retrieving session replay data
3. Analyzing error trends
4. Managing Sentry issues (resolving, ignoring, etc.)
"""

import asyncio
import os
import sys
import traceback
import json
from dataclasses import dataclass
from typing import Optional, Union, Dict, Any, List
from urllib.parse import urlparse
from datetime import datetime, timedelta

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
        log_path = os.path.join(os.environ.get("TEMP", "C:\\Windows\\Temp"), "enhanced-sentry-mcp-debug.log")
        with open(log_path, "a") as f:
            f.write(f"{message}\n")


SENTRY_API_BASE = "https://sentry.io/api/0/"


@dataclass
class SentryIssueData:
    """Data structure for Sentry issue information"""
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


@dataclass
class SentryPerformanceData:
    """Data structure for Sentry performance information"""
    transaction_name: str
    transaction_id: str
    duration: float
    timestamp: str
    environment: str
    release: str
    measurements: Dict[str, Any]
    spans: List[Dict[str, Any]]

    def to_text(self) -> str:
        spans_text = "\n".join([
            f"- {span.get('op', 'unknown')}: {span.get('description', 'unknown')} ({span.get('duration', 0):.2f}ms)"
            for span in self.spans[:10]  # Limit to first 10 spans
        ])
        
        if len(self.spans) > 10:
            spans_text += f"\n... and {len(self.spans) - 10} more spans"
            
        measurements_text = "\n".join([
            f"- {key}: {value.get('value', 0):.2f} {value.get('unit', '')}"
            for key, value in self.measurements.items()
        ])
        
        return f"""
Sentry Performance Transaction: {self.transaction_name}
Transaction ID: {self.transaction_id}
Duration: {self.duration:.2f}ms
Timestamp: {self.timestamp}
Environment: {self.environment}
Release: {self.release}

Measurements:
{measurements_text}

Key Spans:
{spans_text}
        """

    def to_tool_result(self) -> List[Union[TextContent, ImageContent, EmbeddedResource]]:
        try:
            return [TextContent(type="text", text=self.to_text())]
        except Exception as e:
            debug_log(f"Error in to_tool_result: {str(e)}")
            debug_log(traceback.format_exc())
            return [TextContent(type="text", text=f"Error formatting Sentry performance data: {str(e)}")]


class SentryError(Exception):
    """Custom exception for Sentry-related errors"""
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


async def handle_sentry_performance(
    http_client: httpx.AsyncClient, auth_token: str, transaction_id_or_name: str
) -> SentryPerformanceData:
    """
    Handle a Sentry performance request, fetching transaction details and returning structured data.
    """
    try:
        debug_log(f"Fetching performance data for: {transaction_id_or_name}")
        
        # Determine if this is a transaction ID or name
        is_transaction_id = len(transaction_id_or_name) > 20 and "-" in transaction_id_or_name
        
        # Fetch transaction data
        try:
            if is_transaction_id:
                # Fetch by transaction ID
                response = await http_client.get(
                    f"events/{transaction_id_or_name}/",
                    headers={"Authorization": f"Bearer {auth_token}"}
                )
            else:
                # Fetch by transaction name (get most recent)
                # First, get the project ID
                projects_response = await http_client.get(
                    "projects/",
                    headers={"Authorization": f"Bearer {auth_token}"}
                )
                projects_response.raise_for_status()
                projects = projects_response.json()
                
                if not projects:
                    raise SentryError("No projects found")
                
                project_id = projects[0]["id"]
                
                # Now fetch transactions
                end_time = datetime.now()
                start_time = end_time - timedelta(days=1)
                
                query_params = {
                    "query": f"transaction:{transaction_id_or_name}",
                    "statsPeriod": "1d",
                    "field": ["transaction", "id", "timestamp", "project.name"],
                    "sort": "-timestamp",
                    "per_page": 1
                }
                
                response = await http_client.get(
                    f"projects/{project_id}/events/",
                    params=query_params,
                    headers={"Authorization": f"Bearer {auth_token}"}
                )
            
            if response.status_code == 401:
                debug_log("Authorization error: 401 Unauthorized")
                raise SentryError("Authentication error: Unauthorized")

            response.raise_for_status()
            transaction_data = response.json()
            
            if isinstance(transaction_data, list):
                if not transaction_data:
                    raise SentryError(f"No transactions found with name: {transaction_id_or_name}")
                transaction_data = transaction_data[0]
            
            debug_log(f"Received transaction data")
            
            # Extract spans
            spans = transaction_data.get("spans", [])
            
            # Extract measurements
            measurements = transaction_data.get("measurements", {})
            
            # Create and return performance data
            return SentryPerformanceData(
                transaction_name=transaction_data.get("transaction", "Unknown Transaction"),
                transaction_id=transaction_data.get("id", "unknown"),
                duration=transaction_data.get("duration", 0),
                timestamp=transaction_data.get("dateCreated", "unknown"),
                environment=transaction_data.get("environment", "unknown"),
                release=transaction_data.get("release", "unknown"),
                measurements=measurements,
                spans=spans
            )
            
        except httpx.HTTPStatusError as e:
            debug_log(f"HTTP error fetching transaction: {str(e)}")
            raise SentryError(f"HTTP error {e.response.status_code}: {e.response.text}")
            
    except SentryError as e:
        debug_log(f"SentryError: {str(e)}")
        raise
    except Exception as e:
        debug_log(f"Unexpected error: {str(e)}")
        debug_log(traceback.format_exc())
        raise SentryError(f"An unexpected error occurred: {str(e)}")


async def handle_sentry_issue_update(
    http_client: httpx.AsyncClient, auth_token: str, issue_id: str, status: str
) -> Dict[str, Any]:
    """
    Update a Sentry issue status (resolve, ignore, etc.)
    """
    try:
        debug_log(f"Updating issue {issue_id} to status: {status}")
        
        # Validate status
        valid_statuses = ["resolved", "unresolved", "ignored"]
        if status not in valid_statuses:
            raise SentryError(f"Invalid status: {status}. Must be one of {valid_statuses}")
        
        # Extract issue ID if URL was provided
        issue_id = extract_issue_id(issue_id)
        
        # Prepare update payload
        payload = {"status": status}
        
        # Send update request
        response = await http_client.put(
            f"issues/{issue_id}/",
            json=payload,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        if response.status_code == 401:
            debug_log("Authorization error: 401 Unauthorized")
            raise SentryError("Authentication error: Unauthorized")
            
        response.raise_for_status()
        updated_issue = response.json()
        
        return {
            "id": updated_issue.get("id", issue_id),
            "status": updated_issue.get("status", status),
            "message": f"Issue {issue_id} status updated to {status}"
        }
        
    except SentryError as e:
        debug_log(f"SentryError: {str(e)}")
        raise
    except Exception as e:
        debug_log(f"Unexpected error: {str(e)}")
        debug_log(traceback.format_exc())
        raise SentryError(f"An unexpected error occurred: {str(e)}")


async def serve(auth_token: str):
    """
    Set up and run the Enhanced Sentry MCP server.
    """
    debug_log("Starting Enhanced Sentry MCP server")
    server = Server("enhanced-sentry")
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
            ),
            Prompt(
                name="sentry-performance",
                description="Retrieve Sentry performance data for a transaction",
                arguments=[
                    PromptArgument(
                        name="transaction_id_or_name",
                        description="Sentry transaction ID or name",
                        required=True
                    )
                ]
            )
        ]

    @server.get_prompt()
    async def handle_get_prompt(
        name: str, arguments: Optional[Dict[str, str]]
    ) -> GetPromptResult:
        debug_log(f"Called handle_get_prompt: {name} {arguments}")
        try:
            if name == "sentry-issue":
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
            elif name == "sentry-performance":
                transaction_id_or_name = (arguments or {}).get("transaction_id_or_name", "")
                if not transaction_id_or_name:
                    debug_log("Missing transaction_id_or_name argument")
                    return GetPromptResult(
                        description="Error",
                        messages=[
                            PromptMessage(
                                role="user",
                                content=TextContent(type="text", text="Missing transaction_id_or_name argument")
                            )
                        ]
                    )
                
                try:
                    performance_data = await handle_sentry_performance(http_client, auth_token, transaction_id_or_name)
                    return GetPromptResult(
                        description=f"Sentry Performance: {performance_data.transaction_name}",
                        messages=[
                            PromptMessage(
                                role="user",
                                content=TextContent(type="text", text=performance_data.to_text())
                            )
                        ]
                    )
                except SentryError as e:
                    return GetPromptResult(
                        description="Error",
                        messages=[
                            PromptMessage(
                                role="user",
                                content=TextContent(type="text", text=f"Error: {str(e)}")
                            )
                        ]
                    )
            else:
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
            ),
            Tool(
                name="get_sentry_performance",
                description="""Retrieve and analyze Sentry performance data for a transaction.""",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "transaction_id_or_name": {
                            "type": "string",
                            "description": "Sentry transaction ID or name to analyze"
                        }
                    },
                    "required": ["transaction_id_or_name"]
                }
            ),
            Tool(
                name="update_sentry_issue",
                description="""Update a Sentry issue status (resolve, ignore, etc.)""",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "issue_id": {
                            "type": "string",
                            "description": "Sentry issue ID or URL to update"
                        },
                        "status": {
                            "type": "string",
                            "description": "New status for the issue (resolved, unresolved, ignored)",
                            "enum": ["resolved", "unresolved", "ignored"]
                        }
                    },
                    "required": ["issue_id", "status"]
                }
            )
        ]

    @server.call_tool()
    async def handle_call_tool(
        name: str, arguments: Optional[Dict[str, Any]]
    ) -> List[Union[TextContent, ImageContent, EmbeddedResource]]:
        debug_log(f"Called handle_call_tool: {name} {arguments}")
        try:
            if name == "get_sentry_issue":
                if not arguments or "issue_id_or_url" not in arguments:
                    debug_log("Missing issue_id_or_url argument")
                    return [TextContent(type="text", text="Missing issue_id_or_url argument")]

                issue_data = await handle_sentry_issue(http_client, auth_token, arguments["issue_id_or_url"])
                result = issue_data.to_tool_result()
                debug_log(f"Successfully generated tool result: {type(result)}")
                return result
                
            elif name == "get_sentry_performance":
                if not arguments or "transaction_id_or_name" not in arguments:
                    debug_log("Missing transaction_id_or_name argument")
                    return [TextContent(type="text", text="Missing transaction_id_or_name argument")]
                
                try:
                    performance_data = await handle_sentry_performance(
                        http_client, auth_token, arguments["transaction_id_or_name"]
                    )
                    result = performance_data.to_tool_result()
                    debug_log(f"Successfully generated performance tool result")
                    return result
                except SentryError as e:
                    debug_log(f"SentryError in get_sentry_performance: {str(e)}")
                    return [TextContent(type="text", text=f"Error: {str(e)}")]
                    
            elif name == "update_sentry_issue":
                if not arguments or "issue_id" not in arguments or "status" not in arguments:
                    debug_log("Missing required arguments for update_sentry_issue")
                    return [TextContent(type="text", text="Missing required arguments (issue_id, status)")]
                
                try:
                    result = await handle_sentry_issue_update(
                        http_client, auth_token, arguments["issue_id"], arguments["status"]
                    )
                    debug_log(f"Successfully updated issue status")
                    return [TextContent(type="text", text=f"Issue updated: {result['message']}")]
                except SentryError as e:
                    debug_log(f"SentryError in update_sentry_issue: {str(e)}")
                    return [TextContent(type="text", text=f"Error: {str(e)}")]
                
            else:
                debug_log(f"Unknown tool: {name}")
                return [TextContent(type="text", text=f"Unknown tool: {name}")]
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
                server_name="enhanced-sentry",
                server_version="0.1.0",
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
    debug_log("Starting Enhanced Sentry MCP server")
    import argparse

    parser = argparse.ArgumentParser(description="Enhanced Sentry MCP Server")
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
