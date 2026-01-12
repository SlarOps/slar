"""
SLAR Incident Management Tools for Claude Agent SDK

Tools for fetching and managing incidents directly from the database.
This is an internal service - no API authentication required.
"""

import os
from datetime import datetime, timedelta
from typing import Any, Optional
from contextvars import ContextVar

import psycopg2
from psycopg2.extras import RealDictCursor
from claude_agent_sdk import create_sdk_mcp_server, tool

from config import config

# Context variables for tenant isolation (ReBAC)
_org_id_ctx: ContextVar[Optional[str]] = ContextVar("org_id", default=None)
_project_id_ctx: ContextVar[Optional[str]] = ContextVar("project_id", default=None)


def set_org_id(org_id: str) -> None:
    """Set the organization ID for tenant isolation."""
    _org_id_ctx.set(org_id)


def get_org_id() -> str:
    """Get the current organization ID."""
    return _org_id_ctx.get() or os.getenv("SLAR_ORG_ID", "")


def set_project_id(project_id: str) -> None:
    """Set the project ID for optional filtering."""
    _project_id_ctx.set(project_id)


def get_project_id() -> str:
    """Get the current project ID."""
    return _project_id_ctx.get() or ""


# Deprecated - kept for backward compatibility but no longer needed
def set_auth_token(token: str) -> None:
    """Deprecated: Auth token not needed for direct DB access."""
    pass


def get_auth_token() -> str:
    """Deprecated: Auth token not needed for direct DB access."""
    return ""


def _get_db_connection():
    """Get database connection using centralized config."""
    db_url = config.database_url
    if not db_url:
        raise Exception("DATABASE_URL not configured")
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)


