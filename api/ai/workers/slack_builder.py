import re
from typing import Optional, Dict, Any, List

class SlackMessage:
    def __init__(self, incident_data: Dict):
        self.incident_data = incident_data
    
    def get_title(self) -> str:
        # Priority: labels.alert_title > incident.title > 'No title'
        labels = self.incident_data.get('labels') or {}
        alert_title = labels.get('alert_title')
        if alert_title:
            return alert_title
        # Fall back to incident's main title field
        return self.incident_data.get('title') or 'No title'
    
    def get_description(self) -> str:
        return self.incident_data.get('description', 'No description')
    
    def get_priority(self) -> str:
        return self.incident_data.get('priority', 'P0').upper()
    
    def get_status(self) -> str:
        return self.incident_data.get('status', 'triggered').lower()
    
    def get_source(self) -> str:
        return self.incident_data.get('source', 'unknown')
    
    def get_id(self) -> str:
        return self.incident_data.get('id', 'unknown')

    def get_incident_short_id(self) -> str:
        return f"#{self.get_id()[-8:]}"

    def get_incident_alert_status(self) -> str:
        # Use 'or {}' to handle both missing key AND null value
        return (self.incident_data.get('labels') or {}).get('alert_status', 'unknown')

class SlackMessageBuilder:
    """Handles Slack message formatting and Block Kit construction"""

    def __init__(self, api_base_url: str):
        self.api_base_url = api_base_url

    def get_incident_url(self, incident_id: str) -> str:
        """Generate incident URL for AI agent"""
        return f"{self.api_base_url}/ai-agent?incident={incident_id}"

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

        # Normalize whitespace: Replace multiple newlines with single space
        # This prevents long vertical messages in Slack
        clean_text = re.sub(r'\n+', ' ', clean_text)  # Replace all \n with space
        clean_text = re.sub(r'\s+', ' ', clean_text)  # Collapse multiple spaces
        clean_text = clean_text.strip()

        # Truncate long descriptions intelligently
        max_length = 500  # Reduced from 2900 to keep messages compact
        if len(clean_text) > max_length:
            # Try to truncate at sentence boundary
            sentences = clean_text[:max_length].split('. ')
            if len(sentences) > 1:
                clean_text = '. '.join(sentences[:-1]) + '.'
            else:
                # Fallback to word boundary
                clean_text = clean_text[:max_length].rsplit(' ', 1)[0] + '...'

        return clean_text, image_urls

    def title_contains_status(self, title: str) -> bool:
        """Check if incident title already contains status information"""
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

    def format_incident_blocks(self, incident_data: Dict, notification_msg: Dict, status_override: str = None, routed_teams: str = "unknown") -> List[Dict]:
        """Format incident as Slack top-level blocks (Block Kit) - Compact version"""

        # Get incident details
        incident_message = SlackMessage(incident_data)
        incident_short_id = incident_message.get_incident_short_id()
        title = incident_message.get_title()
        description = incident_message.get_description()
        description, image_urls = self.clean_description_text(description)
        priority = incident_message.get_priority()
        status = (status_override or incident_data.get('status', 'triggered')).lower()
        alert_status = incident_message.get_incident_alert_status()

        # Status display mapping
        status_display = {
            'triggered': 'Triggered',
            'acknowledged': 'Acknowledged',
            'resolved': 'Resolved',
            'closed': 'Closed',
            'escalated': 'Escalated'
        }

        emoji_mapping = {
            'triggered': ":fire:",
            'acknowledged': ":large_yellow_circle:",
            'resolved': ":white_check_mark:",
            'closed': ":lock:",
            'escalated': ":zap:"
        }

        status_emoji = emoji_mapping.get(status, ":question:")

        # Check if title already contains status information
        status_values = list(status_display.values())
        # We also need to check lower case versions as title_has_status logic
        title_has_status = any(f"[{s}]" in title.lower() for s in status_values) 

        if self.title_contains_status(title):
             header_prefix = f"{status_emoji} "
        else:
             header_prefix = f"{status_emoji} *{status_display.get(status, 'Unknown')}* • {priority} • "

        max_title_length = 150 - len(header_prefix)
        if len(title) > max_title_length:
            available_length = max_title_length - 3
            truncated_title = title[:available_length].rsplit(' ', 1)[0] + "..."
            if len(truncated_title) < available_length * 0.7:
                truncated_title = title[:available_length] + "..."
        else:
            truncated_title = title

        url = self.get_incident_url(incident_data['id'])
        # routed_teams is passed in argument now

        # Build compact blocks with better markdown formatting
        blocks: List[Dict] = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{header_prefix}<{url}|{truncated_title}> `{incident_short_id}`"
                }
            }
        ]

        # Only add alert status if it's not empty and meaningful
        if alert_status and alert_status.strip() and alert_status.lower() not in ['unknown', 'none', 'n/a']:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Status:* {alert_status}"
                }
            })

        # Add description with markdown formatting
        if description and description.strip():
            # Format description with proper markdown
            formatted_desc = description.replace('\n\n', '\n').strip()
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f">{formatted_desc}"  # Quote format for better visual separation
                }
            })

        # Compact metadata in single line
        metadata_parts = []
        if routed_teams:
            metadata_parts.append(f"*Team:* {routed_teams}")

        source = incident_data.get('source', '')
        if source:
            metadata_parts.append(f"*Source:* {source}")

        if metadata_parts:
            blocks.append({
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": " • ".join(metadata_parts)
                    }
                ]
            })

        # Add image blocks if any (keep for graphs)
        for image_url in image_urls:
            blocks.append({
                "type": "image",
                "image_url": image_url,
                "alt_text": "Metric Graph"
            })

        return blocks
