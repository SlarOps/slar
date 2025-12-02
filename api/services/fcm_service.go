package services

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"github.com/vanchonlee/slar/db"
	"google.golang.org/api/option"
)

type FCMService struct {
	PG     *sql.DB
	client *messaging.Client
	// Cloud relay configuration
	cloudURL   string
	cloudToken string
	instanceID string
}

type NotificationData struct {
	AlertID    string `json:"alert_id"`
	AlertTitle string `json:"alert_title"`
	Severity   string `json:"severity"`
	Source     string `json:"source"`
	Type       string `json:"type"` // "alert", "schedule", "reminder"
}

func NewFCMService(pg *sql.DB) (*FCMService, error) {
	// Read cloud relay configuration
	cloudURL := os.Getenv("SLAR_CLOUD_URL")
	cloudToken := os.Getenv("SLAR_CLOUD_TOKEN")
	instanceID := os.Getenv("SLAR_INSTANCE_ID")

	service := &FCMService{
		PG:         pg,
		cloudURL:   cloudURL,
		cloudToken: cloudToken,
		instanceID: instanceID,
	}

	// Log cloud relay status
	if cloudURL != "" && cloudToken != "" && instanceID != "" {
		log.Printf("FCM Service: Cloud relay configured (URL: %s, Instance: %s)", cloudURL, instanceID)
	} else {
		log.Println("FCM Service: Cloud relay not configured, will use direct FCM if available")
	}

	// Initialize Firebase Admin SDK (optional - used as fallback)
	// You'll need to set GOOGLE_APPLICATION_CREDENTIALS environment variable
	// pointing to your Firebase service account key JSON file
	opt := option.WithCredentialsFile("firebase-service-account-key.json")
	app, err := firebase.NewApp(context.Background(), nil, opt)
	if err != nil {
		log.Printf("Firebase app not initialized: %v (will use cloud relay if configured)", err)
		return service, nil
	}

	client, err := app.Messaging(context.Background())
	if err != nil {
		log.Printf("Firebase messaging client not initialized: %v (will use cloud relay if configured)", err)
		return service, nil
	}

	service.client = client
	log.Println("FCM Service: Direct Firebase messaging initialized")

	return service, nil
}

// IsCloudRelayEnabled returns true if cloud relay is configured
func (s *FCMService) IsCloudRelayEnabled() bool {
	return s.cloudURL != "" && s.cloudToken != "" && s.instanceID != ""
}

// SendAlertNotification sends notification to assigned user when alert is created
func (s *FCMService) SendAlertNotification(alert *db.Alert) error {
	// Check if cloud relay is enabled - prefer cloud relay over direct FCM
	if s.IsCloudRelayEnabled() {
		return s.sendAlertViaCloudRelay(alert)
	}

	// Fallback to direct FCM
	if s.client == nil {
		log.Println("FCM client not initialized and cloud relay not configured, skipping notification")
		return nil
	}

	// Get user's FCM token
	var fcmToken string
	var userName string
	err := s.PG.QueryRow(
		"SELECT fcm_token, name FROM users WHERE id = $1 AND fcm_token IS NOT NULL AND fcm_token != ''",
		alert.AssignedTo,
	).Scan(&fcmToken, &userName)

	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("No FCM token found for user %s", alert.AssignedTo)
			return nil
		}
		return fmt.Errorf("error fetching user FCM token: %v", err)
	}

	// Prepare notification data
	notificationData := NotificationData{
		AlertID:    alert.ID,
		AlertTitle: alert.Title,
		Severity:   alert.Severity,
		Source:     alert.Source,
		Type:       "alert",
	}

	dataMap := make(map[string]string)
	dataBytes, _ := json.Marshal(notificationData)
	json.Unmarshal(dataBytes, &dataMap)

	// Create FCM message
	message := &messaging.Message{
		Token: fcmToken,
		Notification: &messaging.Notification{
			Title: fmt.Sprintf("🚨 New Alert: %s", alert.Severity),
			Body:  fmt.Sprintf("%s\nSource: %s", alert.Title, alert.Source),
		},
		Data: dataMap,
		Android: &messaging.AndroidConfig{
			Priority: "high",
			Notification: &messaging.AndroidNotification{
				Icon:         "ic_notification",
				Color:        getColorBySeverity(alert.Severity),
				Sound:        "default",
				ChannelID:    "high_importance_channel",
				Priority:     messaging.PriorityHigh,
				DefaultSound: true,
			},
		},
		APNS: &messaging.APNSConfig{
			Payload: &messaging.APNSPayload{
				Aps: &messaging.Aps{
					Alert: &messaging.ApsAlert{
						Title: fmt.Sprintf("🚨 New Alert: %s", alert.Severity),
						Body:  fmt.Sprintf("%s\nSource: %s", alert.Title, alert.Source),
					},
					Badge: intPtr(1),
					Sound: "default",
					CustomData: map[string]interface{}{
						"alert_id": alert.ID,
						"type":     "alert",
					},
				},
			},
		},
	}

	// Send message
	response, err := s.client.Send(context.Background(), message)
	if err != nil {
		log.Printf("Error sending FCM message to user %s: %v", userName, err)
		return err
	}

	log.Printf("Successfully sent FCM notification to %s (token: %s...): %s",
		userName, fcmToken[:10], response)

	return nil
}

