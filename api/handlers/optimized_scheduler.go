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

type OptimizedSchedulerHandler struct {
	OptimizedSchedulerService *services.OptimizedSchedulerService
	SchedulerService          *services.SchedulerService // Fallback to original
}

func NewOptimizedSchedulerHandler(optimizedService *services.OptimizedSchedulerService, originalService *services.SchedulerService) *OptimizedSchedulerHandler {
	return &OptimizedSchedulerHandler{
		OptimizedSchedulerService: optimizedService,
		SchedulerService:          originalService,
	}
}

// CreateSchedulerWithShiftsOptimized creates a scheduler and its shifts with performance optimizations
// POST /groups/{id}/schedulers/with-shifts-optimized
func (h *OptimizedSchedulerHandler) CreateSchedulerWithShiftsOptimized(c *gin.Context) {
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
func (h *OptimizedSchedulerHandler) GetSchedulerPerformanceStats(c *gin.Context) {
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

// BenchmarkSchedulerCreation compares performance between optimized and original services
// POST /groups/{id}/schedulers/benchmark
func (h *OptimizedSchedulerHandler) BenchmarkSchedulerCreation(c *gin.Context) {
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

// HealthCheck for optimized scheduler service
// GET /schedulers/health
func (h *OptimizedSchedulerHandler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "optimized_scheduler",
		"timestamp": time.Now().UTC(),
		"version":   "1.0.0",
	})
}
