"""
Audit Logging Service for AI Agent

Implements comprehensive audit logging following OWASP and industry best practices
(AWS CloudTrail, Google Cloud Audit Logs).

Features:
- Structured logging with consistent schema
- Async batch writing for performance
- Sensitive data sanitization
- Event categorization and filtering
- Tamper-evident logging (hash chain optional)

Event Categories:
- session: Authentication, session lifecycle
- chat: Messages, conversations
- tool: Tool executions with approval status
- security: Auth failures, rate limits, signature errors

References:
- OWASP Logging Cheat Sheet
- AWS CloudTrail Event Reference
- Google Cloud Audit Logs
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from queue import Queue
import threading

# Import database utility
try:
    from .database_util import get_db_connection, execute_query
except ImportError:
    from database_util import get_db_connection, execute_query

logger = logging.getLogger(__name__)


# ============================================================
# Event Types and Categories
# ============================================================

class EventCategory(str, Enum):
    """Audit event categories"""
    SESSION = "session"
    CHAT = "chat"
    TOOL = "tool"
    SECURITY = "security"


class EventType(str, Enum):
    """
    Audit event types following pattern: category.action

    Naming convention follows AWS CloudTrail style.
    """
    # Session events
    SESSION_CREATED = "session.created"
    SESSION_AUTHENTICATED = "session.authenticated"
    SESSION_RECONNECTED = "session.reconnected"
    SESSION_ENDED = "session.ended"
    SESSION_REVOKED = "session.revoked"

    # Chat events
    CHAT_MESSAGE_SENT = "chat.message_sent"
    CHAT_RESPONSE_RECEIVED = "chat.response_received"
    CHAT_CONVERSATION_CREATED = "chat.conversation_created"
    CHAT_CONVERSATION_LOADED = "chat.conversation_loaded"

    # Tool events
    TOOL_REQUESTED = "tool.requested"
    TOOL_APPROVED = "tool.approved"
    TOOL_DENIED = "tool.denied"
    TOOL_EXECUTED = "tool.executed"
    TOOL_COMPLETED = "tool.completed"
    TOOL_ERROR = "tool.error"

    # Security events
    AUTH_FAILED = "security.auth_failed"
    AUTH_RATE_LIMITED = "security.rate_limited"
    SIGNATURE_INVALID = "security.signature_invalid"
    NONCE_REPLAY = "security.nonce_replay"
    CERTIFICATE_EXPIRED = "security.certificate_expired"
    PERMISSION_DENIED = "security.permission_denied"


class EventStatus(str, Enum):
    """Event outcome status"""
    SUCCESS = "success"
    FAILURE = "failure"
    PENDING = "pending"


# ============================================================
# Audit Event Data Class
# ============================================================

@dataclass
class AuditEvent:
    """
    Structured audit event following OWASP guidelines.

    All times are in UTC. Sensitive data is sanitized before storage.
    """
    # Required fields
    event_type: Union[EventType, str]
    user_id: str
    action: str
    status: Union[EventStatus, str]

    # Auto-generated
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    event_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Identity context
    user_email: Optional[str] = None
    org_id: Optional[str] = None
    project_id: Optional[str] = None
    session_id: Optional[str] = None
    device_cert_id: Optional[str] = None

    # Source context
    source_ip: Optional[str] = None
    user_agent: Optional[str] = None
    instance_id: Optional[str] = None

    # Action details
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    request_params: Optional[Dict[str, Any]] = None

    # Result
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    response_data: Optional[Dict[str, Any]] = None

    # Metadata
    duration_ms: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None

    def __post_init__(self):
        """Sanitize UUID fields - convert empty strings to None"""
        # Optional UUID fields that cannot accept empty strings (convert to NULL)
        optional_uuid_fields = ['org_id', 'project_id', 'session_id']
        for field_name in optional_uuid_fields:
            value = getattr(self, field_name, None)
            if value == '':
                setattr(self, field_name, None)

    @property
    def event_category(self) -> str:
        """Extract category from event type"""
        event_str = self.event_type.value if isinstance(self.event_type, EventType) else str(self.event_type)
        return event_str.split('.')[0]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        data = {
            'event_id': self.event_id,
            'event_time': self.event_time.isoformat() if self.event_time else None,
            'event_type': self.event_type.value if isinstance(self.event_type, EventType) else str(self.event_type),
            'event_category': self.event_category,
            'user_id': self.user_id,
            'user_email': self.user_email,
            'org_id': self.org_id,
            'project_id': self.project_id,
            'session_id': self.session_id,
            'device_cert_id': self.device_cert_id,
            'source_ip': self.source_ip,
            'user_agent': self.user_agent,
            'instance_id': self.instance_id,
            'action': self.action,
            'resource_type': self.resource_type,
            'resource_id': self.resource_id,
            'request_params': self.request_params,
            'status': self.status.value if isinstance(self.status, EventStatus) else str(self.status),
            'error_code': self.error_code,
            'error_message': self.error_message,
            'response_data': self.response_data,
            'duration_ms': self.duration_ms,
            'metadata': self.metadata,
        }
        return data


# ============================================================
# Sensitive Data Sanitizer
# ============================================================

class DataSanitizer:
    """
    Sanitize sensitive data before logging.

    Following OWASP guidelines: Never log passwords, tokens, PII, etc.
    """

    # Patterns for sensitive keys (case-insensitive)
    SENSITIVE_KEYS = {
        'password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'apikey',
        'auth', 'credential', 'private_key', 'privatekey', 'access_token',
        'refresh_token', 'bearer', 'authorization', 'session_token',
        'credit_card', 'creditcard', 'card_number', 'cvv', 'ssn',
        'social_security', 'bank_account', 'routing_number'
    }

    # Patterns for sensitive values
    SENSITIVE_PATTERNS = [
        (r'Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+', '[BEARER_TOKEN]'),  # JWT
        (r'sk-[A-Za-z0-9]{32,}', '[API_KEY]'),  # OpenAI/Anthropic keys
        (r'ghp_[A-Za-z0-9]{36}', '[GITHUB_TOKEN]'),  # GitHub PAT
        (r'xox[baprs]-[A-Za-z0-9-]+', '[SLACK_TOKEN]'),  # Slack tokens
        (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]'),  # Email (optional)
    ]

    @classmethod
    def sanitize(cls, data: Any, max_depth: int = 10) -> Any:
        """
        Recursively sanitize sensitive data.

        Args:
            data: Data to sanitize (dict, list, or primitive)
            max_depth: Maximum recursion depth

        Returns:
            Sanitized copy of data
        """
        if max_depth <= 0:
            return "[MAX_DEPTH_EXCEEDED]"

        if data is None:
            return None

        if isinstance(data, dict):
            return {
                k: cls._sanitize_value(k, v, max_depth - 1)
                for k, v in data.items()
            }

        if isinstance(data, list):
            return [cls.sanitize(item, max_depth - 1) for item in data]

        if isinstance(data, str):
            return cls._sanitize_string(data)

        # Primitives (int, float, bool) are safe
        return data

    @classmethod
    def _sanitize_value(cls, key: str, value: Any, max_depth: int) -> Any:
        """Sanitize a value based on its key"""
        key_lower = key.lower()

        # Check if key is sensitive
        for sensitive_key in cls.SENSITIVE_KEYS:
            if sensitive_key in key_lower:
                if isinstance(value, str) and len(value) > 0:
                    return f"[REDACTED:{len(value)} chars]"
                return "[REDACTED]"

        # Recursively sanitize
        return cls.sanitize(value, max_depth)

    @classmethod
    def _sanitize_string(cls, value: str) -> str:
        """Sanitize sensitive patterns in strings"""
        result = value
        for pattern, replacement in cls.SENSITIVE_PATTERNS:
            result = re.sub(pattern, replacement, result)

        # Truncate very long strings
        if len(result) > 10000:
            result = result[:10000] + f"... [TRUNCATED: {len(value)} chars total]"

        return result

    @classmethod
    def sanitize_tool_input(cls, tool_name: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize tool input data with tool-specific rules.

        Some tools (like Bash) need extra sanitization.
        """
        sanitized = cls.sanitize(input_data)

        # Tool-specific sanitization
        if tool_name.lower() in ('bash', 'shell', 'execute', 'run'):
            # For shell commands, also check command content
            if 'command' in sanitized and isinstance(sanitized['command'], str):
                cmd = sanitized['command']
                # Redact inline credentials in commands
                cmd = re.sub(r'--password[=\s]+\S+', '--password=[REDACTED]', cmd)
                cmd = re.sub(r'-p\s*\S+', '-p [REDACTED]', cmd)
                cmd = re.sub(r'PGPASSWORD=\S+', 'PGPASSWORD=[REDACTED]', cmd)
                cmd = re.sub(r'AWS_SECRET_ACCESS_KEY=\S+', 'AWS_SECRET_ACCESS_KEY=[REDACTED]', cmd)
                sanitized['command'] = cmd

        return sanitized


