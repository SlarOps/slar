package handlers

import (
	"net/http"
	"strconv"
	"strings"

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

// UpdateFCMToken updates user's FCM token
func (h *UserHandler) UpdateFCMToken(c *gin.Context) {
	// Get user ID from context (set by Supabase auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var request struct {
		FCMToken string `json:"fcm_token" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// Update FCM token in database
	if err := h.Service.UpdateFCMToken(userID.(string), request.FCMToken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update FCM token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "FCM token updated successfully",
		"status":  "success",
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
