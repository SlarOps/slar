package handlers

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type APIKeyHandler struct {
	APIKeyService *services.APIKeyService
	AlertService  *services.AlertService
	UserService   *services.UserService
}

func NewAPIKeyHandler(apiKeyService *services.APIKeyService, alertService *services.AlertService, userService *services.UserService) *APIKeyHandler {
	return &APIKeyHandler{
		APIKeyService: apiKeyService,
		AlertService:  alertService,
		UserService:   userService,
	}
}

// CreateAPIKey creates a new API key for the authenticated user
func (h *APIKeyHandler) CreateAPIKey(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req db.CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := h.APIKeyService.CreateAPIKey(userID.(string), &req)
	if err != nil {
		log.Printf("Error creating API key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, response)
}

// ListAPIKeys lists all API keys for the authenticated user
func (h *APIKeyHandler) ListAPIKeys(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	keys, err := h.APIKeyService.ListAPIKeys(userID.(string))
	if err != nil {
		log.Printf("Error listing API keys: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"api_keys": keys})
}

// GetAPIKey gets a specific API key by ID
func (h *APIKeyHandler) GetAPIKey(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key ID is required"})
		return
	}

	key, err := h.APIKeyService.GetAPIKey(keyID, userID.(string))
	if err != nil {
		if err.Error() == "API key not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		log.Printf("Error getting API key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, key)
}

// UpdateAPIKey updates an API key
func (h *APIKeyHandler) UpdateAPIKey(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key ID is required"})
		return
	}

	var req db.UpdateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := h.APIKeyService.UpdateAPIKey(keyID, userID.(string), &req)
	if err != nil {
		if err.Error() == "API key not found or no permission to update" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		log.Printf("Error updating API key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "API key updated successfully"})
}

// DeleteAPIKey deletes an API key
func (h *APIKeyHandler) DeleteAPIKey(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key ID is required"})
		return
	}

	err := h.APIKeyService.DeleteAPIKey(keyID, userID.(string))
	if err != nil {
		if err.Error() == "API key not found or no permission to delete" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		log.Printf("Error deleting API key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "API key deleted successfully"})
}

// RegenerateAPIKey generates a new API key for an existing key ID
func (h *APIKeyHandler) RegenerateAPIKey(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key ID is required"})
		return
	}

	response, err := h.APIKeyService.RegenerateAPIKey(keyID, userID.(string))
	if err != nil {
		if err.Error() == "API key not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		log.Printf("Error regenerating API key: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

// GetAPIKeyStats gets usage statistics for API keys
func (h *APIKeyHandler) GetAPIKeyStats(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	stats, err := h.APIKeyService.GetAPIKeyStats(userID.(string))
	if err != nil {
		log.Printf("Error getting API key stats: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

// WebhookAlert handles incoming webhook alerts with API key authentication
func (h *APIKeyHandler) WebhookAlert(c *gin.Context) {
	startTime := time.Now()

	// Get API key from context (set by middleware)
	apiKeyInterface, exists := c.Get("api_key")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "API key required"})
		return
	}

	apiKey := apiKeyInterface.(*db.APIKey)

	// Parse request
	var req db.WebhookAlertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logAPIKeyUsage(apiKey.ID, c, http.StatusBadRequest, time.Since(startTime), "", "", "", err.Error())
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Create alert
	alert := &db.Alert{
		Title:       req.Title,
		Description: req.Description,
		Severity:    req.Severity,
		Source:      "api_webhook",
		Status:      "open",
		APIKeyID:    apiKey.ID, // Track API key
	}

	// Smart assignment logic: On-call user first, fallback to API key owner
	onCallUser, err := h.UserService.GetCurrentOnCallUser()
	if err != nil {
		log.Printf("Warning: Could not get on-call user: %v", err)
		// Fallback: Assign to API key owner (Lead/Team responsible)
		alert.AssignedTo = apiKey.UserID
		now := time.Now()
		alert.AssignedAt = &now
		log.Printf("Alert assigned to API key owner: %s (reason: no on-call user)", apiKey.UserID)
	} else {
		alert.AssignedTo = onCallUser.ID
		now := time.Now()
		alert.AssignedAt = &now
		log.Printf("Alert assigned to on-call user: %s", onCallUser.ID)
	}

	// Create the alert
	createdAlert, err := h.AlertService.CreateAlert(alert)
	if err != nil {
		h.logAPIKeyUsage(apiKey.ID, c, http.StatusInternalServerError, time.Since(startTime), "", req.Title, req.Severity, err.Error())
		log.Printf("Error creating alert: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create alert"})
		return
	}

	// Update API key usage counters
	go func() {
		if err := h.APIKeyService.UpdateLastUsed(apiKey.ID); err != nil {
			log.Printf("Error updating API key last used: %v", err)
		}
		if err := h.APIKeyService.IncrementRateLimit(apiKey.ID); err != nil {
			log.Printf("Error incrementing rate limit: %v", err)
		}
	}()

	// Log successful usage
	h.logAPIKeyUsage(apiKey.ID, c, http.StatusCreated, time.Since(startTime), createdAlert.ID, req.Title, req.Severity, "")

	// Prepare response
	response := &db.WebhookAlertResponse{
		AlertID: createdAlert.ID,
		Status:  "created",
		Message: "Alert created successfully",
	}

	if createdAlert.AssignedTo != "" {
		response.AssignedTo = createdAlert.AssignedTo
	}

	c.JSON(http.StatusCreated, response)
}

// API Key Authentication Middleware
func (h *APIKeyHandler) APIKeyAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		startTime := time.Now()

		// Extract API key from query parameter
		apiKeyValue := c.Query("api_key")
		if apiKeyValue == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "api_key_required",
				"message": "API key is required in query parameter 'apikey'",
			})
			c.Abort()
			return
		}

		// Validate API key
		apiKey, err := h.APIKeyService.ValidateAPIKey(apiKeyValue)
		if err != nil {
			// Log failed authentication attempt
			h.logFailedAuth(apiKeyValue, c, err.Error())

			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_api_key",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		// Check permissions for the specific endpoint
		endpoint := c.FullPath()
		if !h.hasRequiredPermission(apiKey, endpoint) {
			h.logAPIKeyUsage(apiKey.ID, c, http.StatusForbidden, time.Since(startTime), "", "", "", "insufficient permissions")

			c.JSON(http.StatusForbidden, gin.H{
				"error":   "insufficient_permissions",
				"message": "API key does not have required permissions for this endpoint",
			})
			c.Abort()
			return
		}

		// Check rate limits
		if err := h.APIKeyService.CheckRateLimit(apiKey.ID, apiKey); err != nil {
			h.logAPIKeyUsage(apiKey.ID, c, http.StatusTooManyRequests, time.Since(startTime), "", "", "", err.Error())

			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":   "rate_limit_exceeded",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		// Set context values
		c.Set("api_key", apiKey)
		c.Set("user_id", apiKey.UserID)
		c.Set("auth_method", "api_key")

		c.Next()
	}
}

// Helper methods

func (h *APIKeyHandler) hasRequiredPermission(apiKey *db.APIKey, endpoint string) bool {
	// Map endpoints to required permissions
	endpointPermissions := map[string]db.Permission{
		"/webhooks/alert":        db.PermissionCreateAlerts,
		"/webhooks/alertmanager": db.PermissionCreateAlerts,
		"/api/alerts":            db.PermissionReadAlerts,
		"/api/oncall":            db.PermissionManageOnCall,
		"/api/dashboard":         db.PermissionViewDashboard,
		"/api/services":          db.PermissionManageServices,
	}

	requiredPermission, exists := endpointPermissions[endpoint]
	if !exists {
		// Default to create_alerts for webhook endpoints
		requiredPermission = db.PermissionCreateAlerts
	}

	return h.APIKeyService.HasPermission(apiKey, requiredPermission)
}

func (h *APIKeyHandler) logAPIKeyUsage(apiKeyID string, c *gin.Context, status int, duration time.Duration, alertID, alertTitle, alertSeverity, errorMessage string) {
	// Get request size
	requestSize := 0
	if c.Request.ContentLength > 0 {
		requestSize = int(c.Request.ContentLength)
	}

	// Create usage log
	usageLog := &db.APIKeyUsageLog{
		APIKeyID:       apiKeyID,
		Endpoint:       c.FullPath(),
		Method:         c.Request.Method,
		IPAddress:      c.ClientIP(),
		UserAgent:      c.GetHeader("User-Agent"),
		RequestSize:    requestSize,
		ResponseStatus: status,
		ResponseTimeMs: int(duration.Milliseconds()),
		AlertID:        alertID,
		AlertTitle:     alertTitle,
		AlertSeverity:  alertSeverity,
		RequestID:      c.GetHeader("X-Request-ID"),
		ErrorMessage:   errorMessage,
	}

	// Log usage asynchronously
	go func() {
		if err := h.APIKeyService.LogUsage(usageLog); err != nil {
			log.Printf("Error logging API key usage: %v", err)
		}
	}()
}

func (h *APIKeyHandler) logFailedAuth(apiKey string, c *gin.Context, errorMessage string) {
	log.Printf("Failed API key authentication: key=%s, ip=%s, endpoint=%s, error=%s",
		h.maskAPIKey(apiKey), c.ClientIP(), c.FullPath(), errorMessage)
}

func (h *APIKeyHandler) maskAPIKey(apiKey string) string {
	if len(apiKey) <= 8 {
		return "***"
	}
	return apiKey[:4] + "***" + apiKey[len(apiKey)-4:]
}

// GetAPIKeyUsageLogs gets usage logs for a specific API key
func (h *APIKeyHandler) GetAPIKeyUsageLogs(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key ID is required"})
		return
	}

	// Verify user owns this API key
	_, err := h.APIKeyService.GetAPIKey(keyID, userID.(string))
	if err != nil {
		if err.Error() == "API key not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Parse query parameters
	limitStr := c.DefaultQuery("limit", "100")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 1000 {
		limit = 100
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	// Get usage logs (this would need to be implemented in APIKeyService)
	// For now, return a placeholder response
	c.JSON(http.StatusOK, gin.H{
		"logs":    []interface{}{},
		"limit":   limit,
		"offset":  offset,
		"total":   0,
		"message": "Usage logs endpoint - implementation pending",
	})
}
