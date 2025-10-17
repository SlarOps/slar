package handlers

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type SchedulerHandler struct {
	SchedulerService          *services.SchedulerService
	OptimizedSchedulerService *services.OptimizedSchedulerService
	OnCallService             *services.OnCallService
	ServiceService            *services.ServiceService
}

func NewSchedulerHandler(schedulerService *services.SchedulerService, onCallService *services.OnCallService, serviceService *services.ServiceService) *SchedulerHandler {
	return &SchedulerHandler{
		SchedulerService:          schedulerService,
		OptimizedSchedulerService: services.NewOptimizedSchedulerService(schedulerService.PG), // Initialize optimized service
		OnCallService:             onCallService,
		ServiceService:            serviceService,
	}
}

// GetGroupSchedulerTimelines returns all scheduler timelines for a group
// GET /groups/{id}/scheduler-timelines
func (h *SchedulerHandler) GetGroupSchedulerTimelines(c *gin.Context) {
	groupID := c.Param("id")
	fmt.Printf("🚀 [API] GET /groups/%s/scheduler-timelines called\n", groupID)

	if groupID == "" {
		fmt.Printf("❌ [API] Missing group ID\n")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	fmt.Printf("🔍 [API] Calling SchedulerService.GetGroupSchedulerTimelines...\n")
	// Get scheduler timelines
	timelines, err := h.SchedulerService.GetGroupSchedulerTimelines(groupID)
	if err != nil {
		fmt.Printf("❌ [API] Error from service: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get scheduler timelines: " + err.Error()})
		return
	}

	fmt.Printf("✅ [API] Successfully got %d timelines, returning response\n", len(timelines))
	c.JSON(http.StatusOK, gin.H{
		"timelines": timelines,
		"count":     len(timelines),
	})
}

// GetEffectiveScheduleForService returns the effective schedule for a service at a given time
// GET /groups/{id}/services/{service_id}/effective-schedule?time=2024-01-15T10:00:00Z
func (h *SchedulerHandler) GetEffectiveScheduleForService(c *gin.Context) {
	groupID := c.Param("id")
	serviceID := c.Param("service_id")

	if groupID == "" || serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID and Service ID are required"})
		return
	}

	// Parse time parameter (optional, defaults to now)
	timeStr := c.Query("time")
	var checkTime time.Time
	var err error

	if timeStr != "" {
		checkTime, err = time.Parse(time.RFC3339, timeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid time format. Use RFC3339 format: " + err.Error()})
			return
		}
	} else {
		checkTime = time.Now()
	}

	// Get effective schedule
	schedule, err := h.SchedulerService.GetEffectiveScheduleForService(groupID, serviceID, checkTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get effective schedule: " + err.Error()})
		return
	}

	if schedule == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "No effective schedule found",
			"message": "No active schedule found for this service at the specified time",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"schedule":   schedule,
		"checked_at": checkTime,
		"service_id": serviceID,
		"group_id":   groupID,
	})
}

// CreateServiceSchedule creates a new service-specific schedule
// POST /groups/{id}/services/{service_id}/schedules
func (h *SchedulerHandler) CreateServiceSchedule(c *gin.Context) {
	groupID := c.Param("id")
	serviceID := c.Param("service_id")

	if groupID == "" || serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID and Service ID are required"})
		return
	}

	var req db.CreateShiftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Force service-specific settings
	req.ServiceID = &serviceID
	req.ScheduleScope = "service"

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
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

	// Create schedule
	schedule, err := h.OnCallService.CreateSchedule(groupID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create service schedule: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"schedule": schedule,
		"message":  "Service schedule created successfully",
	})
}

// CreateGroupSchedule creates a new group-wide schedule
// POST /groups/{id}/schedules (updated to support service scheduling)
func (h *SchedulerHandler) CreateGroupSchedule(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req db.CreateShiftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Println("Invalid request body: ", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Set default scope if not provided
	if req.ScheduleScope == "" {
		req.ScheduleScope = "group"
	}

	// Validate scope
	if req.ScheduleScope != "group" && req.ScheduleScope != "service" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "schedule_scope must be 'group' or 'service'"})
		return
	}

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		// DEBUG: Temporarily use a fake user ID for testing
		userID = "debug-user-id"
		log.Println("🔧 DEBUG: Using fake user ID for testing")
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

	// Create schedule
	schedule, err := h.OnCallService.CreateSchedule(groupID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create schedule: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"schedule": schedule,
		"message":  "Schedule created successfully",
	})
}

