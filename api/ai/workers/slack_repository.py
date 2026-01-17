import logging
import json
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger('slack_worker.repository')

class SlackRepository:
    """Handles database interactions for Slack Worker"""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.db = None
        self.connect()

    def connect(self):
        """Setup database connection"""
        try:
            self.db = psycopg2.connect(
                self.database_url,
                cursor_factory=RealDictCursor
            )
            self.db.autocommit = True
            logger.info("✅ Database connected successfully")
        except Exception as e:
            logger.error(f"❌ Failed to connect to database: {e}")
            raise

    def get_user_data(self, user_id: str) -> Optional[Dict]:
        """Get user data including notification config"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("""
                    SELECT u.*, unc.slack_user_id, unc.slack_enabled
                    FROM users u
                    LEFT JOIN user_notification_configs unc ON u.id = unc.user_id
                    WHERE u.id = %s
                """, (user_id,))
                
                return cursor.fetchone()
        except Exception as e:
            logger.error(f"❌ Error fetching user data: {e}")
            return None

    def get_incident_data(self, incident_id: str) -> Optional[Dict]:
        """Get incident data with service information"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("""
                    SELECT i.*, s.name as service_name
                    FROM incidents i
                    LEFT JOIN services s ON i.service_id = s.id
                    WHERE i.id = %s
                """, (incident_id,))

                return cursor.fetchone()
        except Exception as e:
            logger.error(f"❌ Error fetching incident data: {e}")
            return None

    def get_assigned_user_data(self, assigned_to: str) -> Optional[Dict]:
        """Get assigned user data for fallback Slack notifications"""
        if not assigned_to:
            return None
        return self.get_user_data(assigned_to)

    def get_routed_teams(self, incident_data: Dict) -> str:
        """Get routed service name from the integration attached to the incident"""
        try:
            # Try to get service name from the incident data (already joined in get_incident_data)
            service_name = incident_data.get('service_name')
            if service_name:
                return service_name

            # Fallback: try to get service name from service_id
            service_id = incident_data.get('service_id')
            if service_id:
                with self.db.cursor() as cursor:
                    cursor.execute("""
                        SELECT name
                        FROM services
                        WHERE id = %s::uuid
                    """, (service_id,))

                    result = cursor.fetchone()
                    if result:
                        return result['name']

            # Default fallback
            return "unknown"

        except Exception as e:
            logger.error(f"❌ Error getting routed teams: {e}")
            return "unknown"

    def log_notification(self, notification_msg: Dict, channel: str, success: bool, error: Optional[str]):
        """Log notification attempt"""
        self.log_notification_with_slack_info(notification_msg, channel, success, error, None, None)

    def log_notification_with_slack_info(self, notification_msg: Dict, channel: str, success: bool, error: Optional[str], message_ts: Optional[str], channel_id: Optional[str]):
        """Log notification attempt with Slack message info for future updates"""
        try:
            with self.db.cursor() as cursor:
                # Map success boolean to status string
                status = 'sent' if success else 'failed'
                sent_at = datetime.now(timezone.utc) if success else None

                # Create external_message_id with both timestamp and channel for Slack updates
                external_message_id = None
                if message_ts and channel_id:
                    external_message_id = f"{channel_id}:{message_ts}"
                    logger.info(f"💾 Storing external_message_id: {external_message_id}")
                elif channel == 'slack' and success and not message_ts:
                     # Only warn if it was a successful Slack message but missing IDs
                     # (Sometimes we assume success before sending if async, but here we usually have response)
                     # For generic non-slack channels, this is fine.
                     pass

                cursor.execute("""
                    INSERT INTO notification_logs
                    (user_id, incident_id, notification_type, channel, recipient, status, error_message, sent_at, external_message_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    notification_msg.get('user_id'),
                    notification_msg.get('incident_id'),
                    notification_msg.get('type', 'assigned'),
                    channel,
                    notification_msg.get('recipient', ''),  # Add recipient info
                    status,
                    error,
                    sent_at,
                    external_message_id,
                    datetime.now(timezone.utc)
                ))
        except Exception as e:
            logger.error(f"❌ Error logging notification: {e}")

    def find_original_slack_message(self, incident_id: str, user_id: str, notification_type: str) -> Optional[tuple]:
        """Find the original Slack message for an incident and user"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("""
                    SELECT external_message_id
                    FROM notification_logs
                    WHERE incident_id = %s
                    AND notification_type = %s
                    AND channel = 'slack'
                    AND status = 'sent'
                    AND external_message_id IS NOT NULL
                    ORDER BY created_at DESC
                    LIMIT 1
                """, (incident_id, notification_type))

                result = cursor.fetchone()
                if result and result['external_message_id']:
                    # external_message_id format: "channel_id:message_ts"
                    parts = result['external_message_id'].split(':', 1)
                    if len(parts) == 2:
                        channel_id, message_ts = parts
                        return (channel_id, message_ts)

                return None
        except Exception as e:
            logger.error(f"❌ Error finding original Slack message: {e}")
            return None

    def find_any_slack_message_for_incident(self, incident_id: str) -> Optional[tuple]:
        """Find any Slack message for an incident (regardless of user)"""
        try:
            with self.db.cursor() as cursor:
                # Find the most recent message with external_message_id
                # Prioritize 'assigned' over 'escalated'
                cursor.execute("""
                    SELECT external_message_id, user_id, notification_type
                    FROM notification_logs
                    WHERE incident_id = %s
                    AND channel = 'slack'
                    AND status = 'sent'
                    AND external_message_id IS NOT NULL
                    AND notification_type IN ('assigned', 'escalated')
                    ORDER BY
                        CASE notification_type
                            WHEN 'assigned' THEN 1
                            WHEN 'escalated' THEN 2
                            ELSE 3
                        END,
                        created_at DESC
                    LIMIT 1
                """, (incident_id,))

                result = cursor.fetchone()
                if result and result['external_message_id']:
                    # external_message_id format: "channel_id:message_ts"
                    external_message_id = result['external_message_id']
                    parts = external_message_id.split(':', 1)
                    if len(parts) == 2:
                        channel_id, message_ts = parts
                        return (channel_id, message_ts)
                    else:
                        logger.warning(f"⚠️  Invalid external_message_id format: {external_message_id}")

                logger.warning(f"⚠️  No valid Slack message found for incident {incident_id[:8]}")
                return None
        except Exception as e:
            logger.error(f"❌ Error finding any Slack message for incident: {e}")
            return None

    def find_all_slack_messages_for_incident(self, incident_id: str) -> List[tuple]:
        """Find ALL Slack messages for an incident (for updating all recipients when status changes)"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("""
                    SELECT external_message_id, user_id, notification_type
                    FROM notification_logs
                    WHERE incident_id = %s
                    AND channel = 'slack'
                    AND status = 'sent'
                    AND external_message_id IS NOT NULL
                    AND notification_type IN ('assigned', 'escalated')
                    ORDER BY created_at ASC
                """, (incident_id,))

                results = cursor.fetchall()
                messages = []
                
                for result in results:
                    if result and result['external_message_id']:
                        # external_message_id format: "channel_id:message_ts"
                        external_message_id = result['external_message_id']
                        parts = external_message_id.split(':', 1)
                        if len(parts) == 2:
                            channel_id, message_ts = parts
                            messages.append((channel_id, message_ts))
                
                logger.info(f"✅ Found {len(messages)} Slack messages for incident {incident_id[:8]}")
                return messages
                
        except Exception as e:
            logger.error(f"❌ Error finding all Slack messages for incident: {e}")
            return []

    def queue_acknowledgment_request(self, incident_id: str, user_id: str, user_name: str, slack_body: dict) -> bool:
        """Queue acknowledgment request for API processing"""
        try:
            # Save current blocks for later use
            current_blocks = slack_body["message"].get("blocks", [])
            logger.info(f"💾 Saving {len(current_blocks)} blocks to queue for incident {incident_id}")
            
            # Create acknowledgment action message
            action_message = {
                "type": "acknowledge_incident",
                "incident_id": incident_id,
                "user_id": user_id,  # This is Slack user ID, will be converted by worker
                "user_name": user_name,
                "source": "slack_button",
                "slack_context": {
                    "channel_id": slack_body["channel"]["id"],
                    "message_ts": slack_body["message"]["ts"],
                    "response_url": slack_body.get("response_url"),
                    "user_slack_id": user_id,  # Explicit Slack user ID for lookup
                    "original_blocks": current_blocks  # Save current blocks
                },
                "created_at": datetime.now(timezone.utc).isoformat(),
                "retry_count": 0
            }
            
            # Send to incident actions queue
            with self.db.cursor() as cursor:
                cursor.execute(
                    "SELECT pgmq.send(%s, %s)",
                    ('incident_actions', json.dumps(action_message))
                )
                
            logger.info(f"✅ Queued acknowledgment request for incident {incident_id} by {user_name}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error queuing acknowledgment request: {e}")
            return False

    def delete_message(self, queue_name: str, msg_id: int):
        """Delete message from PGMQ queue"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("SELECT pgmq.delete(%s, %s::bigint)", (queue_name, msg_id))
                logger.debug(f"🗑️  Deleted message {msg_id} from queue {queue_name}")
        except Exception as e:
            logger.error(f"❌ Failed to delete message {msg_id}: {e}")

    def read_queue_messages(self, queue_name: str, batch_size: int) -> List[Dict]:
        """Read messages from PGMQ"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM pgmq.read(%s, %s, %s)",
                    (queue_name, 30, batch_size)
                )
                results = cursor.fetchall()
                return [dict(row) for row in results] if results else []
        except Exception as e:
            logger.error(f"❌ Error reading queue {queue_name}: {e}")
            return []

    def close(self):
        """Close database connection"""
        if self.db:
            self.db.close()
            logger.info("Database connection closed")