async def _get_incidents_by_time_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Fetch incidents within a time range directly from database.

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
        start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as e:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: Invalid time format. Please use ISO 8601 format (e.g., '2024-01-01T00:00:00Z'). Error: {str(e)}",
                }
            ],
            "isError": True,
        }

    # Validate limit
    if limit < 1 or limit > 1000:
        return {
            "content": [
                {"type": "text", "text": "Error: Limit must be between 1 and 1000"}
            ],
            "isError": True,
        }

    # ReBAC: Get org_id for tenant isolation
    org_id = args.get("org_id") or get_org_id()
    project_id = args.get("project_id") or get_project_id()

    try:
        conn = _get_db_connection()
        with conn.cursor() as cursor:
            # Build query with ReBAC filtering
            query = """
                SELECT
                    i.id, i.title, i.description, i.status, i.severity, i.urgency,
                    i.created_at, i.updated_at, i.acknowledged_at, i.resolved_at,
                    i.assigned_to, i.service_id,
                    u.name as assigned_to_name,
                    s.name as service_name
                FROM incidents i
                LEFT JOIN users u ON i.assigned_to = u.id
                LEFT JOIN services s ON i.service_id = s.id
                WHERE i.created_at >= %s AND i.created_at <= %s
            """
            params = [start_dt, end_dt]

            # Add status filter
            if status != "all":
                query += " AND i.status = %s"
                params.append(status)

            # Add ReBAC filters
            if org_id:
                query += " AND i.organization_id = %s"
                params.append(org_id)
            if project_id:
                query += " AND i.project_id = %s"
                params.append(project_id)

            query += " ORDER BY i.created_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(query, params)
            incidents = cursor.fetchall()

        conn.close()

        # Format the response
        if not incidents:
            result_text = f"No incidents found between {start_time} and {end_time}"
            if status != "all":
                result_text += f" with status '{status}'"
        else:
            result_text = f"Found {len(incidents)} incident(s) between {start_time} and {end_time}\n\n"

            for idx, incident in enumerate(incidents, 1):
                result_text += f"**Incident #{idx}**\n"
                result_text += f"  - ID: {incident['id']}\n"
                result_text += f"  - Title: {incident['title']}\n"
                result_text += f"  - Status: {incident['status']}\n"
                result_text += f"  - Severity: {incident['severity']}\n"
                result_text += f"  - Service: {incident['service_name'] or 'N/A'}\n"
                result_text += f"  - Created: {incident['created_at']}\n"
                result_text += f"  - Assigned to: {incident['assigned_to_name'] or 'Unassigned'}\n"

                if incident['acknowledged_at']:
                    result_text += f"  - Acknowledged: {incident['acknowledged_at']}\n"
                if incident['resolved_at']:
                    result_text += f"  - Resolved: {incident['resolved_at']}\n"

                result_text += "\n"

        return {"content": [{"type": "text", "text": result_text}]}

    except Exception as e:
        return {
            "content": [
                {"type": "text", "text": f"Error querying database: {str(e)}"}
            ],
            "isError": True,
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
            "content": [{"type": "text", "text": "Error: incident_id is required"}],
            "isError": True,
        }

    # ReBAC: Get org_id for tenant isolation
    org_id = args.get("org_id") or get_org_id()
    project_id = args.get("project_id") or get_project_id()

    try:
        conn = _get_db_connection()
        with conn.cursor() as cursor:
            query = """
                SELECT
                    i.id, i.title, i.description, i.status, i.severity, i.urgency,
                    i.created_at, i.updated_at, i.acknowledged_at, i.resolved_at,
                    i.assigned_to, i.acknowledged_by, i.resolved_by,
                    i.service_id, i.alert_key, i.escalation_policy_id,
                    i.organization_id, i.project_id,
                    u1.name as assigned_to_name,
                    u2.name as acknowledged_by_name,
                    u3.name as resolved_by_name,
                    s.name as service_name
                FROM incidents i
                LEFT JOIN users u1 ON i.assigned_to = u1.id
                LEFT JOIN users u2 ON i.acknowledged_by = u2.id
                LEFT JOIN users u3 ON i.resolved_by = u3.id
                LEFT JOIN services s ON i.service_id = s.id
                WHERE i.id = %s
            """
            params = [incident_id]

            # Add ReBAC filters
            if org_id:
                query += " AND i.organization_id = %s"
                params.append(org_id)
            if project_id:
                query += " AND i.project_id = %s"
                params.append(project_id)

            cursor.execute(query, params)
            incident = cursor.fetchone()

        conn.close()

        if not incident:
            return {
                "content": [
                    {"type": "text", "text": f"Error: Incident with ID '{incident_id}' not found"}
                ],
                "isError": True,
            }

        # Format detailed response
        result_text = f"**Incident Details**\n\n"
        result_text += f"**Basic Information:**\n"
        result_text += f"  - ID: {incident['id']}\n"
        result_text += f"  - Title: {incident['title']}\n"
        result_text += f"  - Description: {incident['description'] or 'N/A'}\n"
        result_text += f"  - Status: {incident['status']}\n"
        result_text += f"  - Severity: {incident['severity']}\n"
        result_text += f"  - Urgency: {incident['urgency']}\n\n"

        result_text += f"**Service:**\n"
        result_text += f"  - Service: {incident['service_name'] or 'N/A'}\n"
        result_text += f"  - Service ID: {incident['service_id'] or 'N/A'}\n\n"

        result_text += f"**Assignment:**\n"
        result_text += f"  - Assigned to: {incident['assigned_to_name'] or 'Unassigned'}\n"
        result_text += f"  - Assigned to ID: {incident['assigned_to'] or 'N/A'}\n\n"

        result_text += f"**Timeline:**\n"
        result_text += f"  - Created: {incident['created_at']}\n"

        if incident['acknowledged_at']:
            result_text += f"  - Acknowledged: {incident['acknowledged_at']}\n"
            result_text += f"  - Acknowledged by: {incident['acknowledged_by_name'] or 'N/A'}\n"

        if incident['resolved_at']:
            result_text += f"  - Resolved: {incident['resolved_at']}\n"
            result_text += f"  - Resolved by: {incident['resolved_by_name'] or 'N/A'}\n"

        result_text += f"\n**Metadata:**\n"
        if incident['alert_key']:
            result_text += f"  - Alert Key: {incident['alert_key']}\n"
        if incident['escalation_policy_id']:
            result_text += f"  - Escalation Policy: {incident['escalation_policy_id']}\n"

        return {"content": [{"type": "text", "text": result_text}]}

    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error: {str(e)}"}],
            "isError": True,
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
            "content": [
                {
                    "type": "text",
                    "text": f"Error: Invalid time_range. Must be one of: {', '.join(valid_ranges)}",
                }
            ],
            "isError": True,
        }

    # Calculate time filter
    now = datetime.utcnow()
    if time_range == "24h":
        start_time = now - timedelta(hours=24)
    elif time_range == "7d":
        start_time = now - timedelta(days=7)
    elif time_range == "30d":
        start_time = now - timedelta(days=30)
    else:
        start_time = None

    # ReBAC: Get org_id for tenant isolation
    org_id = args.get("org_id") or get_org_id()
    project_id = args.get("project_id") or get_project_id()

    try:
        conn = _get_db_connection()
        with conn.cursor() as cursor:
            # Build base WHERE clause
            where_clauses = []
            params = []

            if start_time:
                where_clauses.append("created_at >= %s")
                params.append(start_time)
            if org_id:
                where_clauses.append("organization_id = %s")
                params.append(org_id)
            if project_id:
                where_clauses.append("project_id = %s")
                params.append(project_id)

            where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

            # Get total counts by status
            cursor.execute(f"""
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'triggered') as triggered,
                    COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged,
                    COUNT(*) FILTER (WHERE status = 'resolved') as resolved
                FROM incidents
                WHERE {where_sql}
            """, params)
            counts = cursor.fetchone()

            # Get counts by severity
            cursor.execute(f"""
                SELECT severity, COUNT(*) as count
                FROM incidents
                WHERE {where_sql}
                GROUP BY severity
                ORDER BY
                    CASE severity
                        WHEN 'critical' THEN 1
                        WHEN 'error' THEN 2
                        WHEN 'warning' THEN 3
                        WHEN 'info' THEN 4
                        ELSE 5
                    END
            """, params)
            severity_counts = cursor.fetchall()

            # Get average resolution time (for resolved incidents)
            cursor.execute(f"""
                SELECT
                    AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) as avg_resolution_seconds,
                    AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at))) as avg_ack_seconds
                FROM incidents
                WHERE {where_sql} AND resolved_at IS NOT NULL
            """, params)
            timing = cursor.fetchone()

        conn.close()

        # Format stats response
        result_text = f"**Incident Statistics ({time_range})**\n\n"
        result_text += f"**Overall:**\n"
        result_text += f"  - Total Incidents: {counts['total']}\n"
        result_text += f"  - Triggered: {counts['triggered']}\n"
        result_text += f"  - Acknowledged: {counts['acknowledged']}\n"
        result_text += f"  - Resolved: {counts['resolved']}\n\n"

        if severity_counts:
            result_text += f"**By Severity:**\n"
            for row in severity_counts:
                result_text += f"  - {row['severity']}: {row['count']}\n"
            result_text += "\n"

        if timing and timing['avg_resolution_seconds']:
            avg_res = timedelta(seconds=int(timing['avg_resolution_seconds']))
            result_text += f"**Performance:**\n"
            result_text += f"  - Avg Resolution Time: {avg_res}\n"
            if timing['avg_ack_seconds']:
                avg_ack = timedelta(seconds=int(timing['avg_ack_seconds']))
                result_text += f"  - Avg Acknowledgment Time: {avg_ack}\n"

        return {"content": [{"type": "text", "text": result_text}]}

    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error: {str(e)}"}],
            "isError": True,
        }