// GetGroupServices returns all services in a group
// GET /groups/{id}/services
func (h *SchedulerHandler) GetGroupServices(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	// Use ServiceService to get real services
	services, err := h.ServiceService.GetGroupServices(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get group services: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"services": services,
		"count":    len(services),
	})
}

// GetSchedulesByScope returns schedules filtered by scope (group or service)
// GET /groups/{id}/schedules?scope=group&service_id=uuid
func (h *SchedulerHandler) GetSchedulesByScope(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	scope := c.Query("scope")          // 'group' or 'service'
	serviceID := c.Query("service_id") // optional, required if scope=service

	if scope == "" {
		scope = "all" // Show all schedules
	}

	var schedules []db.Shift
	var err error

	switch scope {
	case "group":
		schedules, err = h.SchedulerService.GetSchedulesByScope(groupID, "", "group")
	case "service":
		if serviceID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "service_id is required when scope=service"})
			return
		}
		schedules, err = h.SchedulerService.GetSchedulesByScope(groupID, serviceID, "service")
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid scope. Must be 'group', 'service', or 'all'"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get schedules: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"schedules":  schedules,
		"count":      len(schedules),
		"scope":      scope,
		"service_id": serviceID,
	})
}

// CreateScheduler creates a new scheduler (team/group)
// POST /groups/{id}/schedulers
func (h *SchedulerHandler) CreateScheduler(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req db.CreateSchedulerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Create scheduler
	scheduler, err := h.SchedulerService.CreateScheduler(groupID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create scheduler: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"scheduler": scheduler,
		"message":   "Scheduler created successfully",
	})
}

