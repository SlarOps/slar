package workers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/vanchonlee/slar/services"
)

// NotificationWorker handles processing notification messages from PGMQ
// Note: Slack notifications are handled by the Python SlackWorker for rich formatting
type NotificationWorker struct {
	PG         *sql.DB
	FCMService *services.FCMService
}

// NotificationMessage represents a message in the notification queue
type NotificationMessage struct {
	UserID      string                 `json:"user_id"`
	IncidentID  string                 `json:"incident_id"`
	Type        string                 `json:"type"`           // "assigned", "escalated", "resolved", "acknowledged"
	Priority    string                 `json:"priority"`       // "high", "medium", "low"
	Channels    []string               `json:"channels"`       // ["slack", "email", "push"]
	Data        map[string]interface{} `json:"data,omitempty"` // Additional context data
	RetryCount  int                    `json:"retry_count"`    // Current retry attempt
	ScheduledAt *time.Time             `json:"scheduled_at"`   // For delayed notifications
	CreatedAt   time.Time              `json:"created_at"`
}

// PGMQMessage represents a message from PGMQ
type PGMQMessage struct {
	MsgID      int64           `json:"msg_id"`
	ReadCT     int             `json:"read_ct"`
	EnqueuedAt time.Time       `json:"enqueued_at"`
	Message    json.RawMessage `json:"message"`
}

func NewNotificationWorker(pg *sql.DB, fcmService *services.FCMService) *NotificationWorker {
	return &NotificationWorker{
		PG:         pg,
		FCMService: fcmService,
	}
}

// StartNotificationWorker starts the notification worker to process messages from PGMQ
func (w *NotificationWorker) StartNotificationWorker() {
	log.Println("🔔 Notification worker started, processing messages from PGMQ...")

	ticker := time.NewTicker(1 * time.Second) // Check every 2 seconds
	defer ticker.Stop()

	for range ticker.C {
		w.processNotificationMessages()
	}
}

// processNotificationMessages reads and processes messages from PGMQ notification queues
func (w *NotificationWorker) processNotificationMessages() {
	// Process incident notifications
	// w.processQueueMessages("incident_notifications")

	// Process incident actions (acknowledge, resolve, etc.)
	w.processIncidentActionsQueue("incident_actions")

	// Process general notifications (for future use)
	// w.processQueueMessages("general_notifications")
}

// deleteMessage deletes a processed message from PGMQ
func (w *NotificationWorker) deleteMessage(queueName string, msgID int64) {
	query := `SELECT pgmq.delete($1, $2::bigint)`
	_, err := w.PG.Exec(query, queueName, msgID)
	if err != nil {
		log.Printf("❌ Failed to delete message %d from queue %s: %v", msgID, queueName, err)
	}
}

// sendNotificationMessage sends a notification message to PGMQ queue
func (w *NotificationWorker) sendNotificationMessage(queueName string, msg *NotificationMessage) error {
	msgJSON, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal notification message: %v", err)
	}

	// Add message to queue with optional delay
	var query string
	var args []interface{}

	if msg.ScheduledAt != nil {
		// Schedule message for later delivery
		query = `SELECT pgmq.send($1, $2, $3)`
		args = []interface{}{queueName, string(msgJSON), *msg.ScheduledAt}
	} else {
		// Send immediately
		query = `SELECT pgmq.send($1, $2)`
		args = []interface{}{queueName, string(msgJSON)}
	}

	_, err = w.PG.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("failed to send message to queue %s: %v", queueName, err)
	}

	return nil
}

// getUserIDFromSlackID looks up database user ID from Slack user ID
func (w *NotificationWorker) getUserIDFromSlackID(slackUserID string) (string, error) {
	var userID string
	query := `
		SELECT u.id
		FROM users u
		JOIN user_notification_configs unc ON u.id = unc.user_id
		WHERE unc.slack_user_id = $1
		   OR unc.slack_user_id = '@' || $1
		   OR unc.slack_user_id = LTRIM($1, '@')
	`

	err := w.PG.QueryRow(query, slackUserID).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("user not found for Slack ID %s: %v", slackUserID, err)
	}

	return userID, nil
}

// logFailedNotification logs permanently failed notifications to database
func (w *NotificationWorker) logFailedNotification(msg *NotificationMessage, err error) {
	query := `
		INSERT INTO notification_logs (user_id, incident_id, notification_type, channel, recipient, 
		                              message, status, error_message, retry_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`

	channels := ""
	if len(msg.Channels) > 0 {
		channelsJSON, _ := json.Marshal(msg.Channels)
		channels = string(channelsJSON)
	}

	errorMsg := ""
	if err != nil {
		errorMsg = err.Error()
	}

	_, dbErr := w.PG.Exec(query,
		msg.UserID,
		msg.IncidentID,
		msg.Type,
		channels,
		"", // recipient will be filled by individual channel handlers
		"", // message content will be filled by individual channel handlers
		"failed",
		errorMsg,
		msg.RetryCount,
	)

	if dbErr != nil {
		log.Printf("❌ Failed to log failed notification: %v", dbErr)
	}
}

