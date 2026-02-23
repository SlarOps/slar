package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

type UserHandler struct {
	Service *services.UserService
}

func NewUserHandler(service *services.UserService) *UserHandler {
	return &UserHandler{Service: service}
}

// User CRUD endpoints
func (h *UserHandler) ListUsers(c *gin.Context) {
	users, err := h.Service.ListUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, users)
}

// SearchUsers searches users by query (GitHub-style)
func (h *UserHandler) SearchUsers(c *gin.Context) {
	query := c.Query("q")
	excludeParam := c.Query("exclude")
	limitParam := c.DefaultQuery("limit", "10")

	// Parse limit
	limit := 10
	if limitParam != "" {
		if parsedLimit, err := strconv.Atoi(limitParam); err == nil && parsedLimit > 0 && parsedLimit <= 50 {
			limit = parsedLimit
		}
	}

	// Parse exclude IDs
	var excludeIDs []string
	if excludeParam != "" {
		excludeIDs = strings.Split(excludeParam, ",")
		// Clean up whitespace
		for i, id := range excludeIDs {
			excludeIDs[i] = strings.TrimSpace(id)
		}
	}

	users, err := h.Service.SearchUsers(query, excludeIDs, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Search failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"users": users,
		"query": query,
		"total": len(users),
	})
}

func (h *UserHandler) CreateUser(c *gin.Context) {
	user, err := h.Service.CreateUser(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, user)
}

func (h *UserHandler) GetUser(c *gin.Context) {
	id := c.Param("id")
	user, err := h.Service.GetUser(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	user, err := h.Service.UpdateUser(id, c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) DeleteUser(c *gin.Context) {
	id := c.Param("id")
	err := h.Service.DeleteUser(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user deleted"})
}

// On-call endpoints
func (h *UserHandler) GetCurrentOnCallUser(c *gin.Context) {
	user, err := h.Service.GetCurrentOnCallUser()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no on-call user found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) CreateOnCallSchedule(c *gin.Context) {
	schedule, err := h.Service.CreateOnCallSchedule(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, schedule)
}

func (h *UserHandler) ListOnCallSchedules(c *gin.Context) {
	schedules, err := h.Service.ListOnCallSchedules()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, schedules)
}

func (h *UserHandler) UpdateOnCallSchedule(c *gin.Context) {
	id := c.Param("id")
	schedule, err := h.Service.UpdateOnCallSchedule(id, c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, schedule)
}

func (h *UserHandler) DeleteOnCallSchedule(c *gin.Context) {
	id := c.Param("id")
	err := h.Service.DeleteOnCallSchedule(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "schedule deleted"})
}

// UpdateFCMToken updates user's FCM token and forwards to notification gateway
func (h *UserHandler) UpdateFCMToken(c *gin.Context) {
	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var request struct {
		FCMToken   string `json:"fcm_token" binding:"required"`
		Platform   string `json:"platform"`
		AppVersion string `json:"app_version"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// Update FCM token in local database
	if err := h.Service.UpdateFCMToken(userID.(string), request.FCMToken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update FCM token"})
		return
	}

	// Forward device registration to noti-gw (non-blocking for the response)
	gatewayStatus := "local_only"
	deviceID := ""

	gatewayURL := os.Getenv("SLAR_CLOUD_URL")
	gatewayToken := os.Getenv("SLAR_CLOUD_TOKEN")
	instanceID := os.Getenv("SLAR_INSTANCE_ID")

	if gatewayURL != "" && gatewayToken != "" && instanceID != "" {
		payload := map[string]interface{}{
			"instance_id": instanceID,
			"user_id":     userID.(string),
			"fcm_token":   request.FCMToken,
			"platform":    request.Platform,
			"app_version": request.AppVersion,
		}

		jsonPayload, _ := json.Marshal(payload)
		httpReq, _ := http.NewRequest("POST", gatewayURL+"/api/gateway/devices/register", bytes.NewBuffer(jsonPayload))
		httpReq.Header.Set("Authorization", "Bearer "+gatewayToken)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			fmt.Printf("Warning: Failed to forward FCM token to gateway: %v\n", err)
		} else {
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if resp.StatusCode == http.StatusOK {
				var result map[string]interface{}
				json.Unmarshal(body, &result)
				gatewayStatus = "registered"
				if id, ok := result["device_id"].(string); ok {
					deviceID = id
				}
				fmt.Printf("FCM token forwarded to gateway for user %s\n", userID)
			} else {
				fmt.Printf("Gateway registration failed: %s\n", string(body))
				gatewayStatus = "gateway_error"
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "FCM token updated successfully",
		"status":         "success",
		"gateway_status": gatewayStatus,
		"device_id":      deviceID,
	})
}

// GetFCMToken returns current user's FCM token (for debugging)
func (h *UserHandler) GetFCMToken(c *gin.Context) {
	// Get user ID from context (set by Supabase auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	user, err := h.Service.GetUser(userID.(string))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":      user.ID,
		"user_name":    user.Name,
		"fcm_token":    user.FCMToken,
		"has_token":    user.FCMToken != "",
		"token_length": len(user.FCMToken),
	})
}
