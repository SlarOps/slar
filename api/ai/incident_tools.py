"""
SLAR Incident Management Tools for Claude Agent SDK

Tools for fetching and managing incidents from the SLAR backend API.
"""

import os
import aiohttp
from typing import Any, Optional
from datetime import datetime
from claude_agent_sdk import tool, create_sdk_mcp_server


# Configuration
API_BASE_URL = os.getenv("SLAR_API_URL", "http://localhost:8080")
API_TOKEN = os.getenv("SLAR_API_TOKEN", "")

# Dynamic token storage (set per WebSocket session)
_dynamic_auth_token: Optional[str] = None


def set_auth_token(token: str) -> None:
    """
    Set the authentication token to use for API requests.
    This should be called at the start of each WebSocket session.

    Args:
        token: The JWT authentication token from the frontend
    """
    global _dynamic_auth_token
    _dynamic_auth_token = token
    print(f"🔑 Auth token set for incident_tools (length: {len(token) if token else 0})")


def get_auth_token() -> str:
    """
    Get the current authentication token.
    Prioritizes dynamic token over environment variable.

    Returns:
        The authentication token to use for API requests
    """
    return _dynamic_auth_token or API_TOKEN


# Implementation functions (callable directly)
async def _get_incidents_by_time_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Fetch incidents within a time range.

    Args:
        start_time: Start time in ISO 8601 format (e.g., "2024-01-01T00:00:00Z")
        end_time: End time in ISO 8601 format (e.g., "2024-01-01T23:59:59Z")
        status: Filter by status - "triggered", "acknowledged", "resolved", or "all" (default: "all")
        limit: Maximum number of incidents to return (default: 50, max: 1000)

    Returns:
        Dictionary with incident data or error information
    """
    start_time = args.get("start_time")
    end_time = args.get("end_time")
    status = args.get("status", "all")
    limit = args.get("limit", 50)

    # Validate inputs
    try:
        datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        datetime.fromisoformat(end_time.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as e:
        return {
            "content": [{
                "type": "text",
                "text": f"❌ Error: Invalid time format. Please use ISO 8601 format (e.g., '2024-01-01T00:00:00Z'). Error: {str(e)}"
            }],
            "isError": True
        }

    # Validate limit
    if limit < 1 or limit > 1000:
        return {
            "content": [{
                "type": "text",
                "text": "❌ Error: Limit must be between 1 and 1000"
            }],
            "isError": True
        }

    # Build query parameters
    params = {
        "start_time": start_time,
        "end_time": end_time,
        "limit": limit
    }

    if status != "all":
        params["status"] = status

    # Make API request
    try:
        headers = {
            "Authorization": f"Bearer {get_auth_token()}",
            "Content-Type": "application/json"
        }

        async with aiohttp.ClientSession() as session:
            url = f"{API_BASE_URL}/incidents"

            async with session.get(url, params=params, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    incidents = data.get("incidents", [])

                    # Format the response
                    if not incidents:
                        result_text = f"📭 No incidents found between {start_time} and {end_time}"
                        if status != "all":
                            result_text += f" with status '{status}'"
                    else:
                        result_text = f"📊 Found {len(incidents)} incident(s) between {start_time} and {end_time}\n\n"

                        for idx, incident in enumerate(incidents, 1):
                            result_text += f"**Incident #{idx}**\n"
                            result_text += f"  • ID: {incident.get('id', 'N/A')}\n"
                            result_text += f"  • Title: {incident.get('title', 'N/A')}\n"
                            result_text += f"  • Status: {incident.get('status', 'N/A')}\n"
                            result_text += f"  • Severity: {incident.get('severity', 'N/A')}\n"
                            result_text += f"  • Service: {incident.get('service_name', 'N/A')}\n"
                            result_text += f"  • Created: {incident.get('created_at', 'N/A')}\n"
                            result_text += f"  • Assigned to: {incident.get('assigned_to_name', 'Unassigned')}\n"

                            if incident.get('acknowledged_at'):
                                result_text += f"  • Acknowledged: {incident.get('acknowledged_at')}\n"
                            if incident.get('resolved_at'):
                                result_text += f"  • Resolved: {incident.get('resolved_at')}\n"

                            result_text += "\n"

                    return {
                        "content": [{
                            "type": "text",
                            "text": result_text
                        }]
                    }

                elif response.status == 401:
                    return {
                        "content": [{
                            "type": "text",
                            "text": "❌ Error: Authentication failed. Please check your API token."
                        }],
                        "isError": True
                    }

                else:
                    error_text = await response.text()
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"❌ Error: API request failed with status {response.status}\n{error_text}"
                        }],
                        "isError": True
                    }

    except aiohttp.ClientError as e:
        return {
            "content": [{
                "type": "text",
                "text": f"❌ Error: Network error occurred: {str(e)}\nPlease check if the SLAR API is running at {API_BASE_URL}"
            }],
            "isError": True
        }

    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"❌ Error: Unexpected error occurred: {str(e)}"
            }],
            "isError": True
        }


async def _get_incident_by_id_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Fetch detailed information about a specific incident.

    Args:
        incident_id: The unique identifier of the incident

    Returns:
        Dictionary with detailed incident data or error information
    """
    incident_id = args.get("incident_id")

    if not incident_id:
        return {
            "content": [{
                "type": "text",
                "text": "❌ Error: incident_id is required"
            }],
            "isError": True
        }

    try:
        headers = {
            "Authorization": f"Bearer {get_auth_token()}",
            "Content-Type": "application/json"
        }

        async with aiohttp.ClientSession() as session:
            url = f"{API_BASE_URL}/incidents/{incident_id}"

            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    incident = await response.json()

                    # Format detailed response
                    result_text = f"🔍 **Incident Details**\n\n"
                    result_text += f"**Basic Information:**\n"
                    result_text += f"  • ID: {incident.get('id', 'N/A')}\n"
                    result_text += f"  • Title: {incident.get('title', 'N/A')}\n"
                    result_text += f"  • Description: {incident.get('description', 'N/A')}\n"
                    result_text += f"  • Status: {incident.get('status', 'N/A')}\n"
                    result_text += f"  • Severity: {incident.get('severity', 'N/A')}\n"
                    result_text += f"  • Urgency: {incident.get('urgency', 'N/A')}\n\n"

                    result_text += f"**Service:**\n"
                    result_text += f"  • Service: {incident.get('service_name', 'N/A')}\n"
                    result_text += f"  • Service ID: {incident.get('service_id', 'N/A')}\n\n"

                    result_text += f"**Assignment:**\n"
                    result_text += f"  • Assigned to: {incident.get('assigned_to_name', 'Unassigned')}\n"
                    result_text += f"  • Assigned to ID: {incident.get('assigned_to', 'N/A')}\n\n"

                    result_text += f"**Timeline:**\n"
                    result_text += f"  • Created: {incident.get('created_at', 'N/A')}\n"

                    if incident.get('acknowledged_at'):
                        result_text += f"  • Acknowledged: {incident.get('acknowledged_at')}\n"
                        result_text += f"  • Acknowledged by: {incident.get('acknowledged_by_name', 'N/A')}\n"

                    if incident.get('resolved_at'):
                        result_text += f"  • Resolved: {incident.get('resolved_at')}\n"
                        result_text += f"  • Resolved by: {incident.get('resolved_by_name', 'N/A')}\n"

                    result_text += f"\n**Metadata:**\n"
                    if incident.get('alert_key'):
                        result_text += f"  • Alert Key: {incident.get('alert_key')}\n"
                    if incident.get('escalation_policy_id'):
                        result_text += f"  • Escalation Policy: {incident.get('escalation_policy_id')}\n"

                    return {
                        "content": [{
                            "type": "text",
                            "text": result_text
                        }]
                    }

                elif response.status == 404:
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"❌ Error: Incident with ID '{incident_id}' not found"
                        }],
                        "isError": True
                    }

                elif response.status == 401:
                    return {
                        "content": [{
                            "type": "text",
                            "text": "❌ Error: Authentication failed. Please check your API token."
                        }],
                        "isError": True
                    }

                else:
                    error_text = await response.text()
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"❌ Error: API request failed with status {response.status}\n{error_text}"
                        }],
                        "isError": True
                    }

    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"❌ Error: {str(e)}"
            }],
            "isError": True
        }