// SendIncidentAssignedNotification is a helper to send incident assignment notifications
func (w *NotificationWorker) SendIncidentAssignedNotification(userID, incidentID string) error {
	message := &NotificationMessage{
		UserID:     userID,
		IncidentID: incidentID,
		Type:       "assigned",
		Priority:   "high",
		Channels:   []string{"slack", "push"}, // Send via Slack and push notifications
		RetryCount: 0,
		CreatedAt:  time.Now(),
	}

	return w.sendNotificationMessage("incident_notifications", message)
}

// SendIncidentEscalatedNotification is a helper to send incident escalation notifications
func (w *NotificationWorker) SendIncidentEscalatedNotification(userID, incidentID string) error {
	message := &NotificationMessage{
		UserID:     userID,
		IncidentID: incidentID,
		Type:       "escalated",
		Priority:   "high",
		Channels:   []string{"slack", "push"},
		RetryCount: 0,
		CreatedAt:  time.Now(),
	}

	return w.sendNotificationMessage("incident_notifications", message)
}

// SendIncidentResolvedNotification is a helper to send incident resolution notifications
func (w *NotificationWorker) SendIncidentResolvedNotification(userID, incidentID string) error {
	message := &NotificationMessage{
		UserID:     userID,
		IncidentID: incidentID,
		Type:       "resolved",
		Priority:   "medium",
		Channels:   []string{"slack"},
		RetryCount: 0,
		CreatedAt:  time.Now(),
	}

	return w.sendNotificationMessage("incident_notifications", message)
}

// SendIncidentAcknowledgedNotification is a helper to send incident acknowledged notifications
func (w *NotificationWorker) SendIncidentAcknowledgedNotification(userID, incidentID string) error {
	message := &NotificationMessage{
		UserID:     userID,
		IncidentID: incidentID,
		Type:       "acknowledged",
		Priority:   "medium",
		Channels:   []string{"slack"},
		RetryCount: 0,
		CreatedAt:  time.Now(),
	}

	return w.sendNotificationMessage("incident_notifications", message)
}

// GetQueueStats returns statistics about notification queues
func (w *NotificationWorker) GetQueueStats() (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	queues := []string{"incident_notifications", "general_notifications"}

	for _, queue := range queues {
		query := `SELECT pgmq.metrics($1)`
		var metricsJSON sql.NullString

		err := w.PG.QueryRow(query, queue).Scan(&metricsJSON)
		if err != nil {
			log.Printf("❌ Failed to get metrics for queue %s: %v", queue, err)
			continue
		}

		if metricsJSON.Valid {
			var metrics map[string]interface{}
			if err := json.Unmarshal([]byte(metricsJSON.String), &metrics); err == nil {
				stats[queue] = metrics
			}
		}
	}

	return stats, nil
}

// processIncidentActionsQueue processes incident action messages (acknowledge, resolve, etc.)
func (w *NotificationWorker) processIncidentActionsQueue(queueName string) {
	// Read messages from PGMQ (visibility timeout of 30 seconds)
	// pgmq.read returns: msg_id, read_ct, enqueued_at, vt, message, headers (6 columns in newer PGMQ)
	query := `SELECT msg_id, read_ct, enqueued_at, vt, message FROM pgmq.read($1, 30, $2)`
	batchSize := 5 // Process fewer actions at a time

	rows, err := w.PG.Query(query, queueName, batchSize)
	if err != nil {
		log.Printf("❌ Failed to read from queue %s: %v", queueName, err)
		return
	}
	defer rows.Close()

	messagesProcessed := 0
	for rows.Next() {
		var (
			msgID      int64
			readCT     int
			enqueuedAt time.Time
			vt         time.Time
			messageRaw []byte
		)

		if err := rows.Scan(&msgID, &readCT, &enqueuedAt, &vt, &messageRaw); err != nil {
			log.Printf("❌ Failed to scan message from queue %s: %v", queueName, err)
			continue
		}

		pgmqMsg := &PGMQMessage{
			MsgID:      msgID,
			ReadCT:     readCT,
			EnqueuedAt: enqueuedAt,
			Message:    json.RawMessage(messageRaw),
		}

		// Process the action message
		w.processIncidentAction(queueName, pgmqMsg)
		messagesProcessed++
	}

	if messagesProcessed > 0 {
		log.Printf("⚡ Processed %d incident action messages", messagesProcessed)
	}
}

// processIncidentAction processes a single incident action message
func (w *NotificationWorker) processIncidentAction(queueName string, pgmqMsg *PGMQMessage) {
	var actionMsg map[string]interface{}
	if err := json.Unmarshal(pgmqMsg.Message, &actionMsg); err != nil {
		log.Printf("❌ Failed to unmarshal action message: %v", err)
		w.deleteMessage(queueName, pgmqMsg.MsgID)
		return
	}

	actionType, ok := actionMsg["type"].(string)
	if !ok {
		log.Printf("❌ Invalid action message - missing type")
		w.deleteMessage(queueName, pgmqMsg.MsgID)
		return
	}

	switch actionType {
	case "acknowledge_incident":
		w.processAcknowledgeAction(actionMsg, pgmqMsg.MsgID, queueName)
	default:
		log.Printf("⚠️  Unknown action type: %s", actionType)
		w.deleteMessage(queueName, pgmqMsg.MsgID)
	}
}

