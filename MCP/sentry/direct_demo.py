#!/usr/bin/env python3
"""
Direct demonstration of Sentry API capabilities.
This script bypasses the MCP framework to demonstrate Sentry functionality.
"""

import asyncio
import json
import sys
from urllib.parse import urlparse
from dataclasses import dataclass

import httpx

SENTRY_API_BASE = "https://sentry.io/api/0/"
AUTH_TOKEN = "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"

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

    def display(self):
        print(f"\n{'='*80}")
        print(f"Sentry Issue: {self.title}")
        print(f"Issue ID: {self.issue_id}")
        print(f"Status: {self.status}")
        print(f"Level: {self.level}")
        print(f"First Seen: {self.first_seen}")
        print(f"Last Seen: {self.last_seen}")
        print(f"Event Count: {self.count}")
        print(f"\nStacktrace:\n{self.stacktrace}")
        print(f"{'='*80}\n")


class SentryError(Exception):
    pass


def extract_issue_id(issue_id_or_url: str) -> str:
    """
    Extracts the Sentry issue ID from either a full URL or a standalone ID.
    """
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


def create_stacktrace(latest_event: dict) -> str:
    """
    Creates a formatted stacktrace string from the latest Sentry event.
    """
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


async def get_sentry_issue(issue_id_or_url: str) -> SentryIssueData:
    """
    Fetch and display issue details from Sentry.
    """
    try:
        issue_id = extract_issue_id(issue_id_or_url)
        print(f"Fetching Sentry issue: {issue_id}")

        async with httpx.AsyncClient(base_url=SENTRY_API_BASE) as client:
            # Fetch issue data
            response = await client.get(
                f"issues/{issue_id}/", 
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"}
            )
            if response.status_code == 401:
                raise SentryError("Error: Unauthorized. Please check your Sentry auth token.")
            response.raise_for_status()
            issue_data = response.json()
            
            # Fetch issue hashes and latest event
            stacktrace = "No stacktrace available"
            try:
                hashes_response = await client.get(
                    f"issues/{issue_id}/hashes/",
                    headers={"Authorization": f"Bearer {AUTH_TOKEN}"}
                )
                hashes_response.raise_for_status()
                hashes = hashes_response.json()
                
                if hashes and len(hashes) > 0 and "latestEvent" in hashes[0]:
                    latest_event = hashes[0]["latestEvent"]
                    stacktrace = create_stacktrace(latest_event)
            except Exception as e:
                stacktrace = f"Could not retrieve stacktrace: {str(e)}"

            # Create the issue data
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
        print(f"Sentry Error: {str(e)}")
        return SentryIssueData(
            title="Error",
            issue_id=issue_id_or_url,
            status="error",
            level="error",
            first_seen="unknown",
            last_seen="unknown",
            count=0,
            stacktrace=f"Error: {str(e)}"
        )
    except httpx.HTTPStatusError as e:
        print(f"HTTP Error: {str(e)}")
        return SentryIssueData(
            title="HTTP Error",
            issue_id=issue_id_or_url,
            status="error",
            level="error",
            first_seen="unknown",
            last_seen="unknown",
            count=0,
            stacktrace=f"HTTP Error: {str(e)}"
        )
    except Exception as e:
        print(f"Unexpected Error: {str(e)}")
        return SentryIssueData(
            title="Unexpected Error",
            issue_id=issue_id_or_url,
            status="error",
            level="error",
            first_seen="unknown",
            last_seen="unknown",
            count=0,
            stacktrace=f"An unexpected error occurred: {str(e)}"
        )


async def list_organizations():
    """
    List organizations in the Sentry account.
    """
    print("Listing Sentry organizations...")
    
    async with httpx.AsyncClient(base_url=SENTRY_API_BASE) as client:
        response = await client.get(
            "organizations/", 
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"}
        )
        
        if response.status_code == 200:
            orgs = response.json()
            print(f"Found {len(orgs)} organization(s):")
            for org in orgs:
                print(f"  - {org.get('name', 'Unknown')} (slug: {org.get('slug', 'unknown')})")
            
            # Get first org for further examples
            if orgs:
                return orgs[0].get('slug')
        elif response.status_code == 401:
            print("Authentication failed: Invalid auth token")
        else:
            print(f"Request failed with status code: {response.status_code}")
            print(f"Response: {response.text}")
        
        return None


async def list_projects(org_slug):
    """
    List projects in a Sentry organization.
    """
    if not org_slug:
        print("No organization slug provided, skipping project listing")
        return None
        
    print(f"\nListing projects for organization: {org_slug}...")
    
    async with httpx.AsyncClient(base_url=SENTRY_API_BASE) as client:
        response = await client.get(
            f"organizations/{org_slug}/projects/", 
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"}
        )
        
        if response.status_code == 200:
            projects = response.json()
            print(f"Found {len(projects)} project(s):")
            for project in projects:
                print(f"  - {project.get('name', 'Unknown')} (slug: {project.get('slug', 'unknown')})")
            
            # Get first project for further examples
            if projects:
                return projects[0].get('slug')
        else:
            print(f"Request failed with status code: {response.status_code}")
            
        return None


async def list_issues(org_slug, project_slug, limit=5):
    """
    List recent issues in a Sentry project.
    """
    if not org_slug or not project_slug:
        print("Missing organization or project slug, skipping issue listing")
        return None
        
    print(f"\nListing recent issues for project: {project_slug}...")
    
    async with httpx.AsyncClient(base_url=SENTRY_API_BASE) as client:
        response = await client.get(
            f"projects/{org_slug}/{project_slug}/issues/", 
            params={"limit": limit},
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"}
        )
        
        if response.status_code == 200:
            issues = response.json()
            print(f"Found {len(issues)} recent issue(s):")
            for issue in issues:
                print(f"  - {issue.get('title', 'Unknown')} (ID: {issue.get('id', 'unknown')})")
                print(f"    Events: {issue.get('count', 0)}, Status: {issue.get('status', 'unknown')}")
                print(f"    First seen: {issue.get('firstSeen', 'unknown')}")
                print(f"    Last seen: {issue.get('lastSeen', 'unknown')}")
                print()
            
            # Return first issue ID for further examples
            if issues:
                return issues[0].get('id')
        else:
            print(f"Request failed with status code: {response.status_code}")
            
        return None


async def main():
    """
    Main function to demonstrate Sentry API capabilities.
    """
    print("="*80)
    print("Sentry API Demonstration")
    print("="*80)
    
    # Get issue ID from command line or use default demo ID
    issue_id = sys.argv[1] if len(sys.argv) > 1 else None
    
    # If no issue ID provided, list orgs, projects, and issues to find one
    if not issue_id:
        org_slug = await list_organizations()
        project_slug = await list_projects(org_slug)
        issue_id = await list_issues(org_slug, project_slug)
    
    # If we have an issue ID, get the details
    if issue_id:
        print(f"\nFetching detailed information for issue: {issue_id}\n")
        issue_data = await get_sentry_issue(issue_id)
        issue_data.display()
    else:
        print("\nNo issue ID available for detailed information")
    
    print("Demonstration complete")


if __name__ == "__main__":
    asyncio.run(main())
