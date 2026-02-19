"""
Cost tracking routes for AI Agent API (REFACTORED with dependency injection).
Provides endpoints to query and export AI cost logs (project-scoped).
"""

import io
import csv
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from dependencies import require_project_context, AuthContext
from database_util import execute_query

router = APIRouter()


def _parse_time_range(time_range: str) -> tuple:
    """Parse time range string to start/end dates"""
    end_date = datetime.utcnow()

    if time_range == "1h":
        start_date = end_date - timedelta(hours=1)
    elif time_range == "24h":
        start_date = end_date - timedelta(days=1)
    elif time_range == "7d":
        start_date = end_date - timedelta(days=7)
    elif time_range == "30d":
        start_date = end_date - timedelta(days=30)
    else:
        start_date = end_date - timedelta(days=1)  # default 24h

    return start_date, end_date


@router.get("/api/cost-logs")
async def get_cost_logs(
    ctx: AuthContext = Depends(require_project_context),
    model: Optional[str] = None,
    time_range: str = "24h",
    limit: int = 50,
    offset: int = 0,
):
    """
    Get cost logs with filtering and pagination (project-scoped).

    Requires both org_id and project_id (enforced by dependency).

    Query Parameters:
    - org_id: Organization ID (required)
    - project_id: Project ID (required - cost logs are project-scoped)
    - model: Filter by model name (optional)
    - time_range: Time range (1h, 24h, 7d, 30d) - default 24h
    - limit: Max results (default 50, max 500)
    - offset: Pagination offset
    """
    # Limit to max 500
    limit = min(limit, 500)

    # TODO: Add authorization check - verify user has access to this project
    # For now, trust that frontend sends correct project_id
    # Future: Call Go API to verify project access like credentials do

    # Build query conditions - show ALL costs for the project (not filtered by user)
    conditions = ["acl.org_id = %s", "acl.project_id = %s"]
    params = [ctx.org_id, ctx.project_id]

    # Model filter
    if model:
        conditions.append("acl.model = %s")
        params.append(model)

    # Time range
    start_date, end_date = _parse_time_range(time_range)
    conditions.append("acl.created_at >= %s")
    conditions.append("acl.created_at <= %s")
    params.extend([start_date, end_date])

    where_clause = " AND ".join(conditions)

    # Count total (no JOIN needed for count)
    count_where = where_clause.replace("acl.", "")
    count_query = f"SELECT COUNT(*) as total FROM ai_cost_logs WHERE {count_where}"
    count_result = execute_query(count_query, tuple(params), fetch="one")
    total = count_result.get("total", 0) if count_result else 0

    # Get logs (JOIN users to get email for all records including historical)
    query = f"""
        SELECT
            acl.event_id,
            acl.created_at,
            acl.user_id,
            u.email AS user_email,
            acl.org_id,
            acl.project_id,
            acl.session_id,
            acl.conversation_id,
            acl.message_id,
            acl.model,
            acl.request_type,
            acl.step_number,
            acl.input_tokens,
            acl.output_tokens,
            acl.cache_creation_input_tokens,
            acl.cache_read_input_tokens,
            acl.total_tokens,
            acl.total_cost_usd
        FROM ai_cost_logs acl
        LEFT JOIN users u ON u.id = acl.user_id
        WHERE {where_clause}
        ORDER BY acl.created_at DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])

    logs = execute_query(query, tuple(params), fetch="all")

    return {
        "success": True,
        "logs": logs or [],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/cost-logs/stats")
async def get_cost_stats(
    ctx: AuthContext = Depends(require_project_context),
    time_range: str = "24h",
):
    """
    Get cost statistics (project-scoped).

    Requires both org_id and project_id (enforced by dependency).

    Query Parameters:
    - org_id: Organization ID (required)
    - project_id: Project ID (required - cost logs are project-scoped)
    - time_range: Time range (1h, 24h, 7d, 30d) - default 24h

    Returns:
    - Overall stats (total cost, requests, tokens)
    - Cost by model
    - Cost by user
    - Daily breakdown
    """
    # TODO: Add authorization check - verify user has access to this project

    # Build conditions - aggregate ALL costs for the project (not filtered by user)
    conditions = ["org_id = %s", "project_id = %s"]
    params = [ctx.org_id, ctx.project_id]

    # Time range
    start_date, end_date = _parse_time_range(time_range)
    conditions.append("created_at >= %s")
    conditions.append("created_at <= %s")
    params.extend([start_date, end_date])

    where_clause = " AND ".join(conditions)
    # Aliased version for queries that JOIN users (avoids ambiguous column errors)
    where_clause_acl = " AND ".join(f"acl.{c}" for c in conditions)

    # Overall stats (no JOIN needed)
    stats_query = f"""
        SELECT
            COUNT(*) as total_requests,
            COUNT(DISTINCT message_id) as unique_messages,
            COALESCE(SUM(input_tokens), 0) as total_input_tokens,
            COALESCE(SUM(output_tokens), 0) as total_output_tokens,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(total_cost_usd), 0) as total_cost,
            COALESCE(AVG(total_cost_usd), 0) as avg_cost_per_request,
            COUNT(DISTINCT model) as unique_models,
            COUNT(DISTINCT session_id) as unique_sessions,
            COUNT(DISTINCT conversation_id) as unique_conversations
        FROM ai_cost_logs
        WHERE {where_clause}
    """

    stats = execute_query(stats_query, tuple(params), fetch="one")

    # Cost by model (no JOIN needed)
    model_query = f"""
        SELECT
            model,
            COUNT(*) as requests,
            COALESCE(SUM(total_cost_usd), 0) as total_cost,
            COALESCE(SUM(input_tokens), 0) as input_tokens,
            COALESCE(SUM(output_tokens), 0) as output_tokens
        FROM ai_cost_logs
        WHERE {where_clause}
        GROUP BY model
        ORDER BY total_cost DESC
    """

    by_model = execute_query(model_query, tuple(params), fetch="all")

    # Cost by user — JOIN users to get email for all records including historical
    user_query = f"""
        SELECT
            acl.user_id,
            u.email AS user_email,
            COUNT(*) as requests,
            COALESCE(SUM(acl.total_cost_usd), 0) as total_cost,
            COALESCE(SUM(acl.input_tokens), 0) as input_tokens,
            COALESCE(SUM(acl.output_tokens), 0) as output_tokens
        FROM ai_cost_logs acl
        LEFT JOIN users u ON u.id = acl.user_id
        WHERE {where_clause_acl}
        GROUP BY acl.user_id, u.email
        ORDER BY total_cost DESC
        LIMIT 20
    """

    by_user = execute_query(user_query, tuple(params), fetch="all")

    # Daily breakdown (no JOIN needed)
    daily_query = f"""
        SELECT
            DATE_TRUNC('day', created_at) as date,
            COUNT(*) as requests,
            COALESCE(SUM(total_cost_usd), 0) as total_cost
        FROM ai_cost_logs
        WHERE {where_clause}
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date DESC
        LIMIT 30
    """

    daily = execute_query(daily_query, tuple(params), fetch="all")

    return {
        "success": True,
        "stats": stats or {},
        "by_model": by_model or [],
        "by_user": by_user or [],
        "daily": daily or [],
    }


@router.get("/api/cost-logs/export")
async def export_cost_logs(
    ctx: AuthContext = Depends(require_project_context),
    model: Optional[str] = None,
    time_range: str = "30d",
):
    """
    Export cost logs as CSV (project-scoped).

    Requires both org_id and project_id (enforced by dependency).

    Query Parameters:
    - org_id: Organization ID (required)
    - project_id: Project ID (required - cost logs are project-scoped)
    - model: Filter by model name (optional)
    - time_range: Time range (1h, 24h, 7d, 30d) - default 30d

    Returns:
    - CSV file download with cost logs (max 10000 rows)
    """
    # TODO: Add authorization check - verify user has access to this project

    # Build query (limit to 10000 for export) - export ALL costs for the project
    conditions = ["acl.org_id = %s", "acl.project_id = %s"]
    params = [ctx.org_id, ctx.project_id]

    if model:
        conditions.append("acl.model = %s")
        params.append(model)

    start_date, end_date = _parse_time_range(time_range)
    conditions.append("acl.created_at >= %s")
    conditions.append("acl.created_at <= %s")
    params.extend([start_date, end_date])

    where_clause = " AND ".join(conditions)

    query = f"""
        SELECT
            acl.created_at,
            u.email AS user_email,
            acl.message_id,
            acl.model,
            acl.request_type,
            acl.step_number,
            acl.input_tokens,
            acl.output_tokens,
            acl.total_tokens,
            acl.total_cost_usd,
            acl.session_id,
            acl.conversation_id
        FROM ai_cost_logs acl
        LEFT JOIN users u ON u.id = acl.user_id
        WHERE {where_clause}
        ORDER BY acl.created_at DESC
        LIMIT 10000
    """

    logs = execute_query(query, tuple(params), fetch="all")

    # Generate CSV
    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "Timestamp",
        "User",
        "Message ID",
        "Model",
        "Request Type",
        "Step Number",
        "Input Tokens",
        "Output Tokens",
        "Total Tokens",
        "Cost (USD)",
        "Session ID",
        "Conversation ID",
    ])

    # Data rows
    for log in logs or []:
        writer.writerow([
            log.get("created_at", "").isoformat() if log.get("created_at") else "",
            log.get("user_email", ""),
            log.get("message_id", ""),
            log.get("model", ""),
            log.get("request_type", ""),
            log.get("step_number", ""),
            log.get("input_tokens", 0),
            log.get("output_tokens", 0),
            log.get("total_tokens", 0),
            f"{log.get('total_cost_usd', 0):.6f}",
            log.get("session_id", ""),
            log.get("conversation_id", ""),
        ])

    output.seek(0)

    filename = f"cost-logs-{datetime.utcnow().strftime('%Y-%m-%d')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
