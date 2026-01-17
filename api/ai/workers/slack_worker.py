#!/usr/bin/env python3
"""
Slack Worker for SLAR - Incident Notification System

Refactored to use Repository and Builder patterns for better maintainability.
Now integrated into AI Agent Service.
"""

import os
import json
import time
import logging
import yaml
import sys
import threading
from typing import Optional, Dict, Any, List
from datetime import datetime
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

# Ensure local imports work regardless of execution method
# sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Use relative imports for integration within api/ai package
try:
    from .slack_repository import SlackRepository
    from .slack_builder import SlackMessageBuilder, SlackMessage
except ImportError:
    # Fallback if run directly
    from slack_repository import SlackRepository
    from slack_builder import SlackMessageBuilder, SlackMessage

# Configure logging (Use existing logger from app if possible, but basicConfig is fine here as AI service configures it too)
logger = logging.getLogger('slack_worker')

class SlackWorker:
    """Handles Slack notifications for incidents - Orchestrator"""
    
    def __init__(self):
        """Initialize the Slack worker"""
        self.setup_config()
        
        # Initialize collaborators
        self.repo = SlackRepository(self.config['database_url'])
        self.builder = SlackMessageBuilder(self.config['api_base_url'])
        
        self.socket_handler = None
        self.socket_thread = None

        self.setup_slack()
        
    def setup_config(self):
        """Load configuration from YAML file or environment variables."""
        # Try to load from YAML config file first
        yaml_config = self._load_yaml_config()

        # Build config with YAML values taking priority over env vars
        self.config = {
            'database_url': yaml_config.get('database_url') or os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/slar'),
            'slack_bot_token': yaml_config.get('slack_bot_token') or os.getenv('SLACK_BOT_TOKEN'),
            'slack_app_token': yaml_config.get('slack_app_token') or os.getenv('SLACK_APP_TOKEN'),
            'api_base_url': yaml_config.get('api_base_url') or yaml_config.get('slar_api_url') or os.getenv('API_BASE_URL', 'http://localhost:8080'),
            'poll_interval': int(yaml_config.get('poll_interval') or os.getenv('POLL_INTERVAL', '1')),  # seconds
            'batch_size': int(yaml_config.get('batch_size') or os.getenv('BATCH_SIZE', '10')),
            'max_retries': int(yaml_config.get('max_retries') or os.getenv('MAX_RETRIES', '3')),
        }

        # Validate required config
        required_config = ['slack_bot_token']
        # Slack app token is optional if we don't need socket mode (but we usually do for local/firewall)
        missing_config = [key for key in required_config if not self.config[key]]
        if missing_config:
            # Don't raise error immediately, just log error, as we don't want to crash the whole AI service
            logger.error(f"❌ Missing required configuration for Slack Worker: {', '.join(missing_config)}. Worker will not start.")
            self.enabled = False
        else:
            self.enabled = True

    def _load_yaml_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file."""
        config_path = os.getenv("SLAR_CONFIG_PATH")

        if not config_path:
            # Check default locations
            default_paths = [
                "/app/config/config.yaml",  # Production (Docker)
                os.path.join(os.getcwd(), "config.dev.yaml"),  # Local dev 
                "config.dev.yaml" # Helper
            ]
            for path in default_paths:
                if os.path.exists(path):
                    config_path = path
                    break

        if not config_path or not os.path.exists(config_path):
            return {}

        try:
            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)
            return config or {}
        except Exception as e:
            logger.error(f"❌ Failed to load config file: {e}")
            return {}
            
    def setup_slack(self):
        """Setup Slack app and client"""
        if not self.enabled:
            return

        try:
            self.app = App(token=self.config['slack_bot_token'])
            self.slack_client = self.app.client
            
            # Setup event handlers for interactive actions
            self.setup_slack_handlers()
            
            # Test connection
            try:
                auth_response = self.slack_client.auth_test()
                logger.info(f"✅ Slack connected as: {auth_response['user']} in team: {auth_response['team']}")
            except Exception as e:
                logger.error(f"❌ Slack Connection Test Failed: {e}")
                # We won't disable, maybe transient
        except Exception as e:
            logger.error(f"❌ Failed to setup Slack: {e}")
            self.enabled = False
            
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
                # Moved queue logic to Repository
                success = self.repo.queue_acknowledgment_request(incident_id, user_id, user_name, body)
                
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
    
    def run(self, stop_event: threading.Event = None):
        """Main worker loop with Slack event handling"""
        if not self.enabled:
            logger.warning("⚠️ Slack Worker is disabled due to missing configuration.")
            return

        logger.info("🚀 Starting Slack Worker for incident notifications...")
        
        try:
            # Start Slack event server in a separate thread for interactive actions
            # Check if we have app token for Socket Mode
            if self.config.get('slack_app_token'):
                logger.info("🔌 Starting Slack Socket Mode for interactive actions...")
                self.socket_handler = SocketModeHandler(self.app, self.config['slack_app_token'])
                
                # Start socket mode in separate thread
                # We need to make sure we can stop this too if needed, but SocketModeHandler.start is blocking
                # We run it in a thread.
                self.socket_thread = threading.Thread(target=self.socket_handler.start, daemon=True)
                self.socket_thread.start()
                logger.info("✅ Slack Socket Mode started for button interactions")
            else:
                logger.warning("⚠️  SLACK_APP_TOKEN not configured - interactive buttons will not work")
            
            # Main notification processing loop
            while True:
                if stop_event and stop_event.is_set():
                    logger.info("🛑 Slack Worker received stop signal")
                    break

                try:
                    # Process incident notifications
                    self.process_incident_notifications()
                    
                    # Sleep before next poll
                    # Using wait on the event is better than time.sleep for faster shutdown
                    if stop_event:
                        if stop_event.wait(self.config['poll_interval']):
                            break # Event set during wait
                    else:
                        time.sleep(self.config['poll_interval'])
                    
                except KeyboardInterrupt:
                    logger.info("🛑 Received shutdown signal")
                    break
                except Exception as e:
                    logger.error(f"❌ Error in main loop: {e}")
                    # Sleep to avoid busy loop on error
                    if stop_event:
                        stop_event.wait(10)
                    else:
                        time.sleep(10)
                    
        except Exception as e:
            logger.error(f"❌ Fatal error: {e}")
        finally:
            self.cleanup()
            
    def cleanup(self):
        """Cleanup resources"""
        logger.info("🧹 Cleaning up Slack Worker resources...")
        if self.socket_handler:
            try:
                # SocketModeHandler doesn't have a clean stop method exposed easily in older versions
                # but closing the connection should be handled by daemon thread eventually
                self.socket_handler.close() 
            except:
                pass
        if self.repo:
            self.repo.close()

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
            results = self.repo.read_queue_messages(queue_name, self.config['batch_size'])
            messages_processed = 0

            # Check if there are any results
            if not results:
                # logger.debug(f"📭 No messages in queue {queue_name}") 
                # Reduced logging noise
                return

            for row in results:
                # Row content from Repo
                # logger.info(f"🔍 Processing PGMQ message from {queue_name}: keys={list(row.keys())}")

                msg_id = row.get("msg_id")
                read_ct = row.get("read_ct", 0)
                message_json = row.get("message")

                # Parse JSON
                if isinstance(message_json, str):
                    try:
                        message_json = json.loads(message_json)
                    except Exception as e:
                        logger.error(f"❌ Failed to json.loads() message payload for msg_id={msg_id}: {e}")
                        self.repo.delete_message(queue_name, msg_id)
                        continue

                if not isinstance(message_json, dict):
                    logger.error(f"❌ Message payload is not a dict for msg_id={msg_id}")
                    self.repo.delete_message(queue_name, msg_id)
                    continue

                try:
                    logger.info(f"🔍 Processing PGMQ message {msg_id}")
                    message = message_json

                    # Route message based on queue and type
                    if queue_name == 'incident_notifications':
                        logger.info(f"📨 Processing notification: User={message.get('user_id')}, "
                                    f"Incident={message.get('incident_id')}, Type={message.get('type')}")
                        success = self.process_notification(message)
                    elif queue_name == 'slack_feedback':
                        logger.info(f"🔄 Processing Slack feedback: Action={message.get('action')}, "
                                    f"Incident={message.get('incident_id')}")
                        success = self.process_slack_feedback(message)
                    else:
                        logger.warning(f"⚠️  Unknown queue: {queue_name}")
                        success = False

                    if success:
                        self.repo.delete_message(queue_name, msg_id)
                        messages_processed += 1
                    else:
                        self.handle_failed_message(queue_name, msg_id, message, read_ct)

                except Exception as e:
                    logger.error(f"❌ Error processing message {msg_id}: {e}")
                    import traceback
                    logger.error(f"   Stacktrace: {traceback.format_exc()}")

            if messages_processed > 0:
                logger.info(f"📬 Processed {messages_processed} messages from {queue_name}")
            else:
                pass 
                # logger.debug(f"📭 No messages processed from {queue_name} this cycle")

        except Exception as e:
            logger.error(f"❌ Error processing queue {queue_name}: {e}")
            import traceback
            logger.error(f"   Stacktrace: {traceback.format_exc()}")
            
    def process_notification(self, notification_msg: Dict[str, Any]) -> bool:
        """Process a single notification message"""
        try:
            # logger.info(f"🔍 Processing notification: {notification_msg}")
            # Check if Slack is in the channels list
            channels = notification_msg.get('channels', [])
            if 'slack' not in channels:
                # logger.info(f"📭 Slack not in channels {channels}, skipping")
                return True
                
            # Get user and incident details via Repo
            user_data = self.repo.get_user_data(notification_msg.get('user_id'))
            incident_data = self.repo.get_incident_data(notification_msg.get('incident_id'))

            # logger.info(f"🔍 User data: {user_data}")
            
            if not user_data or not incident_data:
                logger.error(f"❌ Missing user or incident data")
                return False
                
            # Check if user has Slack configuration
            if not user_data.get('slack_user_id'):
                # For system users, try to fallback to assigned user's Slack ID
                if user_data.get('email', '').endswith('@system.local'):
                    assigned_user_data = self.repo.get_assigned_user_data(incident_data.get('assigned_to'))
                    if assigned_user_data and assigned_user_data.get('slack_user_id'):
                        logger.info(f"🔄 System user {user_data.get('name', 'Unknown')} has no Slack ID, using assigned user {assigned_user_data.get('name', 'Unknown')} for notification")
                        user_data['slack_user_id'] = assigned_user_data['slack_user_id']
                        user_data['fallback_to_assigned'] = True
                        user_data['assigned_user_name'] = assigned_user_data.get('name', 'Unknown')
                    else:
                        logger.warning(f"⚠️  System user {user_data.get('name', 'Unknown')} has no Slack ID and no assigned user with Slack config")
                        return True
                else:
                    logger.warning(f"⚠️  User {notification_msg.get('user_id')} has no Slack user ID configured")
                    return True
                
            # Send Slack notification based on type
            notification_type = notification_msg.get('type', 'assigned')

            if notification_type == 'assigned':
                return self.send_incident_assigned_notification(user_data, incident_data, notification_msg)
            elif notification_type == 'escalated':
                return self.send_incident_escalated_notification(user_data, incident_data, notification_msg)
            elif notification_type == 'acknowledged':
                return self.send_incident_x_notification(user_data, incident_data, notification_msg, 'acknowledged')
            elif notification_type == 'resolved':
                return self.send_incident_x_notification(user_data, incident_data, notification_msg, 'resolved')
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
            
            # Reconstruct body object for Slack API calls
            original_blocks = slack_context.get("original_blocks", [])
            logger.info(f"📦 Reconstructing body with {len(original_blocks)} saved blocks")
            
            body = {
                "channel": {"id": slack_context.get("channel_id")},
                "message": {
                    "ts": slack_context.get("message_ts"),
                    "blocks": original_blocks
                },
                "response_url": slack_context.get("response_url")
            }
            
            if action == "acknowledgment_success":
                user_name = feedback_msg.get('user_name', 'Unknown')
                logger.info(f"✅ Processing acknowledgment success feedback for incident {incident_id}")
                
                # Update ALL messages to final acknowledged state
                self.update_all_messages_for_incident(incident_id, user_name, "acknowledged")
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
            
    def send_incident_assigned_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send Slack notification for incident assignment"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            incident_message = SlackMessage(incident_data)
            
            # Create formatted blocks via Builder
            routed_teams = self.repo.get_routed_teams(incident_data)
            blocks = self.builder.format_incident_blocks(incident_data, notification_msg, 'triggered', routed_teams)
            
            # Add action buttons
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
                            "url": self.builder.get_incident_url(incident_data['id']),
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
            
            # Send message using Slack Client
            notification_text = f"[Assigned] {incident_message.get_title()}"
            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=notification_text,
                blocks=blocks
            )

            # logger.info(f"📨 Slack response: {response}")

            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"

            message_ts = response.get('ts') if response else None
            channel_id = response.get('channel') if response else None

            # Log to DB via Repo
            self.repo.log_notification_with_slack_info(
                notification_msg_with_recipient, 'slack', True if response else False, 
                None, message_ts, channel_id
            )
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to send Slack notification: {e}")
            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.repo.log_notification(notification_msg_with_recipient, 'slack', False, str(e))
            return False

    def send_incident_x_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict, status: str) -> bool:
        """Update ALL Slack messages for incident status change (acknowledged/resolved)"""
        try:
            routed_teams = self.repo.get_routed_teams(incident_data)
            blocks = self.builder.format_incident_blocks(incident_data, notification_msg, status, routed_teams)

            incident_message = SlackMessage(incident_data)
            incident_id = incident_message.get_id()

            # Find ALL messages via Repo
            all_messages = self.repo.find_all_slack_messages_for_incident(incident_id)

            if not all_messages:
                logger.warning(f"⚠️  No Slack messages found for incident {incident_id}")
                # Fallback: send new notification
                if status == 'acknowledged':
                     return self.send_new_acknowledgment_notification(user_data, incident_data, notification_msg)
                else: 
                     return self.send_new_resolution_notification(user_data, incident_data, notification_msg)

            logger.info(f"📨 Found {len(all_messages)} Slack messages to update")

            # Add view button only
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
                            "url": self.builder.get_incident_url(incident_data['id']),
                            "style": "primary"
                        }
                    ]
                })
            
            blocks.append({"type": "divider"})

            user_name = user_data.get('name', 'Unknown User')
            incident_title = incident_message.get_title()
            incident_short_id = incident_message.get_incident_short_id()
            status_emoji = "🔔" if status == "acknowledged" else "🎉"
            status_text = f"[{status.title()}]"
            notification_text = f"{status_text} {incident_title}"
            
            updated_count = 0
            for channel_id, message_ts in all_messages:
                try:
                    self.slack_client.chat_update(
                        channel=channel_id,
                        ts=message_ts,
                        text=notification_text,
                        blocks=blocks
                    )
                    updated_count += 1
                    
                    alert_text = f"{status_emoji} Incident {incident_short_id} \"{incident_title}\" was {status} by {user_name}"
                    self.slack_client.chat_postMessage(
                        channel=channel_id,
                        text=alert_text
                    )
                except Exception as e:
                    logger.error(f"   ❌ Failed to update message in channel {channel_id}: {e}")

            return updated_count > 0

        except Exception as e:
            logger.error(f"❌ Failed to update Slack messages for {status} incident: {e}")
            return False

    def send_new_acknowledgment_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send new Slack notification for incident acknowledgment (fallback)"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            routed_teams = self.repo.get_routed_teams(incident_data)
            blocks = self.builder.format_incident_blocks(incident_data, notification_msg, 'acknowledged', routed_teams)

            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "View Incident"},
                            "url": self.builder.get_incident_url(incident_data['id']),
                            "style": "primary"
                        }
                    ]
                })

            incident_short_id = f"#{incident_data.get('id', '')[-8:]}"
            incident_title = incident_data.get('title', 'Unknown Incident')
            self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"Incident {incident_short_id} \"{incident_title}\" acknowledged",
                blocks=blocks
            )

            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.repo.log_notification(notification_msg_with_recipient, 'slack', True, None)
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send new Slack acknowledged notification: {e}")
            return False

    def send_new_resolution_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send new Slack notification for incident resolution (fallback)"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            
            blocks = [
                {"type": "header", "text": {"type": "plain_text", "text": "🎉 Incident Resolved"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*{incident_data.get('title', 'Unknown Incident')}*"}},
                 {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Incident ID:*\n#{incident_data.get('id', 'Unknown')[-8:]}"},
                        {"type": "mrkdwn", "text": f"*Status:*\nResolved"},
                        {"type": "mrkdwn", "text": f"*Severity:*\n{incident_data.get('severity', 'Unknown').title()}"},
                        {"type": "mrkdwn", "text": f"*Source:*\n{incident_data.get('source', 'Unknown').title()}"},
                        {"type": "mrkdwn", "text": f"*Resolved by:*\n{user_data.get('name', 'Unknown User')}"}
                    ]
                }
            ]
            
            if incident_data.get('description'):
                desc, _ = self.builder.clean_description_text(incident_data.get('description'))
                if desc:
                    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Description:*\n{desc}"}})

            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "View Incident"},
                            "url": self.builder.get_incident_url(incident_data['id']),
                            "style": "primary"
                        }
                    ]
                })

            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"Incident Resolved",
                blocks=blocks
            )

            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"
            self.repo.log_notification(notification_msg_with_recipient, 'slack', True, None)
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send new Slack resolved notification: {e}")
            return False
            
    def send_incident_escalated_notification(self, user_data: Dict, incident_data: Dict, notification_msg: Dict) -> bool:
        """Send Slack notification for incident escalation"""
        try:
            slack_user_id = user_data['slack_user_id'].lstrip('@')
            routed_teams = self.repo.get_routed_teams(incident_data)
            blocks = self.builder.format_incident_blocks(incident_data, notification_msg, 'escalated', routed_teams)
            incident_message = SlackMessage(incident_data)
            
            # Add urgent action buttons
            if incident_data.get('id'):
                blocks.append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Handle Immediately"},
                            "url": self.builder.get_incident_url(incident_data['id']),
                            "style": "danger"
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Acknowledge"},
                            "value": f"ack_{incident_data['id']}",
                            "action_id": "acknowledge_incident"
                        }
                    ]
                })
            
            response = self.slack_client.chat_postMessage(
                channel=f"@{slack_user_id}",
                text=f"🔄 [Escalated] {incident_message.get_title()}",
                blocks=blocks
            )

            notification_msg_with_recipient = notification_msg.copy()
            notification_msg_with_recipient['recipient'] = f"@{slack_user_id}"

            message_ts = response.get('ts') if response else None
            channel_id = response.get('channel') if response else None

            self.repo.log_notification_with_slack_info(
                notification_msg_with_recipient, 'slack', True if response else False, 
                None, message_ts, channel_id
            )
            return True
        except Exception as e:
            logger.error(f"❌ Failed to send Slack escalation notification: {e}")
            return False

    def handle_failed_message(self, queue_name: str, msg_id: int, notification_msg: Dict, read_ct: int = 0):
        """Handle failed message processing with retry logic"""
        try:
            if read_ct > self.config['max_retries']:
                logger.error(f"❌ Message {msg_id} exceeded max retries (read_ct={read_ct}), deleting")
                self.repo.delete_message(queue_name, msg_id)
            else:
                logger.warning(f"⚠️  Message {msg_id} failed, read_ct: {read_ct}/{self.config['max_retries']}")
        except Exception as e:
            logger.error(f"❌ Error handling failed message: {e}")
            
    def update_all_messages_for_incident(self, incident_id: str, user_name: str, state: str):
        """Update ALL Slack messages for an incident"""
        try:
            incident_data = self.repo.get_incident_data(incident_id)
            if not incident_data:
                logger.error(f"❌ Could not find incident {incident_id}")
                return
            
            routed_teams = self.repo.get_routed_teams(incident_data)
            blocks = self.builder.format_incident_blocks(incident_data, {}, state, routed_teams)
            
            blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Incident"},
                        "url": self.builder.get_incident_url(incident_id),
                        "style": "primary"
                    }
                ]
            })
            
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Acknowledged by:* @{user_name}\n*Time:* {datetime.now().strftime('%H:%M %d/%m/%Y')}"
                }
            })
            
            all_messages = self.repo.find_all_slack_messages_for_incident(incident_id)
            
            incident_short_id = f"#{incident_id[-8:]}"
            
            for channel_id, message_ts in all_messages:
                try:
                    self.slack_client.chat_update(
                        channel=channel_id,
                        ts=message_ts,
                        text=f"Incident {incident_short_id} acknowledged by @{user_name}",
                        blocks=blocks
                    )
                    self.slack_client.chat_postMessage(
                        channel=channel_id,
                        text=f"🔔 Incident {incident_short_id} was acknowledged by {user_name}"
                    )
                except Exception as e:
                    logger.error(f"   ❌ Failed to update message in channel {channel_id}: {e}")
            
        except Exception as e:
            logger.error(f"❌ Error updating all messages for incident: {e}")
    
    def update_message_optimistically(self, body: dict, incident_id: str, user_name: str, state: str):
        """Update Slack message optimistically using top-level blocks - Direct Block Manipulation"""
        try:
            original_message = body["message"]
            blocks = original_message.get("blocks", [])
            
            if not blocks:
                return
                
            updated_blocks = [block.copy() for block in blocks]
            
            if state == "acknowledging":
                # Robust implementation looking for content
                for block in updated_blocks:
                    if block.get("type") == "section" and "text" in block:
                         text = block["text"].get("text", "")
                         if ":fire:" in text or "[Triggered]" in text:
                             # This is likely the header
                             updated_text = text.replace(":fire: ", "").replace("[Triggered]", "[Acknowledging]")
                             block["text"]["text"] = f":large_yellow_circle: {updated_text}"
                             break

                # Replace action buttons
                for i, block in enumerate(updated_blocks):
                    if block.get("type") == "actions":
                        # Replace with specific loading/Ack message
                        updated_blocks[i] = {
                             "type": "context",
                             "elements": [
                                 {"type": "mrkdwn", "text": f"⏳ Acknowledging..."}
                             ]
                        }

            elif state == "queue_failed":
                 # Revert to error state
                 pass

            self.slack_client.chat_update(
                channel=body["channel"]["id"],
                ts=body["message"]["ts"],
                blocks=updated_blocks,
                text=original_message.get("text", "Status update") # fallback text
            )
            
        except Exception as e:
            logger.error(f"❌ Error updating message optimistically: {e}")

    def rollback_optimistic_update(self, body: dict, incident_id: str, reason: str):
        """Rollback optimistic update on failure"""
        try:
            # revert to original blocks
            # But we might not have them easily unless we saved them or re-fetch from incident data
            # Simpler: Post ephemeral error message
             self.slack_client.chat_postEphemeral(
                channel=body["channel"]["id"],
                user=body["user"]["id"],
                text=f"❌ Failed to acknowledge incident: {reason}"
            )
             # Ideally we should start a re-fetch loop or just leave it. 
             # The original blocks are available in 'body' usually, but 'chat_update' needs the state.
             pass
        except Exception as e:
            logger.error(f"❌ Error rolling back: {e}")

    def send_error_message(self, response_url: str, message: str):
        """Send error message to response_url"""
        if not response_url: return
        try:
             import requests
             requests.post(response_url, json={"text": f"❌ {message}", "response_type": "ephemeral"})
        except Exception as e:
             logger.error(f"Failed to send error message: {e}")

if __name__ == "__main__":
    # Standalone execution
    worker = SlackWorker()
    worker.run()
