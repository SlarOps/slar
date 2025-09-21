package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"github.com/vanchonlee/slar/db"
	"google.golang.org/api/option"
)

type FCMService struct {
	PG     *sql.DB
	client *messaging.Client
}

type NotificationData struct {
	AlertID    string `json:"alert_id"`
	AlertTitle string `json:"alert_title"`
	Severity   string `json:"severity"`
	Source     string `json:"source"`
	Type       string `json:"type"` // "alert", "schedule", "reminder"
}

func NewFCMService(pg *sql.DB) (*FCMService, error) {
	// Initialize Firebase Admin SDK
	// You'll need to set GOOGLE_APPLICATION_CREDENTIALS environment variable
	// pointing to your Firebase service account key JSON file
	opt := option.WithCredentialsFile("firebase-service-account-key.json")
	app, err := firebase.NewApp(context.Background(), nil, opt)
	if err != nil {
		log.Printf("Error initializing Firebase app: %v", err)
		return &FCMService{PG: pg}, nil // Return service without FCM client
	}

	client, err := app.Messaging(context.Background())
	if err != nil {
		log.Printf("Error getting Messaging client: %v", err)
		return &FCMService{PG: pg}, nil // Return service without FCM client
	}

	return &FCMService{
		PG:     pg,
		client: client,
	}, nil
}

// SendAlertNotification sends notification to assigned user when alert is created
func (s *FCMService) SendAlertNotification(alert *db.Alert) error {
	if s.client == nil {
		log.Println("FCM client not initialized, skipping notification")
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
