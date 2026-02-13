import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Optional, Any

from database_util import execute_query

logger = logging.getLogger(__name__)


@dataclass
class CostEvent:
    """Cost tracking event for a single step (message with unique ID)"""
    user_id: str
    model: str
    message_id: str  # SDK message ID for deduplication
    total_cost_usd: Decimal
    input_tokens: int
    output_tokens: int

    # Auto-generated
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Optional context
    org_id: Optional[str] = None
    project_id: Optional[str] = None
    session_id: Optional[str] = None
    conversation_id: Optional[str] = None

    # Request details
    request_type: str = "chat"
    step_number: int = 1  # Step number in conversation

    # Token details
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0

    # Metadata
    usage_metadata: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class CostTrackingService:
    """Async cost tracking service with batch writing and message ID deduplication"""

    def __init__(self, batch_size: int = 50, flush_interval: float = 5.0):
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._queue: asyncio.Queue = None
        self._worker_task: asyncio.Task = None
        self._buffer: List[CostEvent] = []
        self._running = False
        self._processed_message_ids: Dict[str, set] = {}  # session_id -> set of message_ids

    async def start(self):
        """Start the service"""
        if self._running:
            return

        self._queue = asyncio.Queue(maxsize=1000)
        self._running = True
        self._worker_task = asyncio.create_task(self._worker())
        logger.info("💰 Cost tracking service started")

    async def stop(self):
        """Stop the service and flush remaining events"""
        if not self._running:
            return

        self._running = False

        # Flush remaining items
        if self._buffer:
            self._flush_buffer()

        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

        logger.info("💰 Cost tracking service stopped")

    async def log_cost(self, event: CostEvent):
        """Log a cost event (async, non-blocking)"""
        if not self._running:
            logger.warning("Cost tracking service not running, event dropped")
            return

        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Cost queue full, event dropped")

    async def log_cost_from_assistant_message(
        self,
        message,
        user_id: str,
        model: str,
        org_id: Optional[str] = None,
        project_id: Optional[str] = None,
        session_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        request_type: str = "chat",
        step_number: int = 1
    ):
        """
        Log cost from Claude Agent SDK ResultMessage (Python SDK)

        In Python SDK, usage is only available in ResultMessage, not AssistantMessage.
        Uses the SDK's calculated total_cost_usd for accuracy.

        Args:
            message: ResultMessage object from SDK (has usage and total_cost_usd)
            user_id: User ID
            model: Model name (e.g., 'claude-haiku-4.5')
            org_id: Organization ID
            project_id: Project ID
            session_id: Session ID from ResultMessage
            conversation_id: Conversation ID
            request_type: Type of request ('chat', 'tool', 'memory')
            step_number: Step number in conversation
        """
        # Extract usage and cost from ResultMessage
        usage = getattr(message, 'usage', None)
        total_cost_usd = getattr(message, 'total_cost_usd', 0)
        result_session_id = getattr(message, 'session_id', None)

        if not usage:
            logger.debug("ResultMessage has no usage, skipping cost tracking")
            return

        # Use session_id + step_number as unique message_id
        # (Python SDK doesn't provide message.id like TypeScript SDK)
        message_id = f"{result_session_id or session_id}_{step_number}"

        # Deduplicate: Skip if we've already processed this message ID
        session_key = session_id or result_session_id or "default"
        if session_key not in self._processed_message_ids:
            self._processed_message_ids[session_key] = set()

        if message_id in self._processed_message_ids[session_key]:
            logger.debug(f"Already processed {message_id}, skipping")
            return

        # Mark as processed
        self._processed_message_ids[session_key].add(message_id)

        # Use SDK's calculated cost (more accurate than manual calculation)
        event = CostEvent(
            user_id=user_id,
            model=model,
            message_id=message_id,
            total_cost_usd=Decimal(str(total_cost_usd)),
            input_tokens=usage.get('input_tokens', 0),
            output_tokens=usage.get('output_tokens', 0),
            cache_creation_input_tokens=usage.get('cache_creation_input_tokens', 0),
            cache_read_input_tokens=usage.get('cache_read_input_tokens', 0),
            org_id=org_id,
            project_id=project_id,
            session_id=session_id or result_session_id,
            conversation_id=conversation_id,
            request_type=request_type,
            step_number=step_number,
            usage_metadata=usage,
        )

        await self.log_cost(event)

    def _get_input_price(self, model: str) -> float:
        """Get input token price per token for model"""
        # Pricing as of 2025 (per million tokens)
        pricing = {
            'opus': 15.00 / 1_000_000,
            'sonnet': 3.00 / 1_000_000,
            'haiku': 0.80 / 1_000_000,
        }
        # Extract model type from full name
        model_lower = model.lower()
        if 'opus' in model_lower:
            return pricing['opus']
        elif 'sonnet' in model_lower:
            return pricing['sonnet']
        else:
            return pricing['haiku']

    def _get_output_price(self, model: str) -> float:
        """Get output token price per token for model"""
        pricing = {
            'opus': 75.00 / 1_000_000,
            'sonnet': 15.00 / 1_000_000,
            'haiku': 4.00 / 1_000_000,
        }
        model_lower = model.lower()
        if 'opus' in model_lower:
            return pricing['opus']
        elif 'sonnet' in model_lower:
            return pricing['sonnet']
        else:
            return pricing['haiku']

    def _get_cache_read_price(self, model: str) -> float:
        """Get cache read price per token for model"""
        # Cache reads are typically 10% of input price
        return self._get_input_price(model) * 0.1

    async def _worker(self):
        """Background worker to batch write events"""
        while self._running:
            try:
                # Wait for event or timeout
                try:
                    event = await asyncio.wait_for(
                        self._queue.get(),
                        timeout=self._flush_interval
                    )
                    self._buffer.append(event)
                except asyncio.TimeoutError:
                    pass

                # Flush if buffer is full or interval elapsed
                if len(self._buffer) >= self._batch_size or (
                    self._buffer and not self._queue.qsize()
                ):
                    self._flush_buffer()

            except Exception as e:
                logger.error(f"Cost worker error: {e}", exc_info=True)

    def _flush_buffer(self):
        """Write buffered events to database"""
        if not self._buffer:
            return

        try:
            import json

            # Helper to convert empty strings to None for UUID fields
            def uuid_or_none(value):
                return None if value == '' or value is None else value

            # Build batch insert
            values = []
            params = []

            for event in self._buffer:
                # Use %s placeholders for psycopg2 (not $1, $2, etc.)
                value_placeholders = ["%s"] * 18  # 18 columns
                values.append(f"({','.join(value_placeholders)})")

                params.extend([
                    event.event_id,
                    event.created_at,
                    event.user_id,
                    uuid_or_none(event.org_id),
                    uuid_or_none(event.project_id),
                    uuid_or_none(event.session_id),
                    uuid_or_none(event.conversation_id),
                    event.message_id,  # SDK message ID for deduplication
                    event.model,
                    event.request_type,
                    event.step_number,  # Changed from num_turns
                    event.input_tokens,
                    event.output_tokens,
                    event.cache_creation_input_tokens,
                    event.cache_read_input_tokens,
                    float(event.total_cost_usd),
                    json.dumps(event.usage_metadata) if event.usage_metadata else None,
                    json.dumps(event.metadata) if event.metadata else None,
                ])

            query = f"""
                INSERT INTO ai_cost_logs (
                    event_id, created_at, user_id, org_id, project_id,
                    session_id, conversation_id, message_id, model, request_type,
                    step_number, input_tokens, output_tokens,
                    cache_creation_input_tokens, cache_read_input_tokens,
                    total_cost_usd, usage_metadata, metadata
                ) VALUES {','.join(values)}
                ON CONFLICT (event_id) DO NOTHING
            """

            execute_query(query, tuple(params), fetch=None)

            logger.info(f"💰 Flushed {len(self._buffer)} cost events to database")
            self._buffer.clear()

        except Exception as e:
            logger.error(f"Failed to flush cost buffer: {e}", exc_info=True)
            self._buffer.clear()  # Prevent infinite retry


# Global service instance
_cost_service: Optional[CostTrackingService] = None


async def init_cost_tracking_service():
    """Initialize global cost tracking service"""
    global _cost_service
    if _cost_service is None:
        _cost_service = CostTrackingService()
        await _cost_service.start()


async def shutdown_cost_tracking_service():
    """Shutdown global cost tracking service"""
    global _cost_service
    if _cost_service:
        await _cost_service.stop()
        _cost_service = None


def get_cost_service() -> CostTrackingService:
    """Get global cost tracking service"""
    if _cost_service is None:
        raise RuntimeError("Cost tracking service not initialized")
    return _cost_service
