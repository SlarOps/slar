package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type OnCallHandler struct {
	OnCallService    *services.OnCallService
	SchedulerService *services.SchedulerService
}

func NewOnCallHandler(onCallService *services.OnCallService, schedulerService *services.SchedulerService) *OnCallHandler {
	return &OnCallHandler{
		OnCallService:    onCallService,
		SchedulerService: schedulerService,
	}
}

// GetGroupSchedules returns all schedules for a specific group
func (h *OnCallHandler) GetGroupSchedules(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	schedules, err := h.OnCallService.ListGroupSchedules(groupID)
	if err != nil {
		log.Println("Error getting group schedules:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve schedules"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"schedules": schedules,
		"total":     len(schedules),
	})
}

// GetCurrentOnCallUser returns the currently on-call user for a group
func (h *OnCallHandler) GetCurrentOnCallUser(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	currentUser, err := h.OnCallService.GetCurrentOnCallUser(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get current on-call user"})
		return
	}

	if currentUser == nil {
		c.JSON(http.StatusOK, gin.H{
			"current_oncall": nil,
			"message":        "No one is currently on-call for this group",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"current_oncall": currentUser,
	})
}

// CreateSchedule creates a new on-call schedule
func (h *OnCallHandler) CreateSchedule(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req db.CreateShiftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get or create default scheduler if SchedulerID is not provided
	if req.SchedulerID == "" {
		scheduler, err := h.SchedulerService.GetOrCreateDefaultScheduler(groupID, userID.(string))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get default scheduler: " + err.Error()})
			return
		}
		req.SchedulerID = scheduler.ID
	}

	// Set default shift type if not provided
	if req.ShiftType == "" {
		req.ShiftType = "custom"
	}

	schedule, err := h.OnCallService.CreateSchedule(groupID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, schedule)
}

// UpdateSchedule updates an existing schedule
func (h *OnCallHandler) UpdateSchedule(c *gin.Context) {
	scheduleID := c.Param("id")
	if scheduleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Schedule ID is required"})
		return
	}

	var req db.UpdateOnCallScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schedule, err := h.OnCallService.UpdateSchedule(scheduleID, req)
	if err != nil {
		if err.Error() == "schedule not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Schedule not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, schedule)
}

// DeleteSchedule deletes a schedule
func (h *OnCallHandler) DeleteSchedule(c *gin.Context) {
	scheduleID := c.Param("id")
	if scheduleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Schedule ID is required"})
		return
	}

	err := h.OnCallService.DeleteSchedule(scheduleID)
	if err != nil {
		if err.Error() == "schedule not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Schedule not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Schedule deleted successfully",
	})
}

// GetUpcomingSchedules returns upcoming schedules for a group
func (h *OnCallHandler) GetUpcomingSchedules(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	// Parse days parameter (optional, defaults to 7)
	daysStr := c.DefaultQuery("days", "7")
	days, err := strconv.Atoi(daysStr)
	if err != nil || days <= 0 {
		days = 7
	}

	schedules, err := h.OnCallService.GetUpcomingSchedules(groupID, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve upcoming schedules"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"schedules": schedules,
		"total":     len(schedules),
		"days":      days,
	})
}

// SwapSchedules handles schedule swapping requests
func (h *OnCallHandler) SwapSchedules(c *gin.Context) {
	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req db.ShiftSwapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set the current user ID from auth context if not provided
	if req.CurrentUserID == "" {
		req.CurrentUserID = userID.(string)
	}

	response, err := h.OnCallService.SwapSchedules(req, userID.(string))
	if err != nil {
		// Different status codes based on error type
		if err.Error() == "schedule not found" || err.Error() == "failed to get current schedule: schedule not found" || err.Error() == "failed to get target schedule: schedule not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err.Error() == "only group leaders can swap other people's schedules" {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		if err.Error() == "cannot swap schedules from different groups" {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

// Legacy OnCall endpoints (for backward compatibility with router)
func (h *OnCallHandler) ListOnCallSchedules(c *gin.Context) {
	// This could be used for global schedule listing or redirect to group-specific
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "Use group-specific endpoint instead",
		"message": "Please use /groups/{groupId}/schedules to get schedules for a specific group",
	})
}

func (h *OnCallHandler) CreateOnCallSchedule(c *gin.Context) {
	// This could be used for global schedule creation or redirect to group-specific
	c.JSON(http.StatusNotImplemented, gin.H{
		"error":   "Use group-specific endpoint instead",
		"message": "Please use POST /groups/{groupId}/schedules to create schedules for a specific group",
	})
}

func (h *OnCallHandler) UpdateOnCallSchedule(c *gin.Context) {
	// Redirect to the specific schedule update
	scheduleID := c.Param("id")
	c.Redirect(http.StatusMovedPermanently, "/api/schedules/"+scheduleID)
}

func (h *OnCallHandler) DeleteOnCallSchedule(c *gin.Context) {
	// Redirect to the specific schedule delete
	scheduleID := c.Param("id")
	c.Redirect(http.StatusMovedPermanently, "/api/schedules/"+scheduleID)
}
