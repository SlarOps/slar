#!/usr/bin/env python3
"""
Slack Worker for SLAR - Incident Notification System

This worker processes incident notifications from PGMQ and sends them to Slack
using the slack_bolt library for better stability and easier development.

Features:
- Processes PGMQ messages for incident notifications
- Sends formatted Slack messages for incident assignments and escalations
- Handles retries and error logging
- Maintains notification history
- Supports different message templates
"""

import os
import json
import time
import logging
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import psycopg2
from psycopg2.extras import RealDictCursor
from slack_bolt import App
import requests
from dotenv import load_dotenv
import ast

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('slack_worker.log')
    ]
)
logger = logging.getLogger('slack_worker')

class SlackWorker:
    """Handles Slack notifications for incidents"""
    
    def __init__(self):
        """Initialize the Slack worker"""
        self.setup_config()
        self.setup_database()
        self.setup_slack()
        
    def setup_config(self):
        """Load configuration from environment variables"""
        self.config = {
            'database_url': os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slar'),
            'slack_bot_token': os.getenv('SLACK_BOT_TOKEN'),
            'slack_app_token': os.getenv('SLACK_APP_TOKEN'),
            'api_base_url': os.getenv('API_BASE_URL', 'http://localhost:8080'),
            'poll_interval': int(os.getenv('POLL_INTERVAL', '1')),  # seconds
            'batch_size': int(os.getenv('BATCH_SIZE', '10')),
            'max_retries': int(os.getenv('MAX_RETRIES', '3')),
        }
        
        # Validate required config
        required_config = ['slack_bot_token', 'slack_app_token']
        missing_config = [key for key in required_config if not self.config[key]]
        if missing_config:
            raise ValueError(f"Missing required environment variables: {', '.join(missing_config)}")
            
    def setup_database(self):
        """Setup database connection"""
        try:
            self.db = psycopg2.connect(
                self.config['database_url'],
                cursor_factory=RealDictCursor
            )
            self.db.autocommit = True
            logger.info("✅ Database connected successfully")
        except Exception as e:
            logger.error(f"❌ Failed to connect to database: {e}")
            raise
            
    def setup_slack(self):
        """Setup Slack app and client"""
        try:
            self.app = App(token=self.config['slack_bot_token'])
            self.slack_client = self.app.client
            
            # Setup event handlers for interactive actions
            self.setup_slack_handlers()
            
            # Test connection
            auth_response = self.slack_client.auth_test()
            logger.info(f"✅ Slack connected as: {auth_response['user']} in team: {auth_response['team']}")
        except Exception as e:
            logger.error(f"❌ Failed to setup Slack: {e}")
            raise
            
    def setup_slack_handlers(self):
        """Setup Slack event handlers for interactive actions"""
        
        @self.app.action("acknowledge_incident")
        def handle_acknowledge_incident(ack, body, logger):
            """Handle incident acknowledgment button click with Optimistic UI"""
            ack()  # Acknowledge the action immediately
            
            try:
                # Extract incident ID from button value
                button_value = body["actions"][0]["value"]  # Format: "ack_{incident_id}"
                incident_id = button_value.replace("ack_", "")
                
                # Get user info
                user_id = body["user"]["id"]
                user_name = body["user"]["name"]
                
                logger.info(f"🔔 User @{user_name} ({user_id}) acknowledged incident {incident_id}")
                
                # 1. OPTIMISTIC UI UPDATE - Update message immediately to show "acknowledging" state
                self.update_message_optimistically(body, incident_id, user_name, "acknowledging")
                
                # 2. Queue acknowledgment request for API processing
                success = self.queue_acknowledgment_request(incident_id, user_id, user_name, body)
                
                if not success:
                    # 3. ROLLBACK - Revert optimistic update if queueing failed
                    logger.error(f"❌ Failed to queue acknowledgment, rolling back UI")
                    self.rollback_optimistic_update(body, incident_id, "queue_failed")
                    
            except Exception as e:
                logger.error(f"❌ Error handling acknowledge action: {e}")
                # Rollback optimistic update on any error
                try:
                    incident_id = body["actions"][0]["value"].replace("ack_", "")
                    self.rollback_optimistic_update(body, incident_id, f"Error: {str(e)}")
                except:
                    # Fallback to response_url if rollback fails
                    self.send_error_message(body.get("response_url"), f"Error: {str(e)}")
        
        @self.app.action("view_incident")
        def handle_view_incident(ack, body, logger):
            """Handle view incident button click"""
            ack()
            logger.info(f"🔍 User clicked view incident button")
            # This is just a URL button, no additional action needed
        
        logger.info("✅ Slack event handlers setup complete")
    
    def get_routed_teams(self, incident_data: Dict) -> str:
        """Get routed teams based on incident's escalation policy and service"""
        try:
            # Try to get service name from the incident data
            service_name = incident_data.get('service_name')
            if service_name:
                return service_name
            
            # Fallback: try to get service name from escalation policy
            escalation_policy_id = incident_data.get('escalation_policy_id')
            if escalation_policy_id:
                with self.db.cursor() as cursor:
                    cursor.execute("""
                        SELECT s.name 
                        FROM services s 
                        WHERE s.escalation_policy_id = %s 
                        LIMIT 1
                    """, (escalation_policy_id,))
                    
                    result = cursor.fetchone()
                    if result:
                        return result['name']
            
            # Default fallback
            return "Unknown Service"
            
        except Exception as e:
            logger.error(f"❌ Error getting routed teams: {e}")
            return "Unknown Service"
            
    def run(self):
        """Main worker loop with Slack event handling"""
        logger.info("🚀 Starting Slack Worker for incident notifications...")
        
        try:
            # Start Slack event server in a separate thread for interactive actions
            import threading
            from slack_bolt.adapter.socket_mode import SocketModeHandler
            
            # Check if we have app token for Socket Mode
            if self.config.get('slack_app_token'):
                logger.info("🔌 Starting Slack Socket Mode for interactive actions...")
                socket_handler = SocketModeHandler(self.app, self.config['slack_app_token'])
                
                # Start socket mode in separate thread
                socket_thread = threading.Thread(target=socket_handler.start, daemon=True)
                socket_thread.start()
                logger.info("✅ Slack Socket Mode started for button interactions")
            else:
                logger.warning("⚠️  SLACK_APP_TOKEN not configured - interactive buttons will not work")
            
            # Main notification processing loop
            while True:
                try:
                    # Process incident notifications
                    self.process_incident_notifications()
                    
                    # Sleep before next poll
                    time.sleep(self.config['poll_interval'])
                    
                except KeyboardInterrupt:
                    logger.info("🛑 Received shutdown signal")
                    break
                except Exception as e:
                    logger.error(f"❌ Error in main loop: {e}")
                    time.sleep(10)  # Wait before retrying
                    
        except Exception as e:
            logger.error(f"❌ Fatal error: {e}")
        finally:
            self.cleanup()
            
    def process_incident_notifications(self):
        """Process notifications from PGMQ queue"""
        try:
            # Process incident notifications
            self.process_queue_messages('incident_notifications')
            
            # Process Slack feedback messages (for Optimistic UI updates)
            self.process_queue_messages('slack_feedback')
            
        except Exception as e:
            logger.error(f"❌ Error processing notifications: {e}")
            import traceback
            logger.error(f"   Stacktrace: {traceback.format_exc()}")
    
    def process_queue_messages(self, queue_name: str):
        """Process messages from a specific PGMQ queue"""
        try:
            with self.db.cursor() as cursor:
                # Read messages from specified queue
                cursor.execute(
                    "SELECT * FROM pgmq.read(%s, %s, %s)",
                    (queue_name, 30, self.config['batch_size'])
                )
                results = cursor.fetchall()

                messages_processed = 0

                # Check if there are any results
                if not results:
                    logger.debug(f"📭 No messages in queue {queue_name}")
                    return

                for row in results:
                    # Row comes from: SELECT * FROM pgmq.read(queue, vt, qty)
                    # Columns: msg_id, read_ct, enqueued_at, vt, message
                    row = dict(row)
                    logger.info(f"🔍 Processing PGMQ message from {queue_name}: keys={list(row.keys())}")

                    # Extract message id and message payload
                    msg_id = row.get("msg_id")
                    message_json = row.get("message")

                    # Coerce JSON payload into a dict if it is a string (common if stored as TEXT)
                    if isinstance(message_json, str):
                        try:
                            message_json = json.loads(message_json)
                        except Exception as e:
                            logger.error(f"❌ Failed to json.loads() message payload for msg_id={msg_id}: {e}")
                            logger.error(f"   Raw payload: {message_json}")
                            # Malformed payload: delete to avoid poison-pill loops
                            self.delete_message(queue_name, msg_id)
                            continue

                    if not isinstance(message_json, dict):
                        logger.error(f"❌ Message payload is not a dict for msg_id={msg_id}: type={type(message_json)}")
                        # Delete malformed message to avoid retry storms
                        self.delete_message(queue_name, msg_id)
                        continue

                    try:
                        logger.info(f"🔍 Processing PGMQ message {msg_id}")
                        # Parsed message dict
                        message = message_json

                        # Route message based on queue and type
                        if queue_name == 'incident_notifications':
                            logger.info(f"📨 Processing notification: User={message['user_id']}, "
                                        f"Incident={message['incident_id']}, Type={message['type']}")
                            success = self.process_notification(message)
                        elif queue_name == 'slack_feedback':
                            logger.info(f"🔄 Processing Slack feedback: Action={message['action']}, "
                                        f"Incident={message['incident_id']}")
                            success = self.process_slack_feedback(message)
                        else:
                            logger.warning(f"⚠️  Unknown queue: {queue_name}")
                            success = False

                        if success:
                            # Delete message from queue
                            self.delete_message(queue_name, msg_id)
                            messages_processed += 1
                        else:
                            # Handle retry logic
                            self.handle_failed_message(queue_name, msg_id, message)

                    except (json.JSONDecodeError, TypeError, ValueError) as e:
                        logger.error(f"❌ Failed to parse/handle message JSON for msg_id={msg_id}: {e}")
                        logger.error(f"   Raw message: {message_json}")
                        self.delete_message(queue_name, msg_id)  # Remove malformed message
                    except Exception as e:
                        logger.error(f"❌ Error processing message {msg_id}: {e}")
                        import traceback
                        logger.error(f"   Stacktrace: {traceback.format_exc()}")

                if messages_processed > 0:
                    logger.info(f"📬 Processed {messages_processed} messages from {queue_name}")
                else:
                    logger.debug(f"📭 No messages processed from {queue_name} this cycle")

        except Exception as e:
            logger.error(f"❌ Error processing queue {queue_name}: {e}")
            import traceback
            logger.error(f"   Stacktrace: {traceback.format_exc()}")
            
    def process_notification(self, notification_msg: Dict[str, Any]) -> bool:
        """Process a single notification message"""
        try:
            logger.info(f"🔍 Processing notification: {notification_msg}")
            # Check if Slack is in the channels list
            channels = notification_msg.get('channels', [])
            if 'slack' not in channels:
                logger.info(f"📭 Slack not in channels {channels}, skipping")
                return True
                
            # Get user and incident details
            user_data = self.get_user_data(notification_msg['user_id'])
            incident_data = self.get_incident_data(notification_msg['incident_id'])

            logger.info(f"🔍 User data: {user_data}")
            
            if not user_data or not incident_data:
                logger.error(f"❌ Missing user or incident data")
                return False
                
            # Check if user has Slack configuration
            if not user_data.get('slack_user_id'):
                # For system users, try to fallback to assigned user's Slack ID
                if user_data.get('email', '').endswith('@system.local'):
                    assigned_user_data = self.get_assigned_user_data(incident_data.get('assigned_to'))
                    if assigned_user_data and assigned_user_data.get('slack_user_id'):
                        logger.info(f"🔄 System user {user_data.get('name', 'Unknown')} has no Slack ID, using assigned user {assigned_user_data.get('name', 'Unknown')} for notification")
                        # Use assigned user's Slack config but keep system user context
                        user_data['slack_user_id'] = assigned_user_data['slack_user_id']
                        user_data['fallback_to_assigned'] = True
                        user_data['assigned_user_name'] = assigned_user_data.get('name', 'Unknown')
                    else:
                        logger.warning(f"⚠️  System user {user_data.get('name', 'Unknown')} has no Slack ID and no assigned user with Slack config")
                        return True  # Consider this successful to avoid retry
                else:
                    logger.warning(f"⚠️  User {notification_msg['user_id']} has no Slack user ID configured")
                    return True  # Consider this successful to avoid retry
                
            # Send Slack notification based on type
            notification_type = notification_msg.get('type', 'assigned')

            if notification_type == 'assigned':
                return self.send_incident_assigned_notification(user_data, incident_data, notification_msg)
            elif notification_type == 'escalated':
                return self.send_incident_escalated_notification(user_data, incident_data, notification_msg)
            elif notification_type == 'acknowledged':
                return self.send_incident_acknowledged_notification(user_data, incident_data, notification_msg)
            elif notification_type == 'resolved':
                return self.send_incident_resolved_notification(user_data, incident_data, notification_msg)
            else:
                logger.warning(f"⚠️  Unknown notification type: {notification_type}")
                return True
                
        except Exception as e:
            logger.error(f"❌ Error processing notification: {e}")
            return False
    
    def process_slack_feedback(self, feedback_msg: Dict[str, Any]) -> bool:
        """Process Slack UI feedback messages from Go worker"""
        try:
            action = feedback_msg.get('action')
            incident_id = feedback_msg.get('incident_id')
            slack_context = feedback_msg.get('slack_context', {})
            
            if not action or not incident_id or not slack_context:
                logger.error(f"❌ Invalid Slack feedback message - missing required fields")
                return False
            
            # Reconstruct body object for Slack API calls with original blocks
            original_blocks = slack_context.get("original_blocks", [])
            logger.info(f"📦 Reconstructing body with {len(original_blocks)} saved blocks")
            
            body = {
                "channel": {"id": slack_context.get("channel_id")},
                "message": {
                    "ts": slack_context.get("message_ts"),
                    "blocks": original_blocks  # Include saved blocks
                },
                "response_url": slack_context.get("response_url")
            }
            
            if action == "acknowledgment_success":
                user_name = feedback_msg.get('user_name', 'Unknown')
                logger.info(f"✅ Processing acknowledgment success feedback for incident {incident_id}")
                
                # Update message to final acknowledged state
                self.update_message_optimistically(body, incident_id, user_name, "acknowledged")
                return True
                
            elif action == "acknowledgment_failure":
                error_reason = feedback_msg.get('error_reason', 'Unknown error')
                logger.info(f"❌ Processing acknowledgment failure feedback for incident {incident_id}")
                
                # Rollback to original state with error message
                self.rollback_optimistic_update(body, incident_id, error_reason)
                return True
                
            else:
                logger.warning(f"⚠️  Unknown Slack feedback action: {action}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error processing Slack feedback: {e}")
            return False
    
    def get_incident_color(self, status: str) -> str:
        """Get color code based on incident status"""
        status_colors = {
            'triggered': "#B72828",    # Red - Critical/Active incident
            'acknowledged': '#FFA500', # Orange/Yellow - Acknowledged but not resolved
            'resolved': '#00FF00',     # Green - Resolved
            'closed': '#808080'        # Gray - Closed
        }
        return status_colors.get(status.lower(), '#FF0000')  # Default to red

    def clean_description_text(self, description: str) -> tuple[str, list[str]]:
        """Clean description text for Slack notifications and extract image URLs"""
        # Remove Datadog %%% markers and everything after "[![Metric Graph]"
        clean_text = description.strip().replace("%%%", "").split("[![Metric Graph]")[0].strip()
        image_urls = []
        return clean_text, image_urls

    def title_contains_status(self, title: str) -> bool:
        """Check if incident title already contains status information"""
        import re
        # Check for common status patterns in titles (case-insensitive)
        status_patterns = [
            r'\[triggered\]',
            r'\[acknowledged\]',
            r'\[resolved\]',
            r'\[closed\]',
            r'\[warning\]',
            r'\[alert\]',
            r'\[critical\]',
            r'\[ok\]',
            r'\[no data\]'
        ]

        title_lower = title.lower()
        return any(re.search(pattern, title_lower) for pattern in status_patterns)
        
    
    def format_incident_blocks(self, incident_data: Dict, notification_msg: Dict, status_override: str = None) -> List[Dict]:
        """Format incident as Slack top-level blocks (Block Kit)"""
        # Get incident details
        incident_id = incident_data.get('id', '')
        incident_short_id = f"#{incident_id[-8:]}" if incident_id else "#Unknown"
        title = incident_data.get('title', 'No title')
        description = incident_data.get('description', 'No description')
        description, image_urls = self.clean_description_text(description)
        priority = notification_msg.get('priority', incident_data.get('priority', 'normal')).upper()
        status = (status_override or incident_data.get('status', 'triggered')).lower()

        # Status display mapping
        status_display = {
            'triggered': '[Triggered]',
            'acknowledged': '[Acknowledged]',
            'resolved': '[Resolved]',
            'closed': '[Closed]'
        }

        # Check if title already contains status information
        title_has_status = any(status_text in title for status_text in status_display.values())

        # Build header text with length limit (Slack header text must be < 151 characters)
        # Only add status display if title doesn't already contain it
        if title_has_status:
            header_prefix = f"🔥 {incident_short_id}: [{priority}] "
        else:
            header_prefix = f"🔥 {incident_short_id}: [{priority}] {status_display.get(status, '[Unknown]')} "
        max_title_length = 150 - len(header_prefix)

        if len(title) > max_title_length:
            # Reserve space for "..." (3 characters)
            available_length = max_title_length - 3
            # Truncate at word boundary for better readability
            truncated_title = title[:available_length].rsplit(' ', 1)[0] + "..."
            # If word boundary truncation results in very short text, use character truncation
            if len(truncated_title) < available_length * 0.7:
                truncated_title = title[:available_length] + "..."
        else:
            truncated_title = title

        header_text = f"{header_prefix}{truncated_title}"

        # Build blocks (no attachment wrapper)
        blocks: List[Dict] = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": header_text
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{description[:2900]}{'...' if len(description) > 2900 else ''}"  # Slack section text limit is 3000 chars
                }
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*Priority*\n{priority[:100]}"  # Limit field text to 100 chars
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Routed Teams*\nbackend"
                    }
                ]
            }
        ]

        # Add image blocks if any images were found
        for image_url in image_urls:
            blocks.append({
                "type": "image",
                "image_url": image_url,
                "alt_text": "Metric Graph"
            })

        return blocks
            
    def send_incident_assigned_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send Slack notification for incident assignment"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            
            # Create formatted blocks
            blocks = self.format_incident_blocks(incident_data, notification_msg, 'triggered')
            
            # Add action buttons to the blocks
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "View Incident"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_data['id']}",
                            "style": "primary"
                        },
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "Acknowledge"
                            },
                            "value": f"ack_{incident_data['id']}",
                            "action_id": "acknowledge_incident"
                        }
                    ]
                })
            
            # Send message with blocks
            incident_short_id = f"#{incident_data.get('id', '')[-8:]}" if incident_data.get('id') else "#Unknown"
            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"Incident {incident_short_id} assigned to you",
                blocks=blocks
            )

            logger.info(f"📨 Slack response: {response}")

            # Log notification with message timestamp for future updates
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"

            # Store message timestamp and channel for future updates
            message_ts = None
            channel_id = None

            if response:
                message_ts = response.get('ts')
                channel_id = response.get('channel')
                logger.info(f"📨 Slack response: ts={message_ts}, channel={channel_id}")

                if message_ts and channel_id:
                    logger.info(f"💾 Saving message info: {channel_id}:{message_ts}")
                else:
                    logger.warning(f"⚠️  Missing message info in Slack response: {response}")
            else:
                logger.error(f"❌ No response from Slack API")

            self.log_notification_with_slack_info(notification_msg_with_recipient, 'slack', True, None, message_ts, channel_id)
            
            logger.info(f"✅ Sent incident assigned notification to @{slack_user_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to send Slack notification: {e}")
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.log_notification(notification_msg_with_recipient, 'slack', False, str(e))
            return False

    def send_incident_acknowledged_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Update original Slack message for incident acknowledgment from web"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            incident_id = incident_data.get('id')
            user_id = user_data.get('id')

            # Find the original Slack message for this incident
            # Since any user can acknowledge an incident, we should look for any message for this incident
            # (not just messages for the current user)
            original_message_info = self.find_any_slack_message_for_incident(incident_id)

            if original_message_info:
                logger.info(f"📨 Found Slack message for incident {incident_id}, will update it")
            else:
                logger.warning(f"⚠️  No original Slack message found for incident {incident_id}")
                logger.info(f"📨 Sending new acknowledgment notification instead")
                # Fallback: send a new notification message
                return self.send_new_acknowledgment_notification(user_data, incident_data, notification_msg)

            channel_id, message_ts = original_message_info

            # Create updated message blocks for acknowledged state
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "✅ Incident Acknowledged"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{incident_data.get('title', 'Unknown Incident')}*"
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"*Incident ID:*\n#{incident_data.get('id', 'Unknown')[-8:]}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Status:*\nAcknowledged"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Severity:*\n{incident_data.get('severity', 'Unknown').title()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Source:*\n{incident_data.get('source', 'Unknown').title()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Acknowledged by:*\n{user_data.get('name', 'Unknown User')}"
                        }
                    ]
                }
            ]

            # Add description if available (same as original message)
            if incident_data.get('description'):
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Description:*\n{incident_data.get('description')}"
                    }
                })

            # Add view incident button (no acknowledge button since it's already acknowledged)
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "View Incident"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_data['id']}",
                            "style": "primary"
                        }
                    ]
                })

            # Update the original message
            incident_short_id = f"#{incident_data.get('id', '')[-8:]}" if incident_data.get('id') else "#Unknown"
            response = self.slack_client.chat_update(
                channel=channel_id,
                ts=message_ts,
                text=f"Incident {incident_short_id} acknowledged",
                blocks=blocks
            )

            # Send notification message for immediate alert
            user_name = user_data.get('name', 'Unknown User')
            incident_title = incident_data.get('title', 'Unknown Incident')
            notification_text = f"🔔 Incident {incident_short_id} \"{incident_title}\" was acknowledged by {user_name}"
            self.slack_client.chat_postMessage(
                channel=channel_id,
                text=notification_text
            )

            logger.info(f"✅ Updated original Slack message and sent notification for acknowledged incident {incident_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to update Slack message for acknowledged incident: {e}")
            return False

    def send_new_acknowledgment_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send new Slack notification for incident acknowledgment (fallback when original message not found)"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')

            # Create formatted message for acknowledgment - same format as original
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "✅ Incident Acknowledged"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{incident_data.get('title', 'Unknown Incident')}*"
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"*Incident ID:*\n#{incident_data.get('id', 'Unknown')[-8:]}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Status:*\nAcknowledged"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Severity:*\n{incident_data.get('severity', 'Unknown').title()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Source:*\n{incident_data.get('source', 'Unknown').title()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Acknowledged by:*\n{user_data.get('name', 'Unknown User')}"
                        }
                    ]
                }
            ]

            # Add description if available (same as original message)
            if incident_data.get('description'):
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Description:*\n{incident_data.get('description')}"
                    }
                })

            # Add view incident button
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "View Incident"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_data['id']}",
                            "style": "primary"
                        }
                    ]
                })

            # Send new message
            incident_short_id = f"#{incident_data.get('id', '')[-8:]}" if incident_data.get('id') else "#Unknown"
            incident_title = incident_data.get('title', 'Unknown Incident')
            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"Incident {incident_short_id} \"{incident_title}\" acknowledged",
                blocks=blocks
            )

            # Log notification
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.log_notification(notification_msg_with_recipient, 'slack', True, None)

            logger.info(f"✅ Sent new incident acknowledged notification to @{slack_user_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send new Slack acknowledged notification: {e}")
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.log_notification(notification_msg_with_recipient, 'slack', False, str(e))
            return False

    def send_incident_resolved_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Update original Slack message for incident resolution from web"""
        try:
            description, image_urls = self.clean_description_text(incident_data.get('description', ''))

            slack_user_id = user_data['slack_user_id'].lstrip('@')
            incident_id = incident_data.get('id')
            user_id = user_data.get('id')

            # Find the original Slack message for this incident
            # Since any user can resolve an incident, we should look for any message for this incident
            # (not just messages for the current user)
            original_message_info = self.find_any_slack_message_for_incident(incident_id)

            if original_message_info:
                logger.info(f"📨 Found Slack message for incident {incident_id}, will update it")
            else:
                logger.warning(f"⚠️  No original Slack message found for incident {incident_id}")
                logger.info(f"📨 Sending new resolution notification instead")
                # Fallback: send a new notification message
                return self.send_new_resolution_notification(user_data, incident_data, notification_msg)

            channel_id, message_ts = original_message_info

            # Create updated message blocks - keep same format as original but change header
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "🎉 Incident Resolved"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{incident_data.get('title', 'Unknown Incident')}*"
                    }
                }
            ]

            # Add description if available (same as original message)
            if incident_data.get('description'):
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"{description}"
                    }
                })

            # Add view incident button (no action buttons since it's resolved)
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "View Incident"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_data['id']}",
                            "style": "primary"
                        }
                    ]
                })

            # Update the original message
            incident_short_id = f"#{incident_data.get('id', '')[-8:]}" if incident_data.get('id') else "#Unknown"
            response = self.slack_client.chat_update(
                channel=channel_id,
                ts=message_ts,
                text=f"Incident {incident_short_id} resolved",
                blocks=blocks
            )

            # Send notification message for immediate alert
            user_name = user_data.get('name', 'Unknown User')
            incident_title = incident_data.get('title', 'Unknown Incident')
            notification_text = f"🎉 Incident {incident_short_id} \"{incident_title}\" was resolved by {user_name}"
            self.slack_client.chat_postMessage(
                channel=channel_id,
                text=notification_text
            )

            logger.info(f"✅ Updated original Slack message and sent notification for resolved incident {incident_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to update Slack message for resolved incident: {e}")
            return False

    def send_new_resolution_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send new Slack notification for incident resolution (fallback when original message not found)"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')

            # Create formatted message for resolution - same format as original
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "🎉 Incident Resolved"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{incident_data.get('title', 'Unknown Incident')}*"
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"*Incident ID:*\n#{incident_data.get('id', 'Unknown')[-8:]}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Status:*\nResolved"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Severity:*\n{incident_data.get('severity', 'Unknown').title()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Source:*\n{incident_data.get('source', 'Unknown').title()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Resolved by:*\n{user_data.get('name', 'Unknown User')}"
                        }
                    ]
                }
            ]

            # Add description if available (same as original message)
            if incident_data.get('description'):
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Description:*\n{incident_data.get('description')}"
                    }
                })

            # Add view incident button
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "View Incident"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_data['id']}",
                            "style": "primary"
                        }
                    ]
                })

            # Send new message
            incident_short_id = f"#{incident_data.get('id', '')[-8:]}" if incident_data.get('id') else "#Unknown"
            incident_title = incident_data.get('title', 'Unknown Incident')
            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"Incident {incident_short_id} \"{incident_title}\" resolved",
                blocks=blocks
            )

            # Log notification
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.log_notification(notification_msg_with_recipient, 'slack', True, None)

            logger.info(f"✅ Sent new incident resolved notification to @{slack_user_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send new Slack resolved notification: {e}")
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.log_notification(notification_msg_with_recipient, 'slack', False, str(e))
            return False
            
    def send_incident_escalated_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send Slack notification for incident escalation"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            
            # Create formatted message for escalation
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "🔄 Incident Escalated to You"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"An incident has been escalated and assigned to you due to no response."
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"*Incident ID:*\n#{incident_data['id'][-8:]}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Priority:*\n{notification_msg.get('priority', 'normal').upper()} → HIGH"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Status:*\n{incident_data.get('status', 'open').upper()}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Escalation Time:*\n{datetime.now().strftime('%H:%M %d/%m/%Y')}"
                        }
                    ]
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Title:* {incident_data.get('title', 'No title')}\n*Description:* {incident_data.get('description', 'No description')[:200]}..."
                    }
                }
            ]
            
            # Add urgent action buttons
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "Handle Immediately"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_data['id']}",
                            "style": "danger"
                        },
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "Acknowledge"
                            },
                            "value": f"ack_{incident_data['id']}",
                            "action_id": "acknowledge_incident"
                        }
                    ]
                })
            
            # Send message
            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"🔄 Incident #{incident_data['id'][-8:]} escalated to you",
                blocks=blocks
            )

            # Log notification with message timestamp for future updates
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"

            # Store message timestamp and channel for future updates
            message_ts = None
            channel_id = None

            if response:
                message_ts = response.get('ts')
                channel_id = response.get('channel')
                logger.info(f"📨 Slack escalation response: ts={message_ts}, channel={channel_id}")

                if message_ts and channel_id:
                    logger.info(f"💾 Saving escalation message info: {channel_id}:{message_ts}")
                else:
                    logger.warning(f"⚠️  Missing message info in Slack escalation response: {response}")
            else:
                logger.error(f"❌ No response from Slack API for escalation")

            self.log_notification_with_slack_info(notification_msg_with_recipient, 'slack', True, None, message_ts, channel_id)
            
            logger.info(f"✅ Sent incident escalation notification to @{slack_user_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to send Slack escalation notification: {e}")
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.log_notification(notification_msg_with_recipient, 'slack', False, str(e))
            return False
            
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
        """Get incident data"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("""
                    SELECT * FROM incidents WHERE id = %s
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
                else:
                    logger.warning(f"⚠️  No message_ts ({message_ts}) or channel_id ({channel_id}) to store")

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
                if result and result[0]:
                    # external_message_id format: "channel_id:message_ts"
                    parts = result[0].split(':', 1)
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
                logger.info(f"🔍 find_any_slack_message_for_incident result: {result}")
                if result and result['external_message_id']:
                    # external_message_id format: "channel_id:message_ts"
                    external_message_id = result['external_message_id']
                    parts = external_message_id.split(':', 1)
                    if len(parts) == 2:
                        channel_id, message_ts = parts
                        user_short = result['user_id'][:8] if result['user_id'] else 'None'
                        logger.info(f"✅ Found message for incident: Channel {channel_id}, Timestamp {message_ts}")
                        logger.info(f"   Original user: {user_short}, Type: {result['notification_type']}")
                        return (channel_id, message_ts)
                    else:
                        logger.warning(f"⚠️  Invalid external_message_id format: {external_message_id}")

                logger.warning(f"⚠️  No valid Slack message found for incident {incident_id[:8]}")
                return None
        except Exception as e:
            logger.error(f"❌ Error finding any Slack message for incident: {e}")
            return None
            
    def delete_message(self, queue_name: str, msg_id: int):
        """Delete message from PGMQ queue"""
        try:
            with self.db.cursor() as cursor:
                cursor.execute("SELECT pgmq.delete(%s, %s::bigint)", (queue_name, msg_id))
                logger.debug(f"🗑️  Deleted message {msg_id} from queue {queue_name}")
        except Exception as e:
            logger.error(f"❌ Failed to delete message {msg_id}: {e}")
            
    def handle_failed_message(self, queue_name: str, msg_id: int, notification_msg: Dict):
        """Handle failed message processing with retry logic"""
        try:
            current_retry = notification_msg.get('retry_count', 0)
            
            if current_retry >= self.config['max_retries']:
                logger.error(f"❌ Message {msg_id} exceeded max retries, deleting")
                self.delete_message(queue_name, msg_id)
            else:
                logger.warning(f"⚠️  Message {msg_id} failed, retry count: {current_retry}")
                # Message will be retried automatically when visibility timeout expires
                
        except Exception as e:
            logger.error(f"❌ Error handling failed message: {e}")
            
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
    
    def update_message_optimistically(self, body: dict, incident_id: str, user_name: str, state: str):
        """Update Slack message optimistically using top-level blocks"""
        try:
            original_message = body["message"]
            blocks = original_message.get("blocks", [])
            
            if not blocks:
                logger.error("❌ No blocks found in original message")
                return
                
            updated_blocks = [block.copy() for block in blocks]
            
            if state == "acknowledging":
                # Update header to show processing state
                for block in updated_blocks:
                    if block.get("type") == "header":
                        original_text = block["text"]["text"]
                        # remove ":fire:" emoji
                        original_text = original_text.replace(":fire: ", "")
                        updated_text = original_text.replace("[Triggered]", "[Acknowledging]")
                        # update emoji to hourglass
                        block["text"]["text"] = f":large_yellow_circle: {updated_text}"
                        break
                
                # Replace action buttons with processing message
                for i, block in enumerate(updated_blocks):
                    if block.get("type") == "actions":
                        updated_blocks[i] = {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"_Processing acknowledgment by @{user_name}..._"
                            }
                        }
                        break
                        
            elif state == "acknowledged":
                # Update header to show acknowledged state
                for block in updated_blocks:
                    if block.get("type") == "header":
                        original_text = block["text"]["text"]
                        updated_text = original_text.replace("[Acknowledging]", "[Acknowledged]").replace("[Triggered]", "[Acknowledged]")
                        block["text"]["text"] = f"{updated_text}"
                        break
                
                # Replace action buttons with acknowledgment info
                for i, block in enumerate(updated_blocks):
                    if block.get("type") == "actions" or (block.get("type") == "section" and "_Processing acknowledgment" in block.get("text", {}).get("text", "")):
                        updated_blocks[i] = {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"*Acknowledged by:* @{user_name}\n*Time:* {datetime.now().strftime('%H:%M %d/%m/%Y')}"
                            }
                        }
                        break
            
            # Update the message with new blocks
            incident_short_id = f"#{incident_id[-8:]}"
            response = self.slack_client.chat_update(
                channel=body["channel"]["id"],
                ts=body["message"]["ts"],
                text=f"Incident {incident_short_id} being acknowledged by @{user_name}" if state == "acknowledging" 
                     else f"Incident {incident_short_id} acknowledged by @{user_name}",
                blocks=updated_blocks
            )
            
            logger.info(f"✅ Updated Slack message optimistically - State: {state}")
            
        except Exception as e:
            logger.error(f"❌ Error updating Slack message optimistically: {e}")
            raise  # Re-raise to trigger rollback
    
    def rollback_optimistic_update(self, body: dict, incident_id: str, error_reason: str):
        """Rollback optimistic update and show error state using top-level blocks"""
        try:
            original_message = body["message"]
            blocks = original_message.get("blocks", [])
            
            if not blocks:
                logger.error("❌ No blocks found for rollback")
                # Fallback to response_url
                if body.get("response_url"):
                    self.send_error_message(body["response_url"], f"Acknowledgment failed: {error_reason}")
                return
                
            updated_blocks = [block.copy() for block in blocks]
            
            # Update header to show error state
            for block in updated_blocks:
                if block.get("type") == "header":
                    original_text = block["text"]["text"]
                    clean_text = original_text.replace("⏳ ", "").replace("✅ ", "")
                    clean_text = clean_text.replace("[Acknowledging]", "[Triggered]").replace("[Acknowledged]", "[Triggered]")
                    block["text"]["text"] = f"❌ {clean_text}"
                    break
            
            # Add error message and restore action buttons
            error_added = False
            for i, block in enumerate(updated_blocks):
                if block.get("type") == "section" and ("_Processing acknowledgment" in block.get("text", {}).get("text", "") or 
                                                         "*Acknowledged by:" in block.get("text", {}).get("text", "")):
                    updated_blocks[i] = {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*❌ Acknowledgment Failed*\n*Error:* {error_reason}\n*Time:* {datetime.now().strftime('%H:%M %d/%m/%Y')}\n\n_Please try again or contact support._"
                        }
                    }
                    error_added = True
                    break
            
            if not error_added:
                updated_blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*❌ Acknowledgment Failed*\n*Error:* {error_reason}\n*Time:* {datetime.now().strftime('%H:%M %d/%m/%Y')}\n\n_Please try again or contact support._"
                    }
                })
            
            # Restore action buttons if they don't exist
            has_actions = False
            for b in updated_blocks:
                if b.get("type") == "actions":
                    has_actions = True
                    break
            if not has_actions:
                updated_blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "🔧 View Incident"
                            },
                            "url": f"{self.config['api_base_url']}/incidents/{incident_id}",
                            "style": "primary"
                        },
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "✅ Acknowledge"
                            },
                            "value": f"ack_{incident_id}",
                            "action_id": "acknowledge_incident"
                        }
                    ]
                })
            
            # Update the message
            incident_short_id = f"#{incident_id[-8:]}"
            response = self.slack_client.chat_update(
                channel=body["channel"]["id"],
                ts=body["message"]["ts"],
                text=f"❌ Failed to acknowledge incident {incident_short_id}",
                blocks=updated_blocks
            )
            
            logger.info(f"✅ Rolled back Slack message - Reason: {error_reason}")
            
        except Exception as e:
            logger.error(f"❌ Error rolling back Slack message: {e}")
            # Fallback to response_url if available
            if body.get("response_url"):
                self.send_error_message(body["response_url"], f"Acknowledgment failed: {error_reason}")
    
    def update_message_after_acknowledgment(self, body: dict, incident_id: str, user_name: str):
        """Update Slack message to show final acknowledgment status (called by worker)"""
        self.update_message_optimistically(body, incident_id, user_name, "acknowledged")
    
    def send_acknowledgment_pending_message(self, response_url: str):
        """Send pending acknowledgment message to Slack"""
        try:
            if not response_url:
                return
                
            payload = {
                "text": "⏳ Processing acknowledgment...",
                "response_type": "ephemeral"  # Only visible to the user who clicked
            }
            
            response = requests.post(response_url, json=payload)
            if response.status_code == 200:
                logger.info("✅ Sent pending acknowledgment message to Slack")
            else:
                logger.error(f"❌ Failed to send pending message: {response.status_code}")
                
        except Exception as e:
            logger.error(f"❌ Error sending pending message: {e}")

    def send_error_message(self, response_url: str, error_message: str):
        """Send error message to Slack"""
        try:
            if not response_url:
                return
                
            payload = {
                "text": f"❌ {error_message}",
                "response_type": "ephemeral"  # Only visible to the user who clicked
            }
            
            response = requests.post(response_url, json=payload)
            if response.status_code == 200:
                logger.info("✅ Sent error message to Slack")
            else:
                logger.error(f"❌ Failed to send error message: {response.status_code}")
                
        except Exception as e:
            logger.error(f"❌ Error sending error message: {e}")

    def cleanup(self):
        """Cleanup resources"""
        try:
            if hasattr(self, 'db'):
                self.db.close()
            logger.info("🧹 Cleanup completed")
        except Exception as e:
            logger.error(f"❌ Error during cleanup: {e}")


def main():
    """Main entry point"""
    try:
        worker = SlackWorker()
        worker.run()
    except KeyboardInterrupt:
        logger.info("🛑 Shutdown requested by user")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        raise


if __name__ == "__main__":
    main()