// CreateSchedulerWithShifts creates a scheduler and its shifts in a single transaction
// POST /groups/{id}/schedulers/with-shifts
func (h *SchedulerHandler) CreateSchedulerWithShifts(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req struct {
		Scheduler db.CreateSchedulerRequest `json:"scheduler" binding:"required"`
		Shifts    []db.CreateShiftRequest   `json:"shifts" binding:"required,min=1"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Set default values for shifts
	for i := range req.Shifts {
		if req.Shifts[i].ShiftType == "" {
			req.Shifts[i].ShiftType = "custom"
		}
		// SchedulerID will be set by the service after creating the scheduler
	}

	// Create scheduler with shifts in transaction
	scheduler, shifts, err := h.SchedulerService.CreateSchedulerWithShifts(groupID, req.Scheduler, req.Shifts, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create scheduler with shifts: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"scheduler": scheduler,
		"shifts":    shifts,
		"message":   "Scheduler and shifts created successfully",
	})
}

// GetGroupSchedulers gets all schedulers for a group
// GET /groups/{id}/schedulers
func (h *SchedulerHandler) GetGroupSchedulers(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	schedulers, err := h.SchedulerService.GetSchedulersByGroup(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get schedulers: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"schedulers": schedulers,
		"total":      len(schedulers),
	})
}

// GetSchedulerWithShifts gets a scheduler with its shifts
// GET /groups/{id}/schedulers/{scheduler_id}
func (h *SchedulerHandler) GetSchedulerWithShifts(c *gin.Context) {
	schedulerID := c.Param("scheduler_id")
	if schedulerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Scheduler ID is required"})
		return
	}

	scheduler, err := h.SchedulerService.GetSchedulerWithShifts(schedulerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get scheduler: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"scheduler": scheduler,
	})
}

// DeleteScheduler deletes a scheduler and all its associated shifts
// DELETE /groups/{id}/schedulers/{scheduler_id}
func (h *SchedulerHandler) DeleteScheduler(c *gin.Context) {
	groupID := c.Param("id")
	schedulerID := c.Param("scheduler_id")

	log.Printf("🗑️ DeleteScheduler called - GroupID: %s, SchedulerID: %s", groupID, schedulerID)

	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	if schedulerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Scheduler ID is required"})
		return
	}

	err := h.SchedulerService.DeleteScheduler(schedulerID)
	if err != nil {
		if err.Error() == "scheduler not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Scheduler not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete scheduler: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Scheduler deleted successfully",
	})
}

// GetGroupShifts gets all shifts for a group (organized by scheduler)
// GET /groups/{id}/shifts
func (h *SchedulerHandler) GetGroupShifts(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	// Get all shifts in group with scheduler context (single efficient query)
	allShifts, err := h.SchedulerService.GetAllShiftsInGroup(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get shifts: " + err.Error()})
		return
	}

	// Count unique schedulers
	schedulerSet := make(map[string]bool)
	for _, shift := range allShifts {
		schedulerSet[shift.SchedulerID] = true
	}

	c.JSON(http.StatusOK, gin.H{
		"shifts":           allShifts,
		"total":            len(allShifts),
		"schedulers_count": len(schedulerSet),
	})
}

// ===========================
// OPTIMIZED SCHEDULER METHODS
// ===========================

// CreateSchedulerWithShiftsOptimized creates a scheduler and its shifts with performance optimizations
// POST /groups/{id}/schedulers/with-shifts-optimized
func (h *SchedulerHandler) CreateSchedulerWithShiftsOptimized(c *gin.Context) {
	startTime := time.Now()

	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req struct {
		Scheduler db.CreateSchedulerRequest `json:"scheduler" binding:"required"`
		Shifts    []db.CreateShiftRequest   `json:"shifts" binding:"required,min=1"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Validate request
	if err := h.OptimizedSchedulerService.ValidateSchedulerRequest(req.Scheduler, req.Shifts); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Validation failed: " + err.Error()})
		return
	}

	// Set default values for shifts
	for i := range req.Shifts {
		if req.Shifts[i].ShiftType == "" {
			req.Shifts[i].ShiftType = "custom"
		}
		// SchedulerID will be set by the service after creating the scheduler
	}

	// Create scheduler with shifts using optimized service
	scheduler, shifts, err := h.OptimizedSchedulerService.CreateSchedulerWithShiftsOptimized(
		groupID,
		req.Scheduler,
		req.Shifts,
		userID.(string),
	)

	if err != nil {
		log.Printf("❌ Optimized scheduler creation failed: %v", err)

		// Fallback to original service
		log.Println("🔄 Falling back to original scheduler service...")
		scheduler, shifts, err = h.SchedulerService.CreateSchedulerWithShifts(
			groupID,
			req.Scheduler,
			req.Shifts,
			userID.(string),
		)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create scheduler with shifts: " + err.Error()})
			return
		}
	}

	duration := time.Since(startTime)
	log.Printf("⚡ Scheduler creation completed in %v", duration)

	c.JSON(http.StatusCreated, gin.H{
		"scheduler": scheduler,
		"shifts":    shifts,
		"message":   "Scheduler with shifts created successfully",
		"performance": gin.H{
			"duration_ms":  duration.Milliseconds(),
			"shifts_count": len(shifts),
			"optimized":    err == nil, // true if optimized service succeeded
		},
	})
}

// GetSchedulerPerformanceStats returns performance statistics for schedulers
// GET /groups/{id}/schedulers/stats
func (h *SchedulerHandler) GetSchedulerPerformanceStats(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	stats, err := h.OptimizedSchedulerService.GetSchedulerStats(groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get scheduler stats: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"stats":    stats,
		"group_id": groupID,
	})
}

