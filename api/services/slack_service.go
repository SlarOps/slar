package services

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/vanchonlee/slar/db"
)

type SlackService struct {
	PG       *sql.DB
	botToken string
	client   *http.Client
}

// SlackMessage represents the structure for sending Slack messages
type SlackMessage struct {
	Channel     string                   `json:"channel"`
	Text        string                   `json:"text"`
	Blocks      []map[string]interface{} `json:"blocks,omitempty"`
	Attachments []SlackAttachment        `json:"attachments,omitempty"`
	Username    string                   `json:"username,omitempty"`
	IconEmoji   string                   `json:"icon_emoji,omitempty"`
}

// SlackAttachment represents Slack message attachments
type SlackAttachment struct {
	Color     string       `json:"color"`
	Title     string       `json:"title,omitempty"`
	Text      string       `json:"text,omitempty"`
	Fields    []SlackField `json:"fields,omitempty"`
	Footer    string       `json:"footer,omitempty"`
	Timestamp int64        `json:"ts,omitempty"`
}

type SlackField struct {
	Title string `json:"title"`
	Value string `json:"value"`
	Short bool   `json:"short"`
}

// SlackResponse represents the response from Slack API
type SlackResponse struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Channel string `json:"channel,omitempty"`
	TS      string `json:"ts,omitempty"` // Message timestamp
}

// IncidentNotification represents the notification message structure
type IncidentNotification struct {
	UserID     string `json:"user_id"`
	IncidentID string `json:"incident_id"`
	Type       string `json:"type"` // "assigned", "escalated", "resolved"
}

