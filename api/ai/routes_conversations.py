"""
Conversation History API Routes (REFACTORED with dependency injection)

This module handles Claude conversation history storage and retrieval
for resume functionality.

Endpoints:
- GET /api/conversations - List user's conversations
- GET /api/conversations/{conversation_id} - Get conversation details
- GET /api/conversations/{conversation_id}/messages - Get messages
- PUT /api/conversations/{conversation_id} - Update conversation
- DELETE /api/conversations/{conversation_id} - Delete conversation
"""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from typing import Optional

from dependencies import get_current_user, UserContext
from database_util import execute_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


# ==========================================
# Pydantic Schemas
# ==========================================

class ConversationListResponse(BaseModel):
    """Response for GET /api/conversations."""
    success: bool
    conversations: list
    total: int


class ConversationResponse(BaseModel):
    """Response for GET /api/conversations/{id}."""
    success: bool
    conversation: Optional[dict] = None


class MessagesResponse(BaseModel):
    """Response for GET /api/conversations/{id}/messages."""
    success: bool
    messages: list


class UpdateConversationRequest(BaseModel):
    """Request to update conversation."""
    title: Optional[str] = None
    is_archived: Optional[bool] = None


class UpdateConversationResponse(BaseModel):
    """Response for PUT /api/conversations/{id}."""
    success: bool
    message: str


class DeleteConversationResponse(BaseModel):
    """Response for DELETE /api/conversations/{id}."""
    success: bool
    message: str


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

@router.get("", response_model=ConversationListResponse)
async def list_conversations(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    archived: bool = Query(False),
    user: UserContext = Depends(get_current_user)
):
    """
    List user's conversations for resume functionality.

    Authentication:
    - Requires valid Authorization header

    Query params:
    - limit: Number of conversations to return (default: 20, max: 100)
    - offset: Pagination offset (default: 0)
    - archived: Include archived conversations (default: false)

    Returns:
    - List of conversations with metadata
    """
    try:
        # Build query based on archived filter
        if archived:
            conversations = execute_query(
                """
                SELECT id, conversation_id, title, first_message, last_message_at,
                       message_count, model, is_archived, created_at
                FROM claude_conversations
                WHERE user_id = %s
                ORDER BY last_message_at DESC
                LIMIT %s OFFSET %s
                """,
                (user.user_id, limit, offset),
                fetch="all"
            )
            total_result = execute_query(
                "SELECT COUNT(*) as count FROM claude_conversations WHERE user_id = %s",
                (user.user_id,),
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
                (user.user_id, limit, offset),
                fetch="all"
            )
            total_result = execute_query(
                "SELECT COUNT(*) as count FROM claude_conversations WHERE user_id = %s AND is_archived = FALSE",
                (user.user_id,),
                fetch="one"
            )

        total = total_result["count"] if total_result else 0

        return ConversationListResponse(
            success=True,
            conversations=conversations or [],
            total=total
        )

    except Exception as e:
        logger.error(f"Error listing conversations for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred listing conversations. Please try again."
        )


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: str,
    user: UserContext = Depends(get_current_user)
):
    """
    Get details of a specific conversation.

    Authentication:
    - Requires valid Authorization header

    Path params:
    - conversation_id: Claude conversation ID

    Returns:
    - Conversation details
    """
    try:
        conversation = execute_query(
            """
            SELECT * FROM claude_conversations
            WHERE conversation_id = %s AND user_id = %s
            """,
            (conversation_id, user.user_id),
            fetch="one"
        )

        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        return ConversationResponse(
            success=True,
            conversation=conversation
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting conversation {conversation_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting conversation. Please try again."
        )


@router.get("/{conversation_id}/messages", response_model=MessagesResponse)
async def get_messages(
    conversation_id: str,
    limit: int = Query(100, ge=1, le=1000),
    user: UserContext = Depends(get_current_user)
):
    """
    Get messages for a conversation (for resume/history display).

    Authentication:
    - Requires valid Authorization header

    Path params:
    - conversation_id: Claude conversation ID

    Query params:
    - limit: Max messages to return (default: 100, max: 1000)

    Returns:
    - List of messages
    """
    try:
        # Verify user owns this conversation
        conversation = execute_query(
            "SELECT id FROM claude_conversations WHERE conversation_id = %s AND user_id = %s",
            (conversation_id, user.user_id),
            fetch="one"
        )

        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        # Get messages
        messages = get_conversation_messages(conversation_id, limit)

        return MessagesResponse(
            success=True,
            messages=messages
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting messages for {conversation_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting messages. Please try again."
        )


@router.put("/{conversation_id}", response_model=UpdateConversationResponse)
async def update_conversation(
    conversation_id: str,
    body: UpdateConversationRequest,
    user: UserContext = Depends(get_current_user)
):
    """
    Update conversation metadata (title, archived status).

    Authentication:
    - Requires valid Authorization header

    Path params:
    - conversation_id: Claude conversation ID

    Request body:
    - title: New title (optional)
    - is_archived: Archive status (optional)

    Returns:
    - Success message
    """
    try:
        # Build update query based on provided fields
        updates = []
        params = []

        if body.title is not None:
            updates.append("title = %s")
            params.append(body.title)

        if body.is_archived is not None:
            updates.append("is_archived = %s")
            params.append(body.is_archived)

        if not updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update"
            )

        params.extend([conversation_id, user.user_id])

        execute_query(
            f"""
            UPDATE claude_conversations
            SET {', '.join(updates)}, updated_at = NOW()
            WHERE conversation_id = %s AND user_id = %s
            """,
            tuple(params),
            fetch="none"
        )

        return UpdateConversationResponse(
            success=True,
            message="Conversation updated"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating conversation {conversation_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred updating conversation. Please try again."
        )


@router.delete("/{conversation_id}", response_model=DeleteConversationResponse)
async def delete_conversation(
    conversation_id: str,
    user: UserContext = Depends(get_current_user)
):
    """
    Delete a conversation.

    Authentication:
    - Requires valid Authorization header

    Path params:
    - conversation_id: Claude conversation ID

    Returns:
    - Success message
    """
    try:
        execute_query(
            """
            DELETE FROM claude_conversations
            WHERE conversation_id = %s AND user_id = %s
            """,
            (conversation_id, user.user_id),
            fetch="none"
        )

        logger.info(f"🗑️ Deleted conversation {conversation_id} for user {user.user_id}")

        return DeleteConversationResponse(
            success=True,
            message="Conversation deleted"
        )

    except Exception as e:
        logger.error(f"Error deleting conversation {conversation_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred deleting conversation. Please try again."
        )