// UpdateSchedulerWithShifts updates a scheduler and its shifts
// PUT /groups/{id}/schedulers/{scheduler_id}
func (h *SchedulerHandler) UpdateSchedulerWithShifts(c *gin.Context) {
	groupID := c.Param("id")
	schedulerID := c.Param("scheduler_id")

	log.Printf("🔄 UpdateSchedulerWithShifts called - GroupID: %s, SchedulerID: %s", groupID, schedulerID)

	if groupID == "" || schedulerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID and Scheduler ID are required"})
		return
	}

	var req struct {
		Scheduler db.CreateSchedulerRequest `json:"scheduler" binding:"required"`
		Shifts    []db.CreateShiftRequest   `json:"shifts" binding:"required,min=1"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Set default values for shifts
	for i := range req.Shifts {
		if req.Shifts[i].ShiftType == "" {
			req.Shifts[i].ShiftType = "custom"
		}
		// SchedulerID will be used from the URL parameter
	}

	// Update scheduler with shifts using service
	scheduler, shifts, err := h.SchedulerService.UpdateSchedulerWithShifts(
		schedulerID,
		req.Scheduler,
		req.Shifts,
		userID.(string),
	)

	if err != nil {
		if err.Error() == "scheduler not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Scheduler not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update scheduler: " + err.Error()})
		return
	}

	log.Printf("✅ Scheduler %s updated successfully with %d shifts", schedulerID, len(shifts))

	c.JSON(http.StatusOK, gin.H{
		"scheduler": scheduler,
		"shifts":    shifts,
		"message":   "Scheduler updated successfully",
	})
}

// BenchmarkSchedulerCreation compares performance between optimized and original services
// POST /groups/{id}/schedulers/benchmark
func (h *SchedulerHandler) BenchmarkSchedulerCreation(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req struct {
		Scheduler  db.CreateSchedulerRequest `json:"scheduler" binding:"required"`
		Shifts     []db.CreateShiftRequest   `json:"shifts" binding:"required,min=1"`
		Iterations int                       `json:"iterations,omitempty"` // Default to 1
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get user ID from JWT token
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	iterations := req.Iterations
	if iterations <= 0 {
		iterations = 1
	}
	if iterations > 10 { // Limit to prevent abuse
		iterations = 10
	}

	results := gin.H{
		"iterations": iterations,
		"optimized": gin.H{
			"total_duration_ms": 0,
			"avg_duration_ms":   0,
			"success_count":     0,
		},
		"original": gin.H{
			"total_duration_ms": 0,
			"avg_duration_ms":   0,
			"success_count":     0,
		},
	}

	// Benchmark optimized service
	var optimizedTotal time.Duration
	var optimizedSuccess int

	for i := 0; i < iterations; i++ {
		// Modify scheduler name to avoid conflicts
		testReq := req.Scheduler
		testReq.Name = req.Scheduler.Name + "-optimized-" + time.Now().Format("150405") + fmt.Sprintf("-%d", i)

		start := time.Now()
		_, _, err := h.OptimizedSchedulerService.CreateSchedulerWithShiftsOptimized(
			groupID, testReq, req.Shifts, userID.(string),
		)
		duration := time.Since(start)
		optimizedTotal += duration

		if err == nil {
			optimizedSuccess++
		}
	}

	// Benchmark original service
	var originalTotal time.Duration
	var originalSuccess int

	for i := 0; i < iterations; i++ {
		// Modify scheduler name to avoid conflicts
		testReq := req.Scheduler
		testReq.Name = req.Scheduler.Name + "-original-" + time.Now().Format("150405") + fmt.Sprintf("-%d", i)

		start := time.Now()
		_, _, err := h.SchedulerService.CreateSchedulerWithShifts(
			groupID, testReq, req.Shifts, userID.(string),
		)
		duration := time.Since(start)
		originalTotal += duration

		if err == nil {
			originalSuccess++
		}
	}

	// Calculate results
	results["optimized"].(gin.H)["total_duration_ms"] = optimizedTotal.Milliseconds()
	results["optimized"].(gin.H)["avg_duration_ms"] = optimizedTotal.Milliseconds() / int64(iterations)
	results["optimized"].(gin.H)["success_count"] = optimizedSuccess

	results["original"].(gin.H)["total_duration_ms"] = originalTotal.Milliseconds()
	results["original"].(gin.H)["avg_duration_ms"] = originalTotal.Milliseconds() / int64(iterations)
	results["original"].(gin.H)["success_count"] = originalSuccess

	// Calculate improvement
	if originalTotal > 0 {
		improvement := float64(originalTotal-optimizedTotal) / float64(originalTotal) * 100
		results["improvement_percent"] = improvement
	}

	c.JSON(http.StatusOK, gin.H{
		"benchmark_results": results,
		"message":           "Benchmark completed successfully",
	})
}
