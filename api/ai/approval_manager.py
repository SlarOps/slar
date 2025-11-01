"""
Tool Approval Manager for Claude Agent SDK
Manages pending tool approvals and their responses
"""

import asyncio
import uuid
from typing import Dict, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
from collections import deque


@dataclass
class PendingApproval:
    """Represents a pending tool approval request"""
    approval_id: str
    session_id: str
    tool_name: str
    tool_args: dict
    created_at: datetime
    future: asyncio.Future  # Will be resolved with approval decision


class ApprovalManager:
    """
    Manages tool approval requests and responses
    Thread-safe for async operations
    """

    def __init__(self, timeout_seconds: int = 300):
        self.pending_approvals: Dict[str, PendingApproval] = {}
        self.timeout_seconds = timeout_seconds
        self.event_queue: Dict[str, deque] = {}  # session_id -> deque of events

    def queue_event(self, session_id: str, event: dict):
        """Queue an event to be sent via SSE"""
        if session_id not in self.event_queue:
            self.event_queue[session_id] = deque()
        self.event_queue[session_id].append(event)

    def get_queued_events(self, session_id: str) -> list:
        """Get and clear queued events for a session"""
        if session_id not in self.event_queue:
            return []
        events = list(self.event_queue[session_id])
        self.event_queue[session_id].clear()
        return events

    async def request_approval(
        self,
        approval_id: str,  # Now receives approval_id instead of generating
        session_id: str,
        tool_name: str,
        tool_args: dict
    ) -> dict:
        """
        Request approval for a tool execution

        Args:
            approval_id: Pre-generated approval ID
            session_id: Session ID
            tool_name: Name of tool to approve
            tool_args: Tool arguments

        Returns:
            dict: {"approved": bool, "reason": str}
        """
        future = asyncio.Future()

        pending = PendingApproval(
            approval_id=approval_id,
            session_id=session_id,
            tool_name=tool_name,
            tool_args=tool_args,
            created_at=datetime.utcnow(),
            future=future
        )

        self.pending_approvals[approval_id] = pending

        # Queue approval request event
        self.queue_event(session_id, {
            'type': 'tool_approval_request',
            'approval_id': approval_id,
            'tool_name': tool_name,
            'tool_args': tool_args,
            'session_id': session_id
        })

        try:
            # Wait for approval with timeout
            result = await asyncio.wait_for(
                future,
                timeout=self.timeout_seconds
            )
            return result
        except asyncio.TimeoutError:
            # Timeout - auto-deny
            return {
                "approved": False,
                "reason": f"Approval timeout after {self.timeout_seconds}s"
            }
        finally:
            # Cleanup
            self.pending_approvals.pop(approval_id, None)

    def submit_approval(
        self,
        approval_id: str,
        approved: bool,
        reason: Optional[str] = None
    ) -> bool:
        """
        Submit approval decision

        Returns:
            bool: True if approval was found and processed
        """
        pending = self.pending_approvals.get(approval_id)

        if not pending:
            return False

        if not pending.future.done():
            result = {
                "approved": approved,
                "reason": reason or ("Approved by user" if approved else "Denied by user")
            }
            pending.future.set_result(result)
            return True

        return False

    def get_pending_approval(self, approval_id: str) -> Optional[PendingApproval]:
        """Get pending approval details"""
        return self.pending_approvals.get(approval_id)

    def cleanup_expired(self):
        """Remove expired approval requests"""
        now = datetime.utcnow()
        expired = [
            approval_id
            for approval_id, pending in self.pending_approvals.items()
            if (now - pending.created_at) > timedelta(seconds=self.timeout_seconds)
        ]

        for approval_id in expired:
            pending = self.pending_approvals.pop(approval_id, None)
            if pending and not pending.future.done():
                pending.future.set_result({
                    "approved": False,
                    "reason": "Approval expired"
                })


# Global approval manager instance
approval_manager = ApprovalManager(timeout_seconds=300)  # 5 minutes timeout