func NewSlackService(pg *sql.DB) (*SlackService, error) {
	botToken := os.Getenv("SLACK_BOT_TOKEN")
	if botToken == "" {
		log.Println("⚠️  SLACK_BOT_TOKEN not set, Slack notifications will be disabled")
		return &SlackService{PG: pg}, nil
	}

	return &SlackService{
		PG:       pg,
		botToken: botToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// SendIncidentNotification sends incident notification to user via Slack
func (s *SlackService) SendIncidentNotification(userID, incidentID, notificationType string) error {
	if s.botToken == "" {
		log.Println("Slack bot token not configured, skipping notification")
		return nil
	}

	// Get user notification config
	config, err := s.getUserNotificationConfig(userID)
	if err != nil {
		return fmt.Errorf("failed to get user notification config: %v", err)
	}

	if !config.SlackEnabled || config.SlackUserID == "" {
		log.Printf("Slack notifications disabled or not configured for user %s", userID)
		return nil
	}

	// Get incident details
	incident, err := s.getIncidentDetails(incidentID)
	if err != nil {
		return fmt.Errorf("failed to get incident details: %v", err)
	}

	// Get user details
	user, err := s.getUserDetails(userID)
	if err != nil {
		return fmt.Errorf("failed to get user details: %v", err)
	}

	// Create Slack message
	message := s.createIncidentSlackMessage(incident, user, notificationType, config.SlackUserID)

	// Determine target channel (DM to user or configured channel)
	channel := config.SlackUserID // Send DM by default
	if config.SlackChannelID != "" {
		channel = config.SlackChannelID
	}

	// Send message
	_, err = s.sendSlackMessage(channel, message)
	if err != nil {
		s.logNotification(userID, incidentID, "slack", config.SlackUserID,
			message.Text, "failed", err.Error(), nil)
		return fmt.Errorf("failed to send Slack message: %v", err)
	}

	// Log successful notification
	sentAt := time.Now()
	s.logNotification(userID, incidentID, "slack", config.SlackUserID,
		message.Text, "sent", "", &sentAt)

	log.Printf("✅ Sent Slack notification to %s for incident %s (type: %s)",
		user.Name, incident.ID, notificationType)

	return nil
}

// createIncidentSlackMessage creates a rich Slack message for incident notifications
func (s *SlackService) createIncidentSlackMessage(incident *db.Incident, user *db.User, notificationType, slackUserID string) SlackMessage {
	var messageText string
	var color string
	var title string

	switch notificationType {
	case "assigned":
		messageText = "🚨 Incident assigned to you"
		title = fmt.Sprintf("Incident Assigned: %s", incident.Title)
		color = "warning"
	case "escalated":
		messageText = "⚡ Incident escalated to you"
		title = fmt.Sprintf("Incident Escalated: %s", incident.Title)
		color = "danger"
	case "resolved":
		messageText = "✅ Incident resolved"
		title = fmt.Sprintf("Incident Resolved: %s", incident.Title)
		color = "good"
	default:
		messageText = "📢 Incident notification"
		title = fmt.Sprintf("Incident: %s", incident.Title)
		color = "warning"
	}

	// Create severity emoji
	severityEmoji := "🟡"
	switch incident.Severity {
	case "critical":
		severityEmoji = "🔴"
		color = "danger"
	case "high":
		severityEmoji = "🟠"
	case "medium":
		severityEmoji = "🟡"
	case "low":
		severityEmoji = "🟢"
	}

	// Build rich attachment
	attachment := SlackAttachment{
		Color: color,
		Title: title,
		Fields: []SlackField{
			{
				Title: "Severity",
				Value: fmt.Sprintf("%s %s", severityEmoji, incident.Severity),
				Short: true,
			},
			{
				Title: "Status",
				Value: incident.Status,
				Short: true,
			},
			{
				Title: "Description",
				Value: incident.Description,
				Short: false,
			},
			{
				Title: "Assigned To",
				Value: user.Name,
				Short: true,
			},
			{
				Title: "Created At",
				Value: incident.CreatedAt.Format("2006-01-02 15:04:05 UTC"),
				Short: true,
			},
		},
		Footer:    "SLAR Incident Management",
		Timestamp: incident.CreatedAt.Unix(),
	}

	return SlackMessage{
		Channel:     slackUserID,
		Text:        messageText,
		Attachments: []SlackAttachment{attachment},
		Username:    "SLAR Bot",
		IconEmoji:   ":rotating_light:",
	}
}

// sendSlackMessage sends message to Slack using chat.postMessage API
func (s *SlackService) sendSlackMessage(channel string, message SlackMessage) (*SlackResponse, error) {
	message.Channel = channel

	jsonData, err := json.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal message: %v", err)
	}

	req, err := http.NewRequest("POST", "https://slack.com/api/chat.postMessage", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.botToken)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	var slackResp SlackResponse
	if err := json.NewDecoder(resp.Body).Decode(&slackResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	if !slackResp.OK {
		return &slackResp, fmt.Errorf("slack API error: %s", slackResp.Error)
	}

	return &slackResp, nil
}

// getUserNotificationConfig gets user's notification configuration
func (s *SlackService) getUserNotificationConfig(userID string) (*userNotificationConfig, error) {
	var config userNotificationConfig

	query := `
		SELECT user_id, slack_user_id, slack_channel_id, slack_enabled, 
		       email_enabled, push_enabled, notification_timezone
		FROM user_notification_configs
		WHERE user_id = $1
	`

	var slackUserID, slackChannelID, timezone sql.NullString

	err := s.PG.QueryRow(query, userID).Scan(
		&config.UserID,
		&slackUserID,
		&slackChannelID,
		&config.SlackEnabled,
		&config.EmailEnabled,
		&config.PushEnabled,
		&timezone,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			// Create default config for user
			return s.createDefaultNotificationConfig(userID)
		}
		return nil, err
	}

	config.SlackUserID = slackUserID.String
	config.SlackChannelID = slackChannelID.String
	config.Timezone = timezone.String

	return &config, nil
}

// createDefaultNotificationConfig creates default notification config for user
func (s *SlackService) createDefaultNotificationConfig(userID string) (*userNotificationConfig, error) {
	query := `
		INSERT INTO user_notification_configs (user_id, slack_enabled, email_enabled, push_enabled)
		VALUES ($1, true, true, true)
		RETURNING user_id, slack_enabled, email_enabled, push_enabled
	`

	config := &userNotificationConfig{
		UserID:       userID,
		SlackEnabled: true,
		EmailEnabled: true,
		PushEnabled:  true,
		Timezone:     "UTC",
	}

	err := s.PG.QueryRow(query, userID).Scan(
		&config.UserID,
		&config.SlackEnabled,
		&config.EmailEnabled,
		&config.PushEnabled,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to create default notification config: %v", err)
	}

	return config, nil
}

// getIncidentDetails gets incident details by ID
func (s *SlackService) getIncidentDetails(incidentID string) (*db.Incident, error) {
	var incident db.Incident

	query := `
		SELECT id, title, description, status, urgency, severity, source, created_at, updated_at
		FROM incidents
		WHERE id = $1
	`

	err := s.PG.QueryRow(query, incidentID).Scan(
		&incident.ID,
		&incident.Title,
		&incident.Description,
		&incident.Status,
		&incident.Urgency,
		&incident.Severity,
		&incident.Source,
		&incident.CreatedAt,
		&incident.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	return &incident, nil
}

// getUserDetails gets user details by ID
func (s *SlackService) getUserDetails(userID string) (*db.User, error) {
	var user db.User

	query := `
		SELECT id, name, email, phone, role, team, created_at
		FROM users
		WHERE id = $1
	`

	var phone sql.NullString

	err := s.PG.QueryRow(query, userID).Scan(
		&user.ID,
		&user.Name,
		&user.Email,
		&phone,
		&user.Role,
		&user.Team,
		&user.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	user.Phone = phone.String

	return &user, nil
}

// logNotification logs notification to database for auditing
func (s *SlackService) logNotification(userID, incidentID, channel, recipient, message, status, errorMsg string, sentAt *time.Time) {
	query := `
		INSERT INTO notification_logs (user_id, incident_id, notification_type, channel, recipient, message, status, error_message, sent_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`

	var sentAtParam interface{}
	if sentAt != nil {
		sentAtParam = *sentAt
	}

	_, err := s.PG.Exec(query, userID, incidentID, "incident_assigned", channel, recipient, message, status, errorMsg, sentAtParam)
	if err != nil {
		log.Printf("Failed to log notification: %v", err)
	}
}

// userNotificationConfig represents user notification preferences
type userNotificationConfig struct {
	UserID         string `json:"user_id"`
	SlackUserID    string `json:"slack_user_id"`
	SlackChannelID string `json:"slack_channel_id"`
	SlackEnabled   bool   `json:"slack_enabled"`
	EmailEnabled   bool   `json:"email_enabled"`
	PushEnabled    bool   `json:"push_enabled"`
	Timezone       string `json:"timezone"`
}

// UpdateUserNotificationConfig updates user's notification preferences
func (s *SlackService) UpdateUserNotificationConfig(userID, slackUserID, slackChannelID string,
	slackEnabled, emailEnabled, pushEnabled bool, timezone string) error {
	query := `
		UPDATE user_notification_configs 
		SET slack_user_id = $2, slack_channel_id = $3, slack_enabled = $4,
		    email_enabled = $5, push_enabled = $6, notification_timezone = $7,
		    updated_at = NOW()
		WHERE user_id = $1
	`

	var slackUserIDParam, slackChannelIDParam, timezoneParam interface{}
	if slackUserID != "" {
		slackUserIDParam = slackUserID
	}
	if slackChannelID != "" {
		slackChannelIDParam = slackChannelID
	}
	if timezone != "" {
		timezoneParam = timezone
	} else {
		timezoneParam = "UTC"
	}

	result, err := s.PG.Exec(query, userID, slackUserIDParam, slackChannelIDParam,
		slackEnabled, emailEnabled, pushEnabled, timezoneParam)

	if err != nil {
		return fmt.Errorf("failed to update notification config: %v", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %v", err)
	}

	if rowsAffected == 0 {
		// Config doesn't exist, create it
		_, err = s.createDefaultNotificationConfig(userID)
		if err != nil {
			return fmt.Errorf("failed to create notification config: %v", err)
		}

		// Try update again
		_, err = s.PG.Exec(query, userID, slackUserIDParam, slackChannelIDParam,
			slackEnabled, emailEnabled, pushEnabled, timezoneParam)
		return err
	}

	return nil
}

// GetUserNotificationConfig gets user's notification configuration (public method)
func (s *SlackService) GetUserNotificationConfig(userID string) (*userNotificationConfig, error) {
	return s.getUserNotificationConfig(userID)
}
