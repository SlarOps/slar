"""
Audit log routes for AI Agent API.
Provides endpoints to query and export audit logs.

Split from claude_agent_api_v1.py for better code organization.
"""

import csv
import io
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from database_util import execute_query
from supabase_storage import extract_user_id_from_token

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api", tags=["audit"])


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """
    Sanitize error messages to prevent information disclosure.
    """
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)

    if isinstance(error, (ConnectionError, TimeoutError)):
        return "Service temporarily unavailable. Please try again."
    elif isinstance(error, PermissionError):
        return "Access denied. Please check your permissions."
    elif isinstance(error, ValueError):
        return "Invalid input provided. Please check your request."
    elif "auth" in str(error).lower() or "token" in str(error).lower():
        return "Authentication failed. Please verify your credentials."
    elif "database" in str(error).lower() or "postgres" in str(error).lower():
        return "Database error. Please contact support if this persists."
    else:
        return "An internal error occurred. Please contact support if this persists."


def _get_user_id_from_request(request: Request) -> tuple[str | None, dict | None]:
    """
    Extract user_id from request. Returns (user_id, error_response).
    If error, user_id is None and error_response contains the error dict.
    """
    auth_token = request.query_params.get("auth_token") or request.headers.get(
        "authorization", ""
    )

    if not auth_token:
        return None, {"success": False, "error": "Authentication required"}

    # Remove "Bearer " prefix if present
    if auth_token.lower().startswith("bearer "):
        auth_token = auth_token[7:]

    user_id = extract_user_id_from_token(auth_token)
    if not user_id:
        return None, {"success": False, "error": "Invalid or expired authentication token"}

    return user_id, None


@router.get("/audit-logs")
async def get_audit_logs(request: Request):
    """
    Get audit logs with filtering and pagination.

    Query Parameters:
    - org_id: Organization ID (required for ReBAC)
    - project_id: Project ID (optional)
    - event_category: Filter by category (session, chat, tool, security)
    - event_type: Filter by specific event type
    - status: Filter by status (success, failure, pending)
    - user_id: Filter by specific user
    - session_id: Filter by session ID
    - start_date: Start date (ISO string)
    - end_date: End date (ISO string)
    - limit: Max results (default 50, max 500)
    - offset: Pagination offset
    """
    user_id, error = _get_user_id_from_request(request)
    if error:
        return error

    try:
        # Get query parameters
        org_id = request.query_params.get("org_id")
        project_id = request.query_params.get("project_id")
        event_category = request.query_params.get("event_category")
        event_type = request.query_params.get("event_type")
        status = request.query_params.get("status")
        filter_user_id = request.query_params.get("user_id")
        session_id = request.query_params.get("session_id")
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        limit = min(int(request.query_params.get("limit", 50)), 500)
        offset = int(request.query_params.get("offset", 0))

        # Build query with filters using %s placeholders for psycopg2
        conditions = ["1=1"]
        params = []

        # User can see all their own logs (regardless of org_id/project_id)
        conditions.append("user_id = %s")
        params.append(user_id)

        if org_id:
            conditions.append("org_id = %s")
            params.append(org_id)

        if project_id:
            conditions.append("project_id = %s")
            params.append(project_id)

        if event_category:
            conditions.append("event_category = %s")
            params.append(event_category)

        if event_type:
            conditions.append("event_type = %s")
            params.append(event_type)

        if status:
            conditions.append("status = %s")
            params.append(status)

        if filter_user_id:
            conditions.append("user_id = %s")
            params.append(filter_user_id)

        if session_id:
            conditions.append("session_id = %s")
            params.append(session_id)

        if start_date:
            conditions.append("event_time >= %s")
            params.append(start_date)

        if end_date:
            conditions.append("event_time <= %s")
            params.append(end_date)

        where_clause = " AND ".join(conditions)

        # Count total
        count_query = f"""
            SELECT COUNT(*) as total
            FROM agent_audit_logs
            WHERE {where_clause}
        """
        count_result = execute_query(count_query, tuple(params), fetch="one")
        total = count_result["total"] if count_result else 0

        # Get logs with pagination
        query = f"""
            SELECT
                event_id,
                event_time,
                event_type,
                event_category,
                user_id,
                user_email,
                org_id,
                project_id,
                session_id,
                device_cert_id,
                source_ip,
                user_agent,
                instance_id,
                action,
                resource_type,
                resource_id,
                request_params,
                status,
                error_code,
                error_message,
                response_data,
                duration_ms,
                metadata
            FROM agent_audit_logs
            WHERE {where_clause}
            ORDER BY event_time DESC
            LIMIT %s OFFSET %s
        """
        params.extend([limit, offset])

        logs = execute_query(query, tuple(params), fetch="all") or []

        # Convert to serializable format
        formatted_logs = []
        for log in logs:
            formatted_log = dict(log)
            # Convert datetime to ISO string
            if formatted_log.get("event_time"):
                formatted_log["event_time"] = formatted_log["event_time"].isoformat()
            formatted_logs.append(formatted_log)

        return {
            "success": True,
            "logs": formatted_logs,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "fetching audit logs"),
            "logs": [],
            "total": 0,
        }