# ============================================================
# Audit Service
# ============================================================

class AuditService:
    """
    Async audit logging service with batch writing.

    Features:
    - Async queue-based logging (non-blocking)
    - Batch inserts for performance
    - Automatic retry on failure
    - Memory buffer with periodic flush
    """

    def __init__(
        self,
        batch_size: int = 50,
        flush_interval: float = 5.0,
        max_queue_size: int = 10000,
        enabled: bool = True
    ):
        """
        Initialize audit service.

        Args:
            batch_size: Number of events to batch before writing
            flush_interval: Seconds between forced flushes
            max_queue_size: Maximum queue size before dropping events
            enabled: Whether audit logging is enabled
        """
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.max_queue_size = max_queue_size
        self.enabled = enabled

        self._queue: asyncio.Queue = None
        self._buffer: List[AuditEvent] = []
        self._buffer_lock = asyncio.Lock()
        self._worker_task: Optional[asyncio.Task] = None
        self._shutdown = False

        # Stats
        self._events_logged = 0
        self._events_dropped = 0
        self._last_flush = time.time()

    async def start(self):
        """Start the audit service background worker"""
        if not self.enabled:
            logger.info("📝 Audit logging is disabled")
            return

        self._queue = asyncio.Queue(maxsize=self.max_queue_size)
        self._shutdown = False
        self._worker_task = asyncio.create_task(self._worker())
        logger.info("📝 Audit service started")

    async def stop(self):
        """Stop the audit service and flush remaining events"""
        if not self.enabled or not self._worker_task:
            return

        self._shutdown = True

        # Flush remaining buffer
        await self._flush_buffer()

        # Cancel worker
        self._worker_task.cancel()
        try:
            await self._worker_task
        except asyncio.CancelledError:
            pass

        logger.info(f"📝 Audit service stopped. Total logged: {self._events_logged}, dropped: {self._events_dropped}")

    async def log(self, event: AuditEvent):
        """
        Log an audit event (async, non-blocking).

        Events are queued and batch-written to database.
        """
        if not self.enabled:
            return

        # Sanitize event data
        if event.request_params:
            event.request_params = DataSanitizer.sanitize(event.request_params)
        if event.response_data:
            event.response_data = DataSanitizer.sanitize(event.response_data)
        if event.metadata:
            event.metadata = DataSanitizer.sanitize(event.metadata)

        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            self._events_dropped += 1
            logger.warning(f"📝 Audit queue full, event dropped. Total dropped: {self._events_dropped}")

    def log_sync(self, event: AuditEvent):
        """Synchronous logging (for non-async contexts)"""
        if not self.enabled:
            return

        # Write directly to database (blocking)
        try:
            self._write_event_to_db(event)
            self._events_logged += 1
        except Exception as e:
            logger.error(f"📝 Failed to write audit event: {e}")

    async def _worker(self):
        """Background worker that processes the event queue"""
        while not self._shutdown:
            try:
                # Wait for event with timeout
                try:
                    event = await asyncio.wait_for(
                        self._queue.get(),
                        timeout=self.flush_interval
                    )

                    async with self._buffer_lock:
                        self._buffer.append(event)

                except asyncio.TimeoutError:
                    pass  # Timeout is expected, will trigger flush check

                # Check if we should flush
                should_flush = (
                    len(self._buffer) >= self.batch_size or
                    time.time() - self._last_flush >= self.flush_interval
                )

                if should_flush and self._buffer:
                    await self._flush_buffer()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"📝 Audit worker error: {e}")
                await asyncio.sleep(1)  # Prevent tight loop on error

    async def _flush_buffer(self):
        """Flush buffered events to database"""
        async with self._buffer_lock:
            if not self._buffer:
                return

            events_to_write = self._buffer.copy()
            self._buffer.clear()

        # Write batch to database
        try:
            self._write_batch_to_db(events_to_write)
            self._events_logged += len(events_to_write)
            self._last_flush = time.time()
            logger.debug(f"📝 Flushed {len(events_to_write)} audit events")
        except Exception as e:
            logger.error(f"📝 Failed to flush audit events: {e}")
            # Put events back in buffer for retry (with limit)
            async with self._buffer_lock:
                if len(self._buffer) < self.max_queue_size // 2:
                    self._buffer.extend(events_to_write)
                else:
                    self._events_dropped += len(events_to_write)

    def _write_event_to_db(self, event: AuditEvent):
        """Write single event to database"""
        self._write_batch_to_db([event])

    def _write_batch_to_db(self, events: List[AuditEvent]):
        """Write batch of events to database"""
        if not events:
            return

        # Build batch insert query
        query = """
            INSERT INTO agent_audit_logs (
                event_id, event_time, event_type, event_category,
                user_id, user_email, org_id, project_id, session_id, device_cert_id,
                source_ip, user_agent, instance_id,
                action, resource_type, resource_id, request_params,
                status, error_code, error_message, response_data,
                duration_ms, metadata
            ) VALUES
        """

        values_template = """(
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s
        )"""

        values_list = []
        params = []

        # Helper to convert empty strings to None for UUID fields
        def _sanitize_uuid(value: Optional[str]) -> Optional[str]:
            return None if value == '' else value

        for event in events:
            values_list.append(values_template)
            params.extend([
                event.event_id,
                event.event_time,
                event.event_type.value if isinstance(event.event_type, EventType) else str(event.event_type),
                event.event_category,
                event.user_id,
                event.user_email,
                _sanitize_uuid(event.org_id),       # UUID field - convert '' to None
                _sanitize_uuid(event.project_id),  # UUID field - convert '' to None
                _sanitize_uuid(event.session_id),  # UUID field - convert '' to None
                event.device_cert_id,
                event.source_ip,
                event.user_agent,
                event.instance_id,
                event.action,
                event.resource_type,
                event.resource_id,
                json.dumps(event.request_params) if event.request_params else None,
                event.status.value if isinstance(event.status, EventStatus) else str(event.status),
                event.error_code,
                event.error_message,
                json.dumps(event.response_data) if event.response_data else None,
                event.duration_ms,
                json.dumps(event.metadata) if event.metadata else None,
            ])

        query += ', '.join(values_list)
        query += " ON CONFLICT (event_id) DO NOTHING"

        execute_query(query, tuple(params), fetch="none")

    # ============================================================
    # Convenience Methods
    # ============================================================

    async def log_session_created(
        self,
        user_id: str,
        session_id: str,
        source_ip: Optional[str] = None,
        user_agent: Optional[str] = None,
        **kwargs
    ):
        """Log session creation event"""
        await self.log(AuditEvent(
            event_type=EventType.SESSION_CREATED,
            user_id=user_id,
            session_id=session_id,
            action="create_session",
            status=EventStatus.SUCCESS,
            source_ip=source_ip,
            user_agent=user_agent,
            **kwargs
        ))

    async def log_session_authenticated(
        self,
        user_id: str,
        session_id: str,
        device_cert_id: str,
        instance_id: str,
        source_ip: Optional[str] = None,
        **kwargs
    ):
        """Log successful authentication"""
        await self.log(AuditEvent(
            event_type=EventType.SESSION_AUTHENTICATED,
            user_id=user_id,
            session_id=session_id,
            device_cert_id=device_cert_id,
            instance_id=instance_id,
            action="authenticate",
            status=EventStatus.SUCCESS,
            source_ip=source_ip,
            **kwargs
        ))

    async def log_auth_failed(
        self,
        user_id: Optional[str],
        error_code: str,
        error_message: str,
        source_ip: Optional[str] = None,
        **kwargs
    ):
        """Log authentication failure"""
        await self.log(AuditEvent(
            event_type=EventType.AUTH_FAILED,
            user_id=user_id or "unknown",
            action="authenticate",
            status=EventStatus.FAILURE,
            error_code=error_code,
            error_message=error_message,
            source_ip=source_ip,
            **kwargs
        ))

    async def log_chat_message(
        self,
        user_id: str,
        session_id: str,
        conversation_id: Optional[str],
        message_preview: str,
        org_id: Optional[str] = None,
        project_id: Optional[str] = None,
        **kwargs
    ):
        """Log chat message sent"""
        # Truncate message for privacy
        preview = message_preview[:200] + "..." if len(message_preview) > 200 else message_preview

        await self.log(AuditEvent(
            event_type=EventType.CHAT_MESSAGE_SENT,
            user_id=user_id,
            session_id=session_id,
            org_id=org_id,
            project_id=project_id,
            action="send_message",
            resource_type="conversation",
            resource_id=conversation_id,
            status=EventStatus.SUCCESS,
            metadata={"message_preview": preview, "message_length": len(message_preview)},
            **kwargs
        ))

    async def log_tool_requested(
        self,
        user_id: str,
        session_id: str,
        tool_name: str,
        tool_input: Dict[str, Any],
        request_id: str,
        **kwargs
    ):
        """Log tool execution request (pending approval)"""
        await self.log(AuditEvent(
            event_type=EventType.TOOL_REQUESTED,
            user_id=user_id,
            session_id=session_id,
            action=f"request_tool:{tool_name}",
            resource_type="tool",
            resource_id=request_id,
            status=EventStatus.PENDING,
            request_params=DataSanitizer.sanitize_tool_input(tool_name, tool_input),
            metadata={"tool_name": tool_name},
            **kwargs
        ))

    async def log_tool_approved(
        self,
        user_id: str,
        session_id: str,
        tool_name: str,
        request_id: str,
        **kwargs
    ):
        """Log tool execution approved by user"""
        await self.log(AuditEvent(
            event_type=EventType.TOOL_APPROVED,
            user_id=user_id,
            session_id=session_id,
            action=f"approve_tool:{tool_name}",
            resource_type="tool",
            resource_id=request_id,
            status=EventStatus.SUCCESS,
            metadata={"tool_name": tool_name},
            **kwargs
        ))

    async def log_tool_denied(
        self,
        user_id: str,
        session_id: str,
        tool_name: str,
        request_id: str,
        **kwargs
    ):
        """Log tool execution denied by user"""
        await self.log(AuditEvent(
            event_type=EventType.TOOL_DENIED,
            user_id=user_id,
            session_id=session_id,
            action=f"deny_tool:{tool_name}",
            resource_type="tool",
            resource_id=request_id,
            status=EventStatus.FAILURE,
            error_code="USER_DENIED",
            error_message="User denied tool execution",
            metadata={"tool_name": tool_name},
            **kwargs
        ))

    async def log_tool_executed(
        self,
        user_id: str,
        session_id: str,
        tool_name: str,
        request_id: str,
        success: bool,
        duration_ms: Optional[int] = None,
        error_message: Optional[str] = None,
        result_preview: Optional[str] = None,
        tool_input: Optional[Dict[str, Any]] = None,
        **kwargs
    ):
        """Log tool execution completed with input and output details"""
        metadata = {"tool_name": tool_name}

        # Sanitize and store tool input in request_params
        request_params = None
        if tool_input:
            # Sanitize sensitive data from tool input
            request_params = DataSanitizer.sanitize(tool_input, max_depth=3)

        # Store result preview in response_data
        response_data = None
        if result_preview:
            # Truncate result preview
            truncated = result_preview[:2000] if len(result_preview) > 2000 else result_preview
            response_data = {"result": truncated}

        await self.log(AuditEvent(
            event_type=EventType.TOOL_COMPLETED if success else EventType.TOOL_ERROR,
            user_id=user_id,
            session_id=session_id,
            action=f"execute_tool:{tool_name}",
            resource_type="tool",
            resource_id=request_id,
            status=EventStatus.SUCCESS if success else EventStatus.FAILURE,
            duration_ms=duration_ms,
            error_message=error_message if not success else None,
            request_params=request_params,
            response_data=response_data,
            metadata=metadata,
            **kwargs
        ))

    async def log_security_event(
        self,
        event_type: EventType,
        user_id: Optional[str],
        action: str,
        error_code: str,
        error_message: str,
        source_ip: Optional[str] = None,
        **kwargs
    ):
        """Log security-related event"""
        await self.log(AuditEvent(
            event_type=event_type,
            user_id=user_id or "unknown",
            action=action,
            status=EventStatus.FAILURE,
            error_code=error_code,
            error_message=error_message,
            source_ip=source_ip,
            **kwargs
        ))


# ============================================================
# Global Instance
# ============================================================

_audit_service: Optional[AuditService] = None


def get_audit_service() -> AuditService:
    """Get the global audit service instance"""
    global _audit_service
    if _audit_service is None:
        enabled = os.getenv("AUDIT_LOGGING_ENABLED", "true").lower() == "true"
        _audit_service = AuditService(enabled=enabled)
    return _audit_service


async def init_audit_service() -> AuditService:
    """Initialize and start the audit service"""
    service = get_audit_service()
    await service.start()
    return service


async def shutdown_audit_service():
    """Shutdown the audit service"""
    global _audit_service
    if _audit_service:
        await _audit_service.stop()
        _audit_service = None
