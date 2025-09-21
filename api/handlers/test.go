package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/models"
)

type TestHandler struct {
	AlertManagerHandler *AlertManagerHandler
}

func NewTestHandler(alertManagerHandler *AlertManagerHandler) *TestHandler {
	return &TestHandler{
		AlertManagerHandler: alertManagerHandler,
	}
}

// TestAlertManagerWebhook sends a test AlertManager webhook to test FCM notifications
func (h *TestHandler) TestAlertManagerWebhook(c *gin.Context) {
	// Create a test AlertManager webhook payload
	webhook := models.AlertManagerWebhook{
		Receiver: "slar-webhook",
		Status:   "firing",
		Alerts: []models.AlertManagerAlert{
			{
				Status:      "firing",
				Fingerprint: "test-alert-fcm-" + time.Now().Format("20060102150405"),
				Labels: map[string]string{
					"alertname": "Test FCM Alert",
					"severity":  "critical",
					"instance":  "test-server:9090",
					"job":       "test-job",
				},
				Annotations: map[string]string{
					"summary":     "This is a test alert to verify FCM notifications",
					"description": "Testing FCM notification system for SLAR app",
				},
				StartsAt:     time.Now(),
				EndsAt:       time.Time{},
				GeneratorURL: "http://prometheus:9090/graph",
			},
		},
		GroupLabels: map[string]string{
			"alertname": "Test FCM Alert",
		},
		CommonLabels: map[string]string{
			"alertname": "Test FCM Alert",
			"severity":  "critical",
		},
		CommonAnnotations: map[string]string{
			"summary": "This is a test alert to verify FCM notifications",
		},
		ExternalURL: "http://alertmanager:9093",
		Version:     "4",
		GroupKey:    "test-group-key",
	}

	// Process the webhook using AlertManagerHandler
	// We'll simulate the webhook processing by calling the service directly
	err := h.AlertManagerHandler.Service.ProcessWebhook(&webhook)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to process test webhook",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "Test webhook processed successfully",
		"alert_created":    webhook.Alerts[0].Labels["alertname"],
		"severity":         webhook.Alerts[0].Labels["severity"],
		"fcm_notification": "should be triggered for on-call users",
		"webhook_payload":  webhook,
	})
}

// TestResolvedAlert sends a resolved alert webhook
func (h *TestHandler) TestResolvedAlert(c *gin.Context) {
	// Create a test resolved alert
	webhook := models.AlertManagerWebhook{
		Receiver: "slar-webhook",
		Status:   "resolved",
		Alerts: []models.AlertManagerAlert{
			{
				Status:      "resolved",
				Fingerprint: "test-resolved-" + time.Now().Format("20060102150405"),
				Labels: map[string]string{
					"alertname": "Test Resolved Alert",
					"severity":  "warning",
					"instance":  "test-server:9090",
				},
				Annotations: map[string]string{
					"summary": "Test resolved alert",
				},
				StartsAt: time.Now().Add(-1 * time.Hour),
				EndsAt:   time.Now(),
			},
		},
	}

	err := h.AlertManagerHandler.Service.ProcessWebhook(&webhook)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to process resolved test webhook",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Test resolved webhook processed successfully",
		"alert_name": webhook.Alerts[0].Labels["alertname"],
		"note":       "This resolved alert will be SKIPPED since it never fired (new logic)",
		"behavior":   "Resolved alerts without prior firing alerts are now ignored for cleaner operation",
	})
}
