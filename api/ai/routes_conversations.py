"""
Conversation History API Routes

This module handles Claude conversation history storage and retrieval
for resume functionality.

Endpoints:
- GET /api/conversations - List user's conversations
- GET /api/conversations/{conversation_id} - Get conversation details
- PUT /api/conversations/{conversation_id} - Update conversation (title, archive)
- DELETE /api/conversations/{conversation_id} - Delete conversation
"""

import json
import logging
from fastapi import APIRouter, Request

from database_util import execute_query
from supabase_storage import extract_user_id_from_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """
    Sanitize error messages to prevent information disclosure.
    """
    logger.error(f"❌ Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)

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


# ==========================================
# Helper Functions (exported for agent_task)
# ==========================================

async def save_conversation(
    user_id: str,
    conversation_id: str,
    first_message: str,
    title: str = None,
    model: str = "sonnet",
    workspace_path: str = None,
    metadata: dict = None
) -> bool:
    """
    Save conversation metadata to database.

    Args:
        user_id: User's UUID
        conversation_id: Claude SDK session_id (returned from init message)
        first_message: First user prompt for preview
        title: Optional title (auto-generated from first_message if not provided)
        model: Model used for conversation
        workspace_path: User's workspace path when conversation started
        metadata: Additional metadata (org_id, project_id, etc.)

    Returns:
        True if saved successfully, False otherwise
    """
    try:
        # Auto-generate title from first message if not provided
        if not title:
            title = first_message[:50] + "..." if len(first_message) > 50 else first_message

        execute_query(
            """
            INSERT INTO claude_conversations
            (conversation_id, user_id, title, first_message, model, workspace_path, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (conversation_id) DO UPDATE SET
                last_message_at = NOW(),
                message_count = claude_conversations.message_count + 1,
                updated_at = NOW()
            """,
            (
                conversation_id,
                user_id,
                title,
                first_message,
                model,
                workspace_path,
                json.dumps(metadata or {}),
            ),
            fetch="none"
        )

        logger.info(f"💾 Saved conversation {conversation_id} for user {user_id}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to save conversation: {e}", exc_info=True)
        return False


async def update_conversation_activity(conversation_id: str) -> bool:
    """Update last_message_at and increment message_count for existing conversation."""
    try:
        execute_query(
            """
            UPDATE claude_conversations
            SET last_message_at = NOW(),
                message_count = message_count + 1,
                updated_at = NOW()
            WHERE conversation_id = %s
            """,
            (conversation_id,),
            fetch="none"
        )
        return True
    except Exception as e:
        logger.error(f"❌ Failed to update conversation activity: {e}", exc_info=True)
        return False


async def save_message(
    conversation_id: str,
    role: str,
    content: str,
    message_type: str = "text",
    tool_name: str = None,
    tool_input: dict = None,
    metadata: dict = None
) -> bool:
    """
    Save a message to the database.

    Args:
        conversation_id: Claude conversation ID
        role: Message role ('user', 'assistant', 'system')
        content: Message content
        message_type: Type of message ('text', 'tool_use', 'tool_result', 'thinking', 'error')
        tool_name: Tool name if applicable
        tool_input: Tool input if applicable
        metadata: Additional metadata

    Returns:
        True if saved successfully, False otherwise
    """
    try:
        execute_query(
            """
            INSERT INTO claude_messages
            (conversation_id, role, content, message_type, tool_name, tool_input, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                conversation_id,
                role,
                content,
                message_type,
                tool_name,
                json.dumps(tool_input) if tool_input else None,
                json.dumps(metadata or {}),
            ),
            fetch="none"
        )
        return True
    except Exception as e:
        logger.error(f"❌ Failed to save message: {e}", exc_info=True)
        return False


def get_conversation_messages(conversation_id: str, limit: int = 100) -> list:
    """
    Get messages for a conversation.

    Args:
        conversation_id: Claude conversation ID
        limit: Maximum number of messages to return

    Returns:
        List of messages ordered by created_at ASC
    """
    try:
        messages = execute_query(
            """
            SELECT id, role, content, message_type, tool_name, tool_input, metadata, created_at
            FROM claude_messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (conversation_id, limit),
            fetch="all"
        )
        return messages or []
    except Exception as e:
        logger.error(f"❌ Failed to get messages: {e}", exc_info=True)
        return []


# ==========================================
# API Endpoints
# ==========================================

@router.get("")
async def list_conversations(request: Request):
    """
    List user's conversations for resume functionality.

    Query params:
        auth_token: Bearer token
        limit: Number of conversations to return (default: 20)
        offset: Pagination offset (default: 0)
        archived: Include archived conversations (default: false)

    Returns:
        {
            "success": bool,
            "conversations": [
                {
                    "id": "uuid",
                    "conversation_id": "claude-session-id",
                    "title": "Help me build a web app",
                    "first_message": "Help me build a web application...",
                    "last_message_at": "2025-12-20T10:00:00Z",
                    "message_count": 5,
                    "model": "sonnet",
                    "created_at": "2025-12-20T09:00:00Z"
                }
            ],
            "total": 50
        }
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get("authorization", "")
        limit = int(request.query_params.get("limit", "20"))
        offset = int(request.query_params.get("offset", "0"))
        include_archived = request.query_params.get("archived", "false").lower() == "true"

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Build query based on archived filter
        if include_archived:
            conversations = execute_query(
                """
                SELECT id, conversation_id, title, first_message, last_message_at,
                       message_count, model, is_archived, created_at
                FROM claude_conversations
                WHERE user_id = %s
                ORDER BY last_message_at DESC
                LIMIT %s OFFSET %s
                """,
                (user_id, limit, offset),
                fetch="all"
            )
            total_result = execute_query(
                "SELECT COUNT(*) as count FROM claude_conversations WHERE user_id = %s",
                (user_id,),
                fetch="one"
            )
        else:
            conversations = execute_query(
                """
                SELECT id, conversation_id, title, first_message, last_message_at,
                       message_count, model, is_archived, created_at
                FROM claude_conversations
                WHERE user_id = %s AND is_archived = FALSE
                ORDER BY last_message_at DESC
                LIMIT %s OFFSET %s
                """,
                (user_id, limit, offset),
                fetch="all"
            )
            total_result = execute_query(
                "SELECT COUNT(*) as count FROM claude_conversations WHERE user_id = %s AND is_archived = FALSE",
                (user_id,),
                fetch="one"
            )

        total = total_result["count"] if total_result else 0

        return {
            "success": True,
            "conversations": conversations or [],
            "total": total
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "listing conversations")
        }


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request):
    """
    Get details of a specific conversation.

    Path params:
        conversation_id: Claude conversation ID

    Query params:
        auth_token: Bearer token

    Returns:
        {
            "success": bool,
            "conversation": {...}
        }
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        conversation = execute_query(
            """
            SELECT * FROM claude_conversations
            WHERE conversation_id = %s AND user_id = %s
            """,
            (conversation_id, user_id),
            fetch="one"
        )

        if not conversation:
            return {"success": False, "error": "Conversation not found"}

        return {
            "success": True,
            "conversation": conversation
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting conversation")
        }


@router.get("/{conversation_id}/messages")
async def get_messages(conversation_id: str, request: Request):
    """
    Get messages for a conversation (for resume/history display).

    Path params:
        conversation_id: Claude conversation ID

    Query params:
        auth_token: Bearer token
        limit: Max messages to return (default: 100)

    Returns:
        {
            "success": bool,
            "messages": [
                {
                    "id": "uuid",
                    "role": "user|assistant|system",
                    "content": "message content",
                    "message_type": "text|tool_use|tool_result",
                    "created_at": "2025-12-20T10:00:00Z"
                }
            ]
        }
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get("authorization", "")
        limit = int(request.query_params.get("limit", "100"))

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Verify user owns this conversation
        conversation = execute_query(
            "SELECT id FROM claude_conversations WHERE conversation_id = %s AND user_id = %s",
            (conversation_id, user_id),
            fetch="one"
        )

        if not conversation:
            return {"success": False, "error": "Conversation not found"}

        # Get messages
        messages = get_conversation_messages(conversation_id, limit)

        return {
            "success": True,
            "messages": messages
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting messages")
        }


@router.put("/{conversation_id}")
async def update_conversation(conversation_id: str, request: Request):
    """
    Update conversation metadata (title, archived status).

    Path params:
        conversation_id: Claude conversation ID

    Request body:
        {
            "auth_token": "Bearer ...",
            "title": "New title",
            "is_archived": true
        }

    Returns:
        {"success": bool, "message": str}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Build update query based on provided fields
        updates = []
        params = []

        if "title" in body:
            updates.append("title = %s")
            params.append(body["title"])

        if "is_archived" in body:
            updates.append("is_archived = %s")
            params.append(body["is_archived"])

        if not updates:
            return {"success": False, "error": "No fields to update"}

        params.extend([conversation_id, user_id])

        execute_query(
            f"""
            UPDATE claude_conversations
            SET {', '.join(updates)}, updated_at = NOW()
            WHERE conversation_id = %s AND user_id = %s
            """,
            tuple(params),
            fetch="none"
        )

        return {"success": True, "message": "Conversation updated"}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "updating conversation")
        }


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request):
    """
    Delete a conversation.

    Path params:
        conversation_id: Claude conversation ID

    Query params:
        auth_token: Bearer token

    Returns:
        {"success": bool, "message": str}
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        execute_query(
            """
            DELETE FROM claude_conversations
            WHERE conversation_id = %s AND user_id = %s
            """,
            (conversation_id, user_id),
            fetch="none"
        )

        logger.info(f"🗑️ Deleted conversation {conversation_id} for user {user_id}")

        return {"success": True, "message": "Conversation deleted"}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "deleting conversation")
        }
