"""
Audit log routes for AI Agent API (REFACTORED with dependency injection).
Provides endpoints to query and export audit logs.

Split from claude_agent_api_v1.py for better code organization.
"""

import csv
import io
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from typing import Optional

from dependencies import get_auth_context, AuthContext
from database_util import execute_query

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit-logs")
async def get_audit_logs(
    ctx: AuthContext = Depends(get_auth_context),
    event_category: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    filter_user_id: Optional[str] = Query(None, alias="user_id"),
    session_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """
    Get audit logs with filtering and pagination.

    Authentication:
    - Requires valid Authorization header

    Query Parameters:
    - org_id: Organization ID (optional - from dependency)
    - project_id: Project ID (optional - from dependency)
    - event_category: Filter by category (session, chat, tool, security)
    - event_type: Filter by specific event type
    - status: Filter by status (success, failure, pending)
    - user_id: Filter by specific user
    - session_id: Filter by session ID
    - start_date: Start date (ISO string)
    - end_date: End date (ISO string)
    - limit: Max results (default 50, max 500)
    - offset: Pagination offset

    Returns:
    - List of audit logs with pagination info
    """
    try:
        # Build query with filters using %s placeholders for psycopg2
        conditions = ["1=1"]
        params = []

        # User can see all their own logs (regardless of org_id/project_id)
        conditions.append("aal.user_id = %s")
        params.append(ctx.user_id)

        if ctx.org_id:
            conditions.append("aal.org_id = %s")
            params.append(ctx.org_id)

        if ctx.project_id:
            conditions.append("aal.project_id = %s")
            params.append(ctx.project_id)

        if event_category:
            conditions.append("aal.event_category = %s")
            params.append(event_category)

        if event_type:
            conditions.append("aal.event_type = %s")
            params.append(event_type)

        if status_filter:
            conditions.append("aal.status = %s")
            params.append(status_filter)

        if filter_user_id:
            conditions.append("aal.user_id = %s")
            params.append(filter_user_id)

        if session_id:
            conditions.append("aal.session_id = %s")
            params.append(session_id)

        if start_date:
            conditions.append("aal.event_time >= %s")
            params.append(start_date)

        if end_date:
            conditions.append("aal.event_time <= %s")
            params.append(end_date)

        where_clause = " AND ".join(conditions)

        # Count total (strip alias prefix for simple count — no JOIN needed)
        count_where = where_clause.replace("aal.", "")
        count_query = f"""
            SELECT COUNT(*) as total
            FROM agent_audit_logs
            WHERE {count_where}
        """
        count_result = execute_query(count_query, tuple(params), fetch="one")
        total = count_result["total"] if count_result else 0

        # Get logs with pagination — JOIN users to get email for all records
        query = f"""
            SELECT
                aal.event_id,
                aal.event_time,
                aal.event_type,
                aal.event_category,
                aal.user_id,
                COALESCE(u.email, aal.user_email) AS user_email,
                aal.org_id,
                aal.project_id,
                aal.session_id,
                aal.device_cert_id,
                aal.source_ip,
                aal.user_agent,
                aal.instance_id,
                aal.action,
                aal.resource_type,
                aal.resource_id,
                aal.request_params,
                aal.status,
                aal.error_code,
                aal.error_message,
                aal.response_data,
                aal.duration_ms,
                aal.metadata
            FROM agent_audit_logs aal
            LEFT JOIN users u ON u.id = aal.user_id
            WHERE {where_clause}
            ORDER BY aal.event_time DESC
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
        logger.error(f"Error fetching audit logs for user {ctx.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred fetching audit logs. Please try again."
        )


@router.get("/audit-logs/stats")
async def get_audit_stats(
    ctx: AuthContext = Depends(get_auth_context),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """
    Get audit log statistics/summary.

    Authentication:
    - Requires valid Authorization header

    Query Parameters:
    - org_id: Organization ID (optional - from dependency)
    - project_id: Project ID (optional - from dependency)
    - start_date: Start date (ISO string)
    - end_date: End date (ISO string)

    Returns:
    - Statistics aggregated by category, status, etc.
    """
    try:
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
        params.append(ctx.user_id)

        if ctx.org_id:
            conditions.append("org_id = %s")
            params.append(ctx.org_id)

        if ctx.project_id:
            conditions.append("project_id = %s")
            params.append(ctx.project_id)

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
        logger.error(f"Error fetching audit stats for user {ctx.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred fetching audit stats. Please try again."
        )


@router.get("/audit-logs/export")
async def export_audit_logs(
    ctx: AuthContext = Depends(get_auth_context),
    event_category: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """
    Export audit logs to CSV format.

    Authentication:
    - Requires valid Authorization header

    Query Parameters:
    - org_id: Organization ID (optional - from dependency)
    - project_id: Project ID (optional - from dependency)
    - event_category: Filter by category
    - start_date: Start date (ISO string)
    - end_date: End date (ISO string)

    Returns:
    - CSV file download with audit logs (max 10000 rows)
    """
    try:
        # Build query conditions using %s placeholders
        conditions = ["1=1"]
        params = []

        # User can see all their own logs
        conditions.append("aal.user_id = %s")
        params.append(ctx.user_id)

        if ctx.org_id:
            conditions.append("aal.org_id = %s")
            params.append(ctx.org_id)

        if ctx.project_id:
            conditions.append("aal.project_id = %s")
            params.append(ctx.project_id)

        if event_category:
            conditions.append("aal.event_category = %s")
            params.append(event_category)

        if start_date:
            conditions.append("aal.event_time >= %s")
            params.append(start_date)

        if end_date:
            conditions.append("aal.event_time <= %s")
            params.append(end_date)

        where_clause = " AND ".join(conditions)

        # Get logs (limit to 10000 for export) — JOIN users for email
        query = f"""
            SELECT
                aal.event_id,
                aal.event_time,
                aal.event_type,
                aal.event_category,
                aal.user_id,
                COALESCE(u.email, aal.user_email) AS user_email,
                aal.org_id,
                aal.session_id,
                aal.action,
                aal.resource_type,
                aal.resource_id,
                aal.status,
                aal.error_code,
                aal.error_message,
                aal.duration_ms,
                aal.source_ip
            FROM agent_audit_logs aal
            LEFT JOIN users u ON u.id = aal.user_id
            WHERE {where_clause}
            ORDER BY aal.event_time DESC
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
        logger.error(f"Error exporting audit logs for user {ctx.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred exporting audit logs. Please try again."
        )