async def _get_incident_stats_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Get incident statistics for a time range.

    Args:
        time_range: Time range for stats - "24h", "7d", "30d", or "all"

    Returns:
        Dictionary with statistics or error information
    """
    time_range = args.get("time_range", "24h")

    valid_ranges = ["24h", "7d", "30d", "all"]
    if time_range not in valid_ranges:
        return {
            "content": [{
                "type": "text",
                "text": f"❌ Error: Invalid time_range. Must be one of: {', '.join(valid_ranges)}"
            }],
            "isError": True
        }

    try:
        headers = {
            "Authorization": f"Bearer {get_auth_token()}",
            "Content-Type": "application/json"
        }

        async with aiohttp.ClientSession() as session:
            url = f"{API_BASE_URL}/incidents/stats"
            params = {"time_range": time_range}

            async with session.get(url, params=params, headers=headers) as response:
                if response.status == 200:
                    stats = await response.json()

                    # Format stats response
                    result_text = f"📈 **Incident Statistics ({time_range})**\n\n"
                    result_text += f"**Overall:**\n"
                    result_text += f"  • Total Incidents: {stats.get('total', 0)}\n"
                    result_text += f"  • Triggered: {stats.get('triggered', 0)}\n"
                    result_text += f"  • Acknowledged: {stats.get('acknowledged', 0)}\n"
                    result_text += f"  • Resolved: {stats.get('resolved', 0)}\n\n"

                    if stats.get('by_severity'):
                        result_text += f"**By Severity:**\n"
                        for severity, count in stats['by_severity'].items():
                            result_text += f"  • {severity}: {count}\n"
                        result_text += "\n"

                    if stats.get('avg_resolution_time'):
                        result_text += f"**Performance:**\n"
                        result_text += f"  • Avg Resolution Time: {stats.get('avg_resolution_time')}\n"
                        result_text += f"  • Avg Acknowledgment Time: {stats.get('avg_ack_time', 'N/A')}\n"

                    return {
                        "content": [{
                            "type": "text",
                            "text": result_text
                        }]
                    }

                elif response.status == 401:
                    return {
                        "content": [{
                            "type": "text",
                            "text": "❌ Error: Authentication failed. Please check your API token."
                        }],
                        "isError": True
                    }

                else:
                    error_text = await response.text()
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"❌ Error: API request failed with status {response.status}\n{error_text}"
                        }],
                        "isError": True
                    }

    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"❌ Error: {str(e)}"
            }],
            "isError": True
        }


# Create tool wrappers for Claude Agent SDK
@tool(
    "get_incidents_by_time",
    "Fetch incidents from SLAR within a specific time range. Use this to retrieve incidents that occurred between start_time and end_time.",
    {
        "start_time": str,  # ISO 8601 format: 2024-01-01T00:00:00Z
        "end_time": str,    # ISO 8601 format: 2024-01-01T23:59:59Z
        "status": str,      # Optional: "triggered", "acknowledged", "resolved", "all"
        "limit": int,       # Optional: Max number of incidents to return (default: 50)
    }
)
async def get_incidents_by_time(args: dict[str, Any]) -> dict[str, Any]:
    """Wrapper for Claude Agent SDK"""
    return await _get_incidents_by_time_impl(args)


@tool(
    "get_incident_by_id",
    "Fetch detailed information about a specific incident by its ID",
    {
        "incident_id": str,  # The incident ID
    }
)
async def get_incident_by_id(args: dict[str, Any]) -> dict[str, Any]:
    """Wrapper for Claude Agent SDK"""
    return await _get_incident_by_id_impl(args)


@tool(
    "get_incident_stats",
    "Get statistics about incidents in the system",
    {
        "time_range": str,  # "24h", "7d", "30d", or "all"
    }
)
async def get_incident_stats(args: dict[str, Any]) -> dict[str, Any]:
    """Wrapper for Claude Agent SDK"""
    return await _get_incident_stats_impl(args)


async def _get_current_time_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Get the current date and time in ISO 8601 format (UTC).
    Useful for determining time ranges when querying incidents.

    Returns:
        Dictionary with current time and common time ranges
    """
    from datetime import datetime, timedelta

    # Get current time in UTC
    now = datetime.utcnow()

    # Format response with common time ranges
    result_text = f"🕐 **Current Time (UTC)**\n\n"
    result_text += f"Current: {now.strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
    result_text += f"1 hour ago: {(now - timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
    result_text += f"24 hours ago: {(now - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
    result_text += f"7 days ago: {(now - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"

    return {
        "content": [{
            "type": "text",
            "text": result_text
        }]
    }