async def _get_current_time_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Get the current date and time in ISO 8601 format (UTC).
    Useful for determining time ranges when querying incidents.

    Returns:
        Dictionary with current time and common time ranges
    """
    now = datetime.utcnow()

    result_text = f"**Current Time (UTC)**\n\n"
    result_text += f"Current: {now.strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
    result_text += f"1 hour ago: {(now - timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
    result_text += f"24 hours ago: {(now - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
    result_text += f"7 days ago: {(now - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"

    return {"content": [{"type": "text", "text": result_text}]}


async def _search_incidents_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Search incidents using full-text search.

    Args:
        query: Search query string (e.g., "CPU high", "database connection")
        status: Optional filter by status
        severity: Optional filter by severity
        limit: Maximum number of incidents to return (default: 20, max: 100)

    Returns:
        Dictionary with search results
    """
    query = args.get("query", "")
    status = args.get("status", "all")
    severity = args.get("severity", "")
    limit = args.get("limit", 20)

    if not query or query.strip() == "":
        return {
            "content": [
                {"type": "text", "text": "Error: Search query is required"}
            ],
            "isError": True,
        }

    if limit < 1 or limit > 100:
        return {
            "content": [
                {"type": "text", "text": "Error: Limit must be between 1 and 100"}
            ],
            "isError": True,
        }

    # ReBAC: Get org_id for tenant isolation
    org_id = args.get("org_id") or get_org_id()
    project_id = args.get("project_id") or get_project_id()

    try:
        conn = _get_db_connection()
        with conn.cursor() as cursor:
            # Build search query with ILIKE for simple search
            # Could use full-text search (tsvector) for better results
            search_pattern = f"%{query}%"

            sql = """
                SELECT
                    i.id, i.title, i.description, i.status, i.severity,
                    i.created_at, i.acknowledged_at, i.resolved_at,
                    i.assigned_to,
                    u.name as assigned_to_name,
                    s.name as service_name
                FROM incidents i
                LEFT JOIN users u ON i.assigned_to = u.id
                LEFT JOIN services s ON i.service_id = s.id
                WHERE (i.title ILIKE %s OR i.description ILIKE %s)
            """
            params = [search_pattern, search_pattern]

            if status != "all":
                sql += " AND i.status = %s"
                params.append(status)

            if severity:
                sql += " AND i.severity = %s"
                params.append(severity)

            if org_id:
                sql += " AND i.organization_id = %s"
                params.append(org_id)

            if project_id:
                sql += " AND i.project_id = %s"
                params.append(project_id)

            sql += " ORDER BY i.created_at DESC LIMIT %s"
            params.append(limit)

            cursor.execute(sql, params)
            incidents = cursor.fetchall()

        conn.close()

        # Format the response
        if not incidents:
            result_text = f"No incidents found matching '{query}'"
            if status != "all":
                result_text += f" with status '{status}'"
            if severity:
                result_text += f" and severity '{severity}'"
        else:
            result_text = f"Found {len(incidents)} incident(s) matching '{query}'\n\n"

            for idx, incident in enumerate(incidents, 1):
                result_text += f"**Incident #{idx}**\n"
                result_text += f"  - ID: {incident['id']}\n"
                result_text += f"  - Title: {incident['title']}\n"
                result_text += f"  - Status: {incident['status']}\n"
                result_text += f"  - Severity: {incident['severity']}\n"
                result_text += f"  - Service: {incident['service_name'] or 'N/A'}\n"
                result_text += f"  - Created: {incident['created_at']}\n"
                result_text += f"  - Assigned to: {incident['assigned_to_name'] or 'Unassigned'}\n"

                if incident['acknowledged_at']:
                    result_text += f"  - Acknowledged: {incident['acknowledged_at']}\n"
                if incident['resolved_at']:
                    result_text += f"  - Resolved: {incident['resolved_at']}\n"

                result_text += "\n"

        return {"content": [{"type": "text", "text": result_text}]}

    except Exception as e:
        return {
            "content": [
                {"type": "text", "text": f"Error: {str(e)}"}
            ],
            "isError": True,
        }


