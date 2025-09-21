package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type RotationHandler struct {
	RotationService *services.RotationService
}

func NewRotationHandler(rotationService *services.RotationService) *RotationHandler {
	return &RotationHandler{
		RotationService: rotationService,
	}
}

// CreateRotationCycle creates a new automatic rotation cycle
func (h *RotationHandler) CreateRotationCycle(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req db.CreateRotationCycleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from middleware
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Validate rotation type
	validTypes := map[string]bool{"daily": true, "weekly": true, "custom": true}
	if !validTypes[req.RotationType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid rotation type. Must be daily, weekly, or custom"})
		return
	}

	// Create rotation cycle
	response, err := h.RotationService.CreateRotationCycle(groupID, req, userID.(string))
	if err != nil {
		// Log the actual error for debugging
		fmt.Printf("🐛 DEBUG - Rotation cycle creation error: %v\n", err)

		// Check if it's a "table doesn't exist" error (migration not applied)
		errorMsg := strings.ToLower(err.Error())
		if (strings.Contains(errorMsg, "relation") &&
			strings.Contains(errorMsg, "rotation_cycles") &&
			strings.Contains(errorMsg, "does not exist")) ||
			(strings.Contains(errorMsg, "table") &&
				strings.Contains(errorMsg, "rotation_cycles") &&
				strings.Contains(errorMsg, "does not exist")) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":       "Rotation cycles feature not available. Please apply database migrations first.",
				"hint":        "Run ./mg.sh in the api directory to apply migrations",
				"debug_error": err.Error(), // Include actual error for debugging
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": err.Error(),
			"debug": "Unexpected error in rotation cycle creation",
		})
		return
	}

	c.JSON(http.StatusCreated, response)
}

// GetGroupRotationCycles returns all rotation cycles for a group
func (h *RotationHandler) GetGroupRotationCycles(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	cycles, err := h.RotationService.GetGroupRotationCycles(groupID)
	if err != nil {
		// Check if it's a "table doesn't exist" error (migration not applied)
		if strings.Contains(strings.ToLower(err.Error()), "relation") &&
			strings.Contains(strings.ToLower(err.Error()), "rotation_cycles") &&
			strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			// Return empty result instead of error if table doesn't exist
			c.JSON(http.StatusOK, gin.H{
				"rotation_cycles": []interface{}{},
				"total":           0,
				"message":         "Rotation cycles feature not available (migration required)",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"rotation_cycles": cycles,
		"total":           len(cycles),
	})
}

// GetRotationCycle returns a specific rotation cycle with members
func (h *RotationHandler) GetRotationCycle(c *gin.Context) {
	rotationCycleID := c.Param("rotationId")
	if rotationCycleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rotation cycle ID is required"})
		return
	}

	cycle, err := h.RotationService.GetRotationCycleWithMembers(rotationCycleID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rotation cycle not found"})
		return
	}

	c.JSON(http.StatusOK, cycle)
}

// GetRotationPreview returns preview of rotation schedule
func (h *RotationHandler) GetRotationPreview(c *gin.Context) {
	rotationCycleID := c.Param("rotationId")
	if rotationCycleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rotation cycle ID is required"})
		return
	}

	// Get weeks parameter (default 4)
	weeks := 4
	if weeksStr := c.Query("weeks"); weeksStr != "" {
		if w, err := c.GetQuery("weeks"); err == false {
			_ = w // weeks query exists, use default
		}
	}

	preview, err := h.RotationService.GetRotationPreview(rotationCycleID, weeks)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"preview_weeks":     preview,
		"rotation_cycle_id": rotationCycleID,
	})
}

// GetCurrentRotationMember returns currently on-call member for rotation
func (h *RotationHandler) GetCurrentRotationMember(c *gin.Context) {
	rotationCycleID := c.Param("rotationId")
	if rotationCycleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rotation cycle ID is required"})
		return
	}

	schedule, err := h.RotationService.GetCurrentRotationMember(rotationCycleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if schedule == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No one currently on-call for this rotation"})
		return
	}

	c.JSON(http.StatusOK, schedule)
}

// CreateScheduleOverride creates an override for existing schedule
func (h *RotationHandler) CreateScheduleOverride(c *gin.Context) {
	var req db.CreateScheduleOverrideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from middleware
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	overrideID, err := h.RotationService.CreateScheduleOverride(req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"override_id": overrideID,
		"message":     "Schedule override created successfully",
	})
}

// DeactivateRotationCycle deactivates a rotation cycle
func (h *RotationHandler) DeactivateRotationCycle(c *gin.Context) {
	rotationCycleID := c.Param("rotationId")
	if rotationCycleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rotation cycle ID is required"})
		return
	}

	err := h.RotationService.DeactivateRotationCycle(rotationCycleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":           "Rotation cycle deactivated successfully",
		"rotation_cycle_id": rotationCycleID,
	})
}

// GetScheduleForOverride returns schedule details for creating override
func (h *RotationHandler) GetScheduleForOverride(c *gin.Context) {
	scheduleID := c.Param("scheduleId")
	if scheduleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Schedule ID is required"})
		return
	}

	// This could be implemented to get schedule details
	// For now, return basic info needed for override creation
	c.JSON(http.StatusOK, gin.H{
		"schedule_id": scheduleID,
		"message":     "Use this schedule ID for override creation",
	})
}