// processAcknowledgeAction processes incident acknowledgment via API
func (w *NotificationWorker) processAcknowledgeAction(actionMsg map[string]interface{}, msgID int64, queueName string) {
	incidentID, _ := actionMsg["incident_id"].(string)
	userName, _ := actionMsg["user_name"].(string)

	// Get Slack context for UI feedback and user lookup
	slackContext, hasSlackContext := actionMsg["slack_context"].(map[string]interface{})

	if incidentID == "" || !hasSlackContext {
		log.Printf("❌ Invalid acknowledge action - missing required fields")
		w.deleteMessage(queueName, msgID)
		return
	}

	// Get Slack user ID from context
	slackUserID, _ := slackContext["user_slack_id"].(string)
	if slackUserID == "" {
		log.Printf("❌ Missing Slack user ID in context")
		w.deleteMessage(queueName, msgID)
		return
	}

	// Lookup database user ID from Slack user ID
	dbUserID, err := w.getUserIDFromSlackID(slackUserID)
	if err != nil {
		log.Printf("❌ Failed to lookup user ID for Slack user %s: %v", slackUserID, err)
		if hasSlackContext {
			w.sendSlackAcknowledgmentFailure(slackContext, incidentID, "User not found in database")
		}
		w.deleteMessage(queueName, msgID)
		return
	}

	log.Printf("📝 Processing acknowledgment for incident %s by user %s (Slack: %s)", incidentID, dbUserID, slackUserID)

	// Call API to acknowledge incident with database user ID
	success := w.acknowledgeIncidentAPI(incidentID, dbUserID)

	// Send feedback to Slack if we have context
	if hasSlackContext && success {
		w.sendSlackAcknowledgmentSuccess(slackContext, incidentID, userName)
	} else if hasSlackContext && !success {
		w.sendSlackAcknowledgmentFailure(slackContext, incidentID, "API call failed")
	}

	w.deleteMessage(queueName, msgID)
}

// acknowledgeIncidentAPI simulates API call to acknowledge incident
func (w *NotificationWorker) acknowledgeIncidentAPI(incidentID, userID string) bool {
	// TODO: Implement actual API call to acknowledge incident
	// For now, simulate success/failure
	log.Printf("🔄 Calling API to acknowledge incident %s by user %s", incidentID, userID)

	// Simulate API call (replace with actual implementation)
	query := `UPDATE incidents SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW() WHERE id = $2`
	_, err := w.PG.Exec(query, userID, incidentID)

	if err != nil {
		log.Printf("❌ Failed to acknowledge incident %s: %v", incidentID, err)
		return false
	}

	log.Printf("✅ Successfully acknowledged incident %s", incidentID)
	return true
}

// sendSlackAcknowledgmentSuccess sends success feedback to Slack
func (w *NotificationWorker) sendSlackAcknowledgmentSuccess(slackContext map[string]interface{}, incidentID, userName string) {
	// Queue a message to Python Slack worker to update the UI
	feedbackMsg := map[string]interface{}{
		"type":          "slack_ui_update",
		"action":        "acknowledgment_success",
		"incident_id":   incidentID,
		"user_name":     userName,
		"slack_context": slackContext,
		"timestamp":     time.Now().UTC(),
	}

	if err := w.sendSlackFeedbackMessage(feedbackMsg); err != nil {
		log.Printf("⚠️  Failed to send Slack success feedback: %v", err)
	} else {
		log.Printf("✅ Sent Slack acknowledgment success feedback for incident %s", incidentID)
	}
}

// sendSlackAcknowledgmentFailure sends failure feedback to Slack
func (w *NotificationWorker) sendSlackAcknowledgmentFailure(slackContext map[string]interface{}, incidentID, errorReason string) {
	// Queue a message to Python Slack worker to rollback the UI
	feedbackMsg := map[string]interface{}{
		"type":          "slack_ui_update",
		"action":        "acknowledgment_failure",
		"incident_id":   incidentID,
		"error_reason":  errorReason,
		"slack_context": slackContext,
		"timestamp":     time.Now().UTC(),
	}

	if err := w.sendSlackFeedbackMessage(feedbackMsg); err != nil {
		log.Printf("⚠️  Failed to send Slack failure feedback: %v", err)
	} else {
		log.Printf("✅ Sent Slack acknowledgment failure feedback for incident %s", incidentID)
	}
}

// sendSlackFeedbackMessage sends feedback message to Slack worker via PGMQ
func (w *NotificationWorker) sendSlackFeedbackMessage(feedbackMsg map[string]interface{}) error {
	msgJSON, err := json.Marshal(feedbackMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal feedback message: %v", err)
	}

	// Send to slack_feedback queue for Python worker to process
	query := `SELECT pgmq.send($1, $2)`
	_, err = w.PG.Exec(query, "slack_feedback", string(msgJSON))
	if err != nil {
		return fmt.Errorf("failed to send feedback to slack_feedback queue: %v", err)
	}

	return nil
}