@router.get("/audit-logs/stats")
async def get_audit_stats(request: Request):
    """
    Get audit log statistics/summary.

    Query Parameters:
    - org_id: Organization ID (optional)
    - project_id: Project ID (optional)
    - start_date: Start date (ISO string)
    - end_date: End date (ISO string)
    """
    user_id, error = _get_user_id_from_request(request)
    if error:
        return error

    try:
        org_id = request.query_params.get("org_id")
        project_id = request.query_params.get("project_id")
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")

        # Default to last 24 hours if no date range
        if not start_date:
            start_date = (datetime.utcnow() - timedelta(days=1)).isoformat()
        if not end_date:
            end_date = datetime.utcnow().isoformat()

        # Build query conditions using %s placeholders
        conditions = ["1=1"]
        params = []

        # User can see all their own logs
        conditions.append("user_id = %s")
        params.append(user_id)

        if org_id:
            conditions.append("org_id = %s")
            params.append(org_id)

        if project_id:
            conditions.append("project_id = %s")
            params.append(project_id)

        conditions.append("event_time >= %s")
        params.append(start_date)

        conditions.append("event_time <= %s")
        params.append(end_date)

        where_clause = " AND ".join(conditions)

        # Get statistics
        stats_query = f"""
            SELECT
                COUNT(*) as total_events,
                COUNT(*) FILTER (WHERE event_category = 'tool') as tool_executions,
                COUNT(*) FILTER (WHERE event_category = 'security') as security_events,
                COUNT(*) FILTER (WHERE event_category = 'session') as session_events,
                COUNT(*) FILTER (WHERE event_category = 'chat') as chat_events,
                COUNT(*) FILTER (WHERE status = 'success') as success_count,
                COUNT(*) FILTER (WHERE status = 'failure') as failure_count,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT session_id) as unique_sessions
            FROM agent_audit_logs
            WHERE {where_clause}
        """

        result = execute_query(stats_query, tuple(params), fetch="one")

        if result:
            total = result["total_events"]
            success = result["success_count"]
            success_rate = round((success / total * 100), 1) if total > 0 else 0

            return {
                "success": True,
                "stats": {
                    "total_events": total,
                    "tool_executions": result["tool_executions"],
                    "security_events": result["security_events"],
                    "session_events": result["session_events"],
                    "chat_events": result["chat_events"],
                    "success_count": success,
                    "failure_count": result["failure_count"],
                    "success_rate": success_rate,
                    "unique_users": result["unique_users"],
                    "unique_sessions": result["unique_sessions"],
                },
            }

        return {
            "success": True,
            "stats": {
                "total_events": 0,
                "tool_executions": 0,
                "security_events": 0,
                "session_events": 0,
                "chat_events": 0,
                "success_count": 0,
                "failure_count": 0,
                "success_rate": 0,
                "unique_users": 0,
                "unique_sessions": 0,
            },
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "fetching audit stats"),
            "stats": None,
        }


@router.get("/audit-logs/export")
async def export_audit_logs(request: Request):
    """
    Export audit logs to CSV format.

    Query Parameters:
    - org_id: Organization ID (optional)
    - project_id: Project ID (optional)
    - event_category: Filter by category
    - start_date: Start date (ISO string)
    - end_date: End date (ISO string)
    """
    user_id, error = _get_user_id_from_request(request)
    if error:
        return error

    try:
        org_id = request.query_params.get("org_id")
        project_id = request.query_params.get("project_id")
        event_category = request.query_params.get("event_category")
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")

        # Build query conditions using %s placeholders
        conditions = ["1=1"]
        params = []

        # User can see all their own logs
        conditions.append("user_id = %s")
        params.append(user_id)

        if org_id:
            conditions.append("org_id = %s")
            params.append(org_id)

        if project_id:
            conditions.append("project_id = %s")
            params.append(project_id)

        if event_category:
            conditions.append("event_category = %s")
            params.append(event_category)

        if start_date:
            conditions.append("event_time >= %s")
            params.append(start_date)

        if end_date:
            conditions.append("event_time <= %s")
            params.append(end_date)

        where_clause = " AND ".join(conditions)

        # Get logs (limit to 10000 for export)
        query = f"""
            SELECT
                event_id,
                event_time,
                event_type,
                event_category,
                user_id,
                user_email,
                org_id,
                session_id,
                action,
                resource_type,
                resource_id,
                status,
                error_code,
                error_message,
                duration_ms,
                source_ip
            FROM agent_audit_logs
            WHERE {where_clause}
            ORDER BY event_time DESC
            LIMIT 10000
        """

        logs = execute_query(query, tuple(params), fetch="all") or []

        # Generate CSV
        output = io.StringIO()
        writer = csv.writer(output)

        # Write header
        writer.writerow([
            "Event ID",
            "Timestamp",
            "Event Type",
            "Category",
            "User ID",
            "User Email",
            "Org ID",
            "Session ID",
            "Action",
            "Resource Type",
            "Resource ID",
            "Status",
            "Error Code",
            "Error Message",
            "Duration (ms)",
            "Source IP",
        ])

        # Write rows
        for log in logs:
            writer.writerow([
                log.get("event_id", ""),
                log.get("event_time", "").isoformat() if log.get("event_time") else "",
                log.get("event_type", ""),
                log.get("event_category", ""),
                log.get("user_id", ""),
                log.get("user_email", ""),
                log.get("org_id", ""),
                log.get("session_id", ""),
                log.get("action", ""),
                log.get("resource_type", ""),
                log.get("resource_id", ""),
                log.get("status", ""),
                log.get("error_code", ""),
                log.get("error_message", ""),
                log.get("duration_ms", ""),
                log.get("source_ip", ""),
            ])

        output.seek(0)

        # Return as streaming response
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=audit-logs-{datetime.utcnow().strftime('%Y-%m-%d')}.csv"
            },
        )

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "exporting audit logs"),
        }
