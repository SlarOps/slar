package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

type DashboardHandler struct {
	UserService *services.UserService
}

func NewDashboardHandler(userService *services.UserService) *DashboardHandler {
	return &DashboardHandler{
		UserService: userService,
	}
}

func (h *DashboardHandler) GetDashboard(c *gin.Context) {
	// Get user info from context
	userEmail, _ := c.Get("user_email")
	userID, exists := c.Get("user_id")
	
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User ID not found in context",
		})
		return
	}

	userIDStr, ok := userID.(string)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Invalid user ID format",
		})
		return
	}

	// Check if user is currently on-call
	isOnCall, err := h.UserService.IsUserOnCall(userIDStr)
	if err != nil {
		// Log error but don't fail the request
		isOnCall = false
	}

	// Prepare on-call status message
	onCallStatus := ""
	if isOnCall {
		onCallStatus = "you are on-call"
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Dashboard data",
		"user_email": userEmail,
		"user_id":    userID,
		"is_on_call": isOnCall,
		"on_call_status": onCallStatus,
		"endpoints": gin.H{
			"alerts":   "/alerts",
			"api_keys": "/api-keys",
			"users":    "/users",
			"oncall":   "/oncall",
			"uptime":   "/uptime",
		},
	})
} 