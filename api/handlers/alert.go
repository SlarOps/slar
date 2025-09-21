package handlers

import (
	"net/http"

	"github.com/vanchonlee/slar/services"

	"github.com/gin-gonic/gin"
)

type AlertHandler struct {
	Service *services.AlertService
}

func NewAlertHandler(service *services.AlertService) *AlertHandler {
	return &AlertHandler{Service: service}
}

func (h *AlertHandler) ListAlerts(c *gin.Context) {
	alerts, err := h.Service.ListAlerts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	// Return with metadata for mobile app compatibility
	response := gin.H{
		"alerts": alerts,
		"total":  len(alerts),
		"status": "success",
	}

	c.JSON(http.StatusOK, response)
}

func (h *AlertHandler) CreateAlert(c *gin.Context) {
	alert, err := h.Service.CreateAlertFromRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, alert)
}

func (h *AlertHandler) GetAlert(c *gin.Context) {
	id := c.Param("id")
	alert, err := h.Service.GetAlert(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, alert)
}

func (h *AlertHandler) AckAlert(c *gin.Context) {
	id := c.Param("id")

	// Get user ID from context (set by Supabase auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Use new permission-aware ACK method
	if err := h.Service.AckAlertByUser(id, userID.(string)); err != nil {
		if err.Error() == "user does not have permission to acknowledge this alert" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.Status(http.StatusOK)
}

func (h *AlertHandler) UnackAlert(c *gin.Context) {
	id := c.Param("id")
	if err := h.Service.UnackAlert(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.Status(http.StatusOK)
}

func (h *AlertHandler) CloseAlert(c *gin.Context) {
	id := c.Param("id")
	if err := h.Service.CloseAlert(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.Status(http.StatusOK)
}