// SendNotificationToOnCallUsers sends notification to all currently on-call users
func (s *FCMService) SendNotificationToOnCallUsers(alert *db.Alert) error {
	if s.client == nil {
		log.Println("FCM client not initialized, skipping notification")
		return nil
	}

	// Get all on-call users with FCM tokens
	query := `
		SELECT DISTINCT u.id, u.name, u.fcm_token 
		FROM users u 
		        JOIN shifts ocs ON u.id = ocs.user_id 
		WHERE ocs.is_active = true 
		AND NOW() BETWEEN ocs.start_time AND ocs.end_time
		AND u.fcm_token IS NOT NULL 
		AND u.fcm_token != ''
		AND u.is_active = true
	`

	rows, err := s.PG.Query(query)
	if err != nil {
		return fmt.Errorf("error fetching on-call users: %v", err)
	}
	defer rows.Close()

	var tokens []string
	var userNames []string

	for rows.Next() {
		var userID, userName, fcmToken string
		if err := rows.Scan(&userID, &userName, &fcmToken); err != nil {
			continue
		}
		tokens = append(tokens, fcmToken)
		userNames = append(userNames, userName)
	}

	if len(tokens) == 0 {
		log.Println("No on-call users with FCM tokens found")
		return nil
	}

	// Prepare notification data
	notificationData := NotificationData{
		AlertID:    alert.ID,
		AlertTitle: alert.Title,
		Severity:   alert.Severity,
		Source:     alert.Source,
		Type:       "alert",
	}

	dataMap := make(map[string]string)
	dataBytes, _ := json.Marshal(notificationData)
	json.Unmarshal(dataBytes, &dataMap)

	// Create multicast message
	message := &messaging.MulticastMessage{
		Tokens: tokens,
		Notification: &messaging.Notification{
			Title: fmt.Sprintf("🚨 New Alert: %s", alert.Severity),
			Body:  fmt.Sprintf("%s\nSource: %s", alert.Title, alert.Source),
		},
		Data: dataMap,
		Android: &messaging.AndroidConfig{
			Priority: "high",
			Notification: &messaging.AndroidNotification{
				Icon:         "ic_notification",
				Color:        getColorBySeverity(alert.Severity),
				Sound:        "default",
				ChannelID:    "high_importance_channel",
				Priority:     messaging.PriorityHigh,
				DefaultSound: true,
			},
		},
	}

	// Send multicast message
	response, err := s.client.SendMulticast(context.Background(), message)
	if err != nil {
		log.Printf("Error sending multicast FCM message: %v", err)
		return err
	}

	log.Printf("Successfully sent FCM notifications to %d users: %v (Success: %d, Failed: %d)",
		len(userNames), userNames, response.SuccessCount, response.FailureCount)

	// Log any failures
	for i, resp := range response.Responses {
		if !resp.Success {
			log.Printf("Failed to send to %s: %v", userNames[i], resp.Error)
		}
	}

	return nil
}

