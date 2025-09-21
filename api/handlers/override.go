package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type OverrideHandler struct {
	OverrideService *services.OverrideService
}

func NewOverrideHandler(overrideService *services.OverrideService) *OverrideHandler {
	return &OverrideHandler{
		OverrideService: overrideService,
	}
}

// CreateOverride creates a new schedule override
func (h *OverrideHandler) CreateOverride(c *gin.Context) {
	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req db.CreateScheduleOverrideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	override, err := h.OverrideService.CreateOverride(req, userID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, override)
}

// ListOverrides returns all overrides for a group
func (h *OverrideHandler) ListOverrides(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	overrides, err := h.OverrideService.ListOverrides(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"overrides": overrides})
}

// DeleteOverride deactivates an override
func (h *OverrideHandler) DeleteOverride(c *gin.Context) {
	groupID := c.Param("id")
	overrideID := c.Param("overrideId")

	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}
	if overrideID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Override ID is required"})
		return
	}

	err := h.OverrideService.DeleteOverride(overrideID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Override deleted successfully"})
}