# Tool decorators for Claude Agent SDK
@tool(
    "get_incidents_by_time",
    "Fetch incidents from SLAR within a specific time range. Use this to retrieve incidents that occurred between start_time and end_time.",
    {
        "start_time": str,
        "end_time": str,
        "status": str,
        "limit": int,
    },
)
async def get_incidents_by_time(args: dict[str, Any]) -> dict[str, Any]:
    return await _get_incidents_by_time_impl(args)


@tool(
    "get_incident_by_id",
    "Fetch detailed information about a specific incident by its ID",
    {"incident_id": str},
)
async def get_incident_by_id(args: dict[str, Any]) -> dict[str, Any]:
    return await _get_incident_by_id_impl(args)


@tool(
    "get_incident_stats",
    "Get statistics about incidents in the system",
    {"time_range": str},
)
async def get_incident_stats(args: dict[str, Any]) -> dict[str, Any]:
    return await _get_incident_stats_impl(args)


@tool(
    "get_current_time",
    "Get the current date and time in ISO 8601 format (UTC). Use this to determine time ranges for querying incidents.",
    {},
)
async def get_current_time(args: dict[str, Any]) -> dict[str, Any]:
    return await _get_current_time_impl(args)


@tool(
    "search_incidents",
    "Search incidents using full-text search. Use this to find incidents by keywords, phrases, or descriptions.",
    {
        "query": str,
        "status": str,
        "severity": str,
        "limit": int,
    },
)
async def search_incidents(args: dict[str, Any]) -> dict[str, Any]:
    return await _search_incidents_impl(args)


# Export all tools as a list
INCIDENT_TOOLS = [
    get_incidents_by_time,
    get_incident_by_id,
    get_incident_stats,
    get_current_time,
    search_incidents,
]


def create_incident_tools_server():
    """
    Create and return an MCP server with incident management tools.
    """
    return create_sdk_mcp_server(
        name="incident_tools", version="1.0.0", tools=INCIDENT_TOOLS
    )


__all__ = [
    "INCIDENT_TOOLS",
    "create_incident_tools_server",
    "set_org_id",
    "get_org_id",
    "set_project_id",
    "get_project_id",
    "set_auth_token",  # Deprecated but kept for compatibility
    "get_auth_token",  # Deprecated but kept for compatibility
]