// UpdateUserFCMToken updates user's FCM token
func (s *FCMService) UpdateUserFCMToken(userID, fcmToken string) error {
	_, err := s.PG.Exec(
		"UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2",
		fcmToken, userID,
	)
	if err != nil {
		return fmt.Errorf("error updating FCM token: %v", err)
	}

	log.Printf("Updated FCM token for user %s", userID)
	return nil
}

// ============================================================================
// CLOUD RELAY METHODS
// ============================================================================

// CloudRelayNotification represents the notification payload for cloud relay
type CloudRelayNotification struct {
	InstanceID   string                 `json:"instance_id"`
	UserID       string                 `json:"user_id"`
	Notification CloudRelayNotifPayload `json:"notification"`
}

// CloudRelayNotifPayload represents the notification content
type CloudRelayNotifPayload struct {
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Priority string            `json:"priority"`
	Data     map[string]string `json:"data,omitempty"`
}

// CloudRelayResponse represents the response from cloud relay
type CloudRelayResponse struct {
	NotificationID string `json:"notification_id"`
	Status         string `json:"status"`
	DevicesCount   int    `json:"devices_count"`
	Error          string `json:"error,omitempty"`
}

// sendAlertViaCloudRelay sends alert notification via cloud relay (noti-gw)
func (s *FCMService) sendAlertViaCloudRelay(alert *db.Alert) error {
	log.Printf("Sending alert notification via cloud relay for user %s", alert.AssignedTo)

	payload := CloudRelayNotification{
		InstanceID: s.instanceID,
		UserID:     alert.AssignedTo,
		Notification: CloudRelayNotifPayload{
			Title:    fmt.Sprintf("🚨 %s Alert", alert.Severity),
			Body:     fmt.Sprintf("%s\nSource: %s", alert.Title, alert.Source),
			Priority: getPriorityBySeverity(alert.Severity),
			Data: map[string]string{
				"alert_id":    alert.ID,
				"alert_title": alert.Title,
				"severity":    alert.Severity,
				"source":      alert.Source,
				"type":        "alert",
			},
		},
	}

	return s.sendToCloudRelay(payload)
}

// sendToCloudRelay sends notification payload to cloud relay
func (s *FCMService) sendToCloudRelay(payload CloudRelayNotification) error {
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal cloud relay payload: %v", err)
	}

	url := s.cloudURL + "/api/gateway/notifications/send"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create cloud relay request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+s.cloudToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send to cloud relay: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("cloud relay error (status %d): %s", resp.StatusCode, string(body))
	}

	var relayResp CloudRelayResponse
	if err := json.Unmarshal(body, &relayResp); err != nil {
		log.Printf("Warning: Could not parse cloud relay response: %v", err)
	} else {
		log.Printf("Cloud relay notification sent: ID=%s, Status=%s, Devices=%d",
			relayResp.NotificationID, relayResp.Status, relayResp.DevicesCount)
	}

	return nil
}

// SendNotificationToUserViaRelay sends a custom notification to a user via cloud relay
func (s *FCMService) SendNotificationToUserViaRelay(userID, title, body string, data map[string]string) error {
	if !s.IsCloudRelayEnabled() {
		return fmt.Errorf("cloud relay not configured")
	}

	payload := CloudRelayNotification{
		InstanceID: s.instanceID,
		UserID:     userID,
		Notification: CloudRelayNotifPayload{
			Title:    title,
			Body:     body,
			Priority: "high",
			Data:     data,
		},
	}

	return s.sendToCloudRelay(payload)
}

func getPriorityBySeverity(severity string) string {
	switch severity {
	case "critical", "high":
		return "high"
	default:
		return "normal"
	}
}

// Helper functions
func getColorBySeverity(severity string) string {
	switch severity {
	case "critical":
		return "#FF0000" // Red
	case "high":
		return "#FF8C00" // Orange
	case "medium":
		return "#FFD700" // Yellow
	case "low":
		return "#32CD32" // Green
	default:
		return "#2196F3" // Blue
	}
}

func intPtr(i int) *int {
	return &i
}
