import io
import csv
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from database_util import execute_query, resolve_user_id_from_token

router = APIRouter()


def _get_user_id_from_request(request: Request) -> tuple:
    """Extract user_id from Authorization header"""
    auth_token = request.headers.get("authorization", "")
    if not auth_token:
        return None, {"success": False, "error": "Missing Authorization header"}

    if auth_token.lower().startswith("bearer "):
        auth_token = auth_token[7:]

    user_id = resolve_user_id_from_token(auth_token)
    if not user_id:
        return None, {"success": False, "error": "Invalid token"}

    return user_id, None


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
async def get_cost_logs(request: Request):
    """Get cost logs with filtering and pagination (project-scoped)"""
    user_id, error = _get_user_id_from_request(request)
    if error:
        return error

    # Query parameters
    org_id = request.query_params.get("org_id")
    project_id = request.query_params.get("project_id")
    model = request.query_params.get("model")
    time_range = request.query_params.get("time_range", "24h")
    limit = min(int(request.query_params.get("limit", 50)), 500)
    offset = int(request.query_params.get("offset", 0))

    # ReBAC: Require org_id and project_id (project-scoped like credentials)
    if not org_id:
        return {"success": False, "error": "org_id is required"}
    if not project_id:
        return {"success": False, "error": "project_id is required (cost logs are project-scoped)"}

    # TODO: Add authorization check - verify user has access to this project
    # For now, trust that frontend sends correct project_id
    # Future: Call Go API to verify project access like credentials do

    # Build query conditions - show ALL costs for the project (not filtered by user)
    conditions = ["org_id = %s", "project_id = %s"]
    params = [org_id, project_id]

    # Model filter
    if model:
        conditions.append("model = %s")
        params.append(model)

    # Time range
    start_date, end_date = _parse_time_range(time_range)
    conditions.append("created_at >= %s")
    conditions.append("created_at <= %s")
    params.extend([start_date, end_date])

    where_clause = " AND ".join(conditions)

    # Count total
    count_query = f"SELECT COUNT(*) as total FROM ai_cost_logs WHERE {where_clause}"
    count_result = execute_query(count_query, tuple(params), fetch="one")
    total = count_result.get("total", 0) if count_result else 0

    # Get logs
    query = f"""
        SELECT
            event_id,
            created_at,
            user_id,
            org_id,
            project_id,
            session_id,
            conversation_id,
            message_id,
            model,
            request_type,
            step_number,
            input_tokens,
            output_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
            total_tokens,
            total_cost_usd
        FROM ai_cost_logs
        WHERE {where_clause}
        ORDER BY created_at DESC
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
async def get_cost_stats(request: Request):
    """Get cost statistics (project-scoped)"""
    user_id, error = _get_user_id_from_request(request)
    if error:
        return error

    # Query parameters
    org_id = request.query_params.get("org_id")
    project_id = request.query_params.get("project_id")
    time_range = request.query_params.get("time_range", "24h")

    # ReBAC: Require org_id and project_id (project-scoped like credentials)
    if not org_id:
        return {"success": False, "error": "org_id is required"}
    if not project_id:
        return {"success": False, "error": "project_id is required (cost logs are project-scoped)"}

    # TODO: Add authorization check - verify user has access to this project

    # Build conditions - aggregate ALL costs for the project (not filtered by user)
    conditions = ["org_id = %s", "project_id = %s"]
    params = [org_id, project_id]

    # Time range
    start_date, end_date = _parse_time_range(time_range)
    conditions.append("created_at >= %s")
    conditions.append("created_at <= %s")
    params.extend([start_date, end_date])

    where_clause = " AND ".join(conditions)

    # Overall stats
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

    # Cost by model
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

    # Cost by user (project-level visibility)
    user_query = f"""
        SELECT
            user_id,
            COUNT(*) as requests,
            COALESCE(SUM(total_cost_usd), 0) as total_cost,
            COALESCE(SUM(input_tokens), 0) as input_tokens,
            COALESCE(SUM(output_tokens), 0) as output_tokens
        FROM ai_cost_logs
        WHERE {where_clause}
        GROUP BY user_id
        ORDER BY total_cost DESC
        LIMIT 20
    """

    by_user = execute_query(user_query, tuple(params), fetch="all")

    # Daily breakdown
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
async def export_cost_logs(request: Request):
    """Export cost logs as CSV (project-scoped)"""
    user_id, error = _get_user_id_from_request(request)
    if error:
        return error

    # Query parameters (similar to get_cost_logs)
    org_id = request.query_params.get("org_id")
    project_id = request.query_params.get("project_id")
    model = request.query_params.get("model")
    time_range = request.query_params.get("time_range", "30d")

    # ReBAC: Require org_id and project_id (project-scoped like credentials)
    if not org_id:
        return {"success": False, "error": "org_id is required"}
    if not project_id:
        return {"success": False, "error": "project_id is required (cost logs are project-scoped)"}

    # TODO: Add authorization check - verify user has access to this project

    # Build query (limit to 10000 for export) - export ALL costs for the project
    conditions = ["org_id = %s", "project_id = %s"]
    params = [org_id, project_id]

    if model:
        conditions.append("model = %s")
        params.append(model)

    start_date, end_date = _parse_time_range(time_range)
    conditions.append("created_at >= %s")
    conditions.append("created_at <= %s")
    params.extend([start_date, end_date])

    where_clause = " AND ".join(conditions)

    query = f"""
        SELECT
            created_at,
            message_id,
            model,
            request_type,
            step_number,
            input_tokens,
            output_tokens,
            total_tokens,
            total_cost_usd,
            session_id,
            conversation_id
        FROM ai_cost_logs
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT 10000
    """

    logs = execute_query(query, tuple(params), fetch="all")

    # Generate CSV
    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "Timestamp",
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
