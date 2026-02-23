package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

type NotificationHandler struct {
	SlackService *services.SlackService
}

func NewNotificationHandler(slackService *services.SlackService) *NotificationHandler {
	return &NotificationHandler{
		SlackService: slackService,
	}
}

// NotificationConfigRequest represents the request structure for updating notification config
type NotificationConfigRequest struct {
	SlackUserID    string `json:"slack_user_id"`
	SlackChannelID string `json:"slack_channel_id"`
	SlackEnabled   bool   `json:"slack_enabled"`
	EmailEnabled   bool   `json:"email_enabled"`
	PushEnabled    bool   `json:"push_enabled"`
	Timezone       string `json:"timezone"`
}

// NotificationConfigResponse represents the response structure for notification config
type NotificationConfigResponse struct {
	UserID         string `json:"user_id"`
	SlackUserID    string `json:"slack_user_id"`
	SlackChannelID string `json:"slack_channel_id"`
	SlackEnabled   bool   `json:"slack_enabled"`
	EmailEnabled   bool   `json:"email_enabled"`
	PushEnabled    bool   `json:"push_enabled"`
	Timezone       string `json:"timezone"`
	Message        string `json:"message,omitempty"`
}

// GetNotificationConfig gets user's notification configuration
// GET /api/users/me/notifications/config
func (h *NotificationHandler) GetNotificationConfig(c *gin.Context) {
	// Get user_id from context (set by auth middleware, already converted to UUID)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userIDStr := userID.(string)

	config, err := h.SlackService.GetUserNotificationConfig(userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get notification config", "details": err.Error()})
		return
	}

	response := NotificationConfigResponse{
		UserID:         config.UserID,
		SlackUserID:    config.SlackUserID,
		SlackChannelID: config.SlackChannelID,
		SlackEnabled:   config.SlackEnabled,
		EmailEnabled:   config.EmailEnabled,
		PushEnabled:    config.PushEnabled,
		Timezone:       config.Timezone,
	}

	c.JSON(http.StatusOK, response)
}

// UpdateNotificationConfig updates user's notification configuration
// PUT /api/users/me/notifications/config
func (h *NotificationHandler) UpdateNotificationConfig(c *gin.Context) {
	// Get user_id from context (set by auth middleware, already converted to UUID)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userIDStr := userID.(string)

	var req NotificationConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	// Update notification config
	if err := h.SlackService.UpdateUserNotificationConfig(userIDStr, req.SlackUserID, req.SlackChannelID,
		req.SlackEnabled, req.EmailEnabled, req.PushEnabled, req.Timezone); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update notification config", "details": err.Error()})
		return
	}

	response := NotificationConfigResponse{
		UserID:         userIDStr,
		SlackUserID:    req.SlackUserID,
		SlackChannelID: req.SlackChannelID,
		SlackEnabled:   req.SlackEnabled,
		EmailEnabled:   req.EmailEnabled,
		PushEnabled:    req.PushEnabled,
		Timezone:       req.Timezone,
		Message:        "Notification configuration updated successfully",
	}

	c.JSON(http.StatusOK, response)
}

// TestSlackNotification sends a test Slack notification to user
// POST /api/users/me/notifications/test/slack
func (h *NotificationHandler) TestSlackNotification(c *gin.Context) {
	// Get user_id from context (set by auth middleware, already converted to UUID)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userIDStr := userID.(string)

	// Create a dummy incident for testing
	testIncidentID := "test-incident-" + userIDStr

	err := h.SlackService.SendIncidentNotification(userIDStr, testIncidentID, "test")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to send test notification",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "Test Slack notification sent successfully",
		"user_id":     userIDStr,
		"incident_id": testIncidentID,
		"type":        "test",
	})
}

// GetNotificationStats gets notification statistics for user
// GET /api/users/me/notifications/stats
func (h *NotificationHandler) GetNotificationStats(c *gin.Context) {
	// Get user_id from context (set by auth middleware, already converted to UUID)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userIDStr := userID.(string)

	// This would be implemented to return notification stats from notification_logs table
	// For now, return a placeholder response
	c.JSON(http.StatusOK, gin.H{
		"user_id":              userIDStr,
		"total_notifications":  0,
		"slack_notifications":  0,
		"email_notifications":  0,
		"failed_notifications": 0,
		"last_notification":    nil,
		"message":              "Notification stats feature coming soon",
	})
}
