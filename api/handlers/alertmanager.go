package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/models"
	"github.com/vanchonlee/slar/services"
)

type AlertManagerHandler struct {
	Service *services.AlertManagerService
}

func NewAlertManagerHandler(service *services.AlertManagerService) *AlertManagerHandler {
	return &AlertManagerHandler{Service: service}
}

// ReceiveWebhook handles incoming AlertManager webhooks
func (h *AlertManagerHandler) ReceiveWebhook(c *gin.Context) {
	var webhook models.AlertManagerWebhook

	if err := c.ShouldBindJSON(&webhook); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload: " + err.Error()})
		return
	}

	// Process the webhook
	if err := h.Service.ProcessWebhook(&webhook); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process webhook: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "Webhook processed successfully",
		"alerts_processed": len(webhook.Alerts),
	})
}
