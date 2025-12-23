"""
Audit Hooks for Claude Agent SDK

Uses Claude Agent SDK's hook system for clean audit logging of tool executions.
This approach separates audit concerns from business logic.

Hook Types Used:
- PreToolUse: Log tool requests before execution
- PostToolUse: Log tool completion/errors after execution
- UserPromptSubmit: Log user messages (optional, already logged in agent_task)
- Stop: Log session end

References:
- https://platform.claude.com/docs/en/agent-sdk/hooks
"""

import logging
import time
from typing import Any, Dict, Optional, Tuple

from audit_service import (
    get_audit_service,
    EventType,
    EventStatus,
    DataSanitizer,
    AuditEvent,
)

logger = logging.getLogger(__name__)

# Store context for correlating PreToolUse with PostToolUse
# Key: tool_use_id, Value: (start_time, tool_name, user_id, session_id, tool_input)
_tool_execution_context: Dict[str, Tuple[float, str, str, str, Dict[str, Any]]] = {}


def create_audit_hooks(user_id: str, session_id: str, org_id: Optional[str] = None, project_id: Optional[str] = None):
    """
    Create audit hook callbacks with user context.

    Args:
        user_id: User ID for audit logging
        session_id: Session ID for audit logging
        org_id: Organization ID (optional)
        project_id: Project ID (optional)

    Returns:
        Dict of hook configurations for ClaudeAgentOptions
    """

    async def pre_tool_use_hook(input_data: Dict[str, Any], tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        """
        Hook called before tool execution (AFTER permission is granted).

        Stores context including tool_input for PostToolUse to log complete details.
        NOTE: Tool request/approval/denial is logged in permission callbacks,
        since hooks only fire after permission is granted.
        """
        if input_data.get('hook_event_name') != 'PreToolUse':
            return {}

        tool_name = input_data.get('tool_name', 'unknown')
        tool_input = input_data.get('tool_input', {})

        # Store execution context including tool_input for PostToolUse
        if tool_use_id:
            _tool_execution_context[tool_use_id] = (time.time(), tool_name, user_id, session_id, tool_input)

        logger.debug(f"📝 Audit: PreToolUse context stored - {tool_name} (id: {tool_use_id})")

        # Return empty to allow the operation (don't modify behavior)
        return {}

    async def post_tool_use_hook(input_data: Dict[str, Any], tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        """
        Hook called after tool execution.

        Logs tool completion with duration and result status.
        """
        if input_data.get('hook_event_name') != 'PostToolUse':
            return {}

        tool_name = input_data.get('tool_name', 'unknown')
        tool_response = input_data.get('tool_response', '')

        # Calculate duration from stored context
        duration_ms = None
        ctx_user_id = user_id
        ctx_session_id = session_id

        tool_input = {}
        if tool_use_id and tool_use_id in _tool_execution_context:
            start_time, _, ctx_user_id, ctx_session_id, tool_input = _tool_execution_context.pop(tool_use_id)
            duration_ms = int((time.time() - start_time) * 1000)

        # Determine success/failure from response
        is_error = False
        error_message = None
        result_preview = None

        if isinstance(tool_response, str):
            result_preview = tool_response[:500] if len(tool_response) > 500 else tool_response
            # Check for common error indicators
            if 'error' in tool_response.lower() or 'failed' in tool_response.lower():
                is_error = True
                error_message = result_preview
        elif isinstance(tool_response, dict):
            is_error = tool_response.get('is_error', False)
            error_message = tool_response.get('error') or tool_response.get('message')
            content = tool_response.get('content', '')
            if isinstance(content, str):
                result_preview = content[:500] if len(content) > 500 else content

        # Log tool executed event with input and output details
        audit = get_audit_service()
        await audit.log_tool_executed(
            user_id=ctx_user_id,
            session_id=ctx_session_id,
            tool_name=tool_name,
            request_id=tool_use_id or "unknown",
            success=not is_error,
            duration_ms=duration_ms,
            error_message=error_message,
            result_preview=result_preview,
            tool_input=tool_input,
            org_id=org_id,
            project_id=project_id,
        )

        logger.debug(f"📝 Audit: PostToolUse logged - {tool_name} (success={not is_error}, {duration_ms}ms)")

        return {}

    async def user_prompt_submit_hook(input_data: Dict[str, Any], tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        """
        Hook called when user submits a prompt.

        Note: Chat messages are already logged in agent_task, this is for additional context.
        """
        if input_data.get('hook_event_name') != 'UserPromptSubmit':
            return {}

        prompt = input_data.get('prompt', '')

        # Log is already done in agent_task before SDK is called
        # This hook can add additional context if needed
        logger.debug(f"📝 Audit: UserPromptSubmit - {len(prompt)} chars")

        return {}

    async def stop_hook(input_data: Dict[str, Any], tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        """
        Hook called when agent execution stops.

        Logs session end event.
        """
        if input_data.get('hook_event_name') != 'Stop':
            return {}

        stop_hook_active = input_data.get('stop_hook_active', False)

        # Log session ended
        audit = get_audit_service()
        await audit.log(AuditEvent(
            event_type=EventType.SESSION_ENDED,
            user_id=user_id,
            session_id=session_id,
            org_id=org_id,
            project_id=project_id,
            action="stop_agent",
            status=EventStatus.SUCCESS,
            metadata={"stop_hook_active": stop_hook_active},
        ))

        logger.debug(f"📝 Audit: Stop logged - session {session_id}")

        return {}

    # Return hook configuration
    # Note: We use HookMatcher from claude_agent_sdk
    return {
        'pre_tool_use': pre_tool_use_hook,
        'post_tool_use': post_tool_use_hook,
        'user_prompt_submit': user_prompt_submit_hook,
        'stop': stop_hook,
    }


def build_hooks_config(user_id: str, session_id: str, org_id: Optional[str] = None, project_id: Optional[str] = None):
    """
    Build hooks configuration dict for ClaudeAgentOptions.

    Usage:
        from audit_hooks import build_hooks_config
        from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

        hooks_config = build_hooks_config(user_id, session_id, org_id, project_id)

        options = ClaudeAgentOptions(
            ...
            hooks=hooks_config,
        )

    Args:
        user_id: User ID for audit logging
        session_id: Session ID for audit logging
        org_id: Organization ID (optional)
        project_id: Project ID (optional)

    Returns:
        Dict ready to use in ClaudeAgentOptions(hooks=...)
    """
    from claude_agent_sdk import HookMatcher

    hooks = create_audit_hooks(user_id, session_id, org_id, project_id)

    return {
        'PreToolUse': [HookMatcher(hooks=[hooks['pre_tool_use']])],
        'PostToolUse': [HookMatcher(hooks=[hooks['post_tool_use']])],
        'UserPromptSubmit': [HookMatcher(hooks=[hooks['user_prompt_submit']])],
        'Stop': [HookMatcher(hooks=[hooks['stop']])],
    }


# Cleanup function for long-running sessions
def cleanup_stale_contexts(max_age_seconds: int = 3600):
    """
    Clean up stale tool execution contexts.

    Call periodically to prevent memory leaks from orphaned tool executions.
    """
    current_time = time.time()
    stale_ids = [
        tool_id for tool_id, (start_time, _, _, _, _) in _tool_execution_context.items()
        if current_time - start_time > max_age_seconds
    ]
    for tool_id in stale_ids:
        del _tool_execution_context[tool_id]

    if stale_ids:
        logger.info(f"📝 Audit: Cleaned up {len(stale_ids)} stale tool contexts")