@tool(
    "get_current_time",
    "Get the current date and time in ISO 8601 format (UTC). Use this to determine time ranges for querying incidents.",
    {}
)
async def get_current_time(args: dict[str, Any]) -> dict[str, Any]:
    """Wrapper for Claude Agent SDK"""
    return await _get_current_time_impl(args)


# Export all tools as a list for easy registration
INCIDENT_TOOLS = [
    get_incidents_by_time,
    get_incident_by_id,
    get_incident_stats,
    get_current_time,
]

# Create MCP server for incident tools
def create_incident_tools_server():
    """
    Create and return an MCP server with all incident management tools.

    This centralizes tool management - when you add new tools to INCIDENT_TOOLS,
    they will automatically be included in the MCP server.

    Returns:
        MCP server instance configured with all incident tools
    """
    return create_sdk_mcp_server(
        name="incident_tools",
        version="1.0.0",
        tools=INCIDENT_TOOLS
    )


# Export implementation functions for direct testing
__all__ = [
    'INCIDENT_TOOLS',
    'create_incident_tools_server',
    '_get_incidents_by_time_impl',
    '_get_incident_by_id_impl',
    '_get_incident_stats_impl',
    '_get_current_time_impl',
    'set_auth_token',
    'get_auth_token',
    'get_current_time',
]
