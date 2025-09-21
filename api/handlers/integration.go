package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type IntegrationHandler struct {
	IntegrationService *services.IntegrationService
}

func NewIntegrationHandler(integrationService *services.IntegrationService) *IntegrationHandler {
	return &IntegrationHandler{
		IntegrationService: integrationService,
	}
}

// ===========================
// INTEGRATION ENDPOINTS
// ===========================

// CreateIntegration creates a new integration
// POST /api/integrations
func (h *IntegrationHandler) CreateIntegration(c *gin.Context) {
	var req db.CreateIntegrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	// Validate integration type
	validTypes := []string{"prometheus", "datadog", "grafana", "webhook", "aws", "custom"}
	isValidType := false
	for _, validType := range validTypes {
		if req.Type == validType {
			isValidType = true
			break
		}
	}
	if !isValidType {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid integration type", "valid_types": validTypes})
		return
	}

	// Get user from context (set by auth middleware)
	createdBy := ""
	if user, exists := c.Get("user"); exists {
		if userObj, ok := user.(db.User); ok {
			createdBy = userObj.Email
		}
	}

	integration, err := h.IntegrationService.CreateIntegration(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create integration", "details": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":     "Integration created successfully",
		"integration": integration,
	})
}

// GetIntegrations returns all integrations with optional filtering
// GET /api/integrations?type=prometheus&active_only=true
func (h *IntegrationHandler) GetIntegrations(c *gin.Context) {
	integType := c.Query("type")
	activeOnlyStr := c.Query("active_only")
	activeOnly := activeOnlyStr == "true"

	integrations, err := h.IntegrationService.GetIntegrations(integType, activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get integrations", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"integrations": integrations,
		"count":        len(integrations),
	})
}

// GetIntegration returns a specific integration by ID
// GET /api/integrations/:id
func (h *IntegrationHandler) GetIntegration(c *gin.Context) {
	integrationID := c.Param("id")
	if integrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Integration ID is required"})
		return
	}

	integration, err := h.IntegrationService.GetIntegration(integrationID)
	if err != nil {
		if err.Error() == "integration not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get integration", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"integration": integration})
}

// UpdateIntegration updates an existing integration
// PUT /api/integrations/:id
func (h *IntegrationHandler) UpdateIntegration(c *gin.Context) {
	integrationID := c.Param("id")
	if integrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Integration ID is required"})
		return
	}

	var req db.UpdateIntegrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	integration, err := h.IntegrationService.UpdateIntegration(integrationID, req)
	if err != nil {
		if err.Error() == "integration not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update integration", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "Integration updated successfully",
		"integration": integration,
	})
}

// DeleteIntegration deletes an integration
// DELETE /api/integrations/:id
func (h *IntegrationHandler) DeleteIntegration(c *gin.Context) {
	integrationID := c.Param("id")
	if integrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Integration ID is required"})
		return
	}

	err := h.IntegrationService.DeleteIntegration(integrationID)
	if err != nil {
		if err.Error() == "integration not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Integration deleted successfully"})
}

// UpdateHeartbeat updates the heartbeat for an integration
// POST /api/integrations/:id/heartbeat
func (h *IntegrationHandler) UpdateHeartbeat(c *gin.Context) {
	integrationID := c.Param("id")
	if integrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Integration ID is required"})
		return
	}

	err := h.IntegrationService.UpdateHeartbeat(integrationID)
	if err != nil {
		if err.Error() == "integration not found or inactive" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found or inactive"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update heartbeat", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Heartbeat updated successfully"})
}

// ===========================
// SERVICE INTEGRATION ENDPOINTS
// ===========================

// CreateServiceIntegration creates a new service-integration mapping
// POST /api/services/:id/integrations
func (h *IntegrationHandler) CreateServiceIntegration(c *gin.Context) {
	serviceID := c.Param("id")
	if serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service ID is required"})
		return
	}

	var req db.CreateServiceIntegrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Println("invalid request body: %w", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	// Override service ID from URL
	req.ServiceID = serviceID

	// Get user from context
	createdBy := ""
	if user, exists := c.Get("user"); exists {
		if userObj, ok := user.(db.User); ok {
			createdBy = userObj.Email
		}
	}

	serviceIntegration, err := h.IntegrationService.CreateServiceIntegration(req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create service integration", "details": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":             "Service integration created successfully",
		"service_integration": serviceIntegration,
	})
}

// GetServiceIntegrations returns all integrations for a service
// GET /api/services/:id/integrations
func (h *IntegrationHandler) GetServiceIntegrations(c *gin.Context) {
	serviceID := c.Param("id")
	if serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service ID is required"})
		return
	}

	serviceIntegrations, err := h.IntegrationService.GetServiceIntegrations(serviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get service integrations", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"service_integrations": serviceIntegrations,
		"count":                len(serviceIntegrations),
	})
}

// GetIntegrationServices returns all services for an integration
// GET /api/integrations/:id/services
func (h *IntegrationHandler) GetIntegrationServices(c *gin.Context) {
	integrationID := c.Param("id")
	if integrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Integration ID is required"})
		return
	}

	serviceIntegrations, err := h.IntegrationService.GetIntegrationServices(integrationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get integration services", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"service_integrations": serviceIntegrations,
		"count":                len(serviceIntegrations),
	})
}

// UpdateServiceIntegration updates a service-integration mapping
// PUT /api/service-integrations/:id
func (h *IntegrationHandler) UpdateServiceIntegration(c *gin.Context) {
	serviceIntegrationID := c.Param("id")
	if serviceIntegrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service integration ID is required"})
		return
	}

	var req db.UpdateServiceIntegrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body", "details": err.Error()})
		return
	}

	serviceIntegration, err := h.IntegrationService.UpdateServiceIntegration(serviceIntegrationID, req)
	if err != nil {
		if err.Error() == "service integration not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Service integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update service integration", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":             "Service integration updated successfully",
		"service_integration": serviceIntegration,
	})
}

// DeleteServiceIntegration deletes a service-integration mapping
// DELETE /api/service-integrations/:id
func (h *IntegrationHandler) DeleteServiceIntegration(c *gin.Context) {
	serviceIntegrationID := c.Param("id")
	if serviceIntegrationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service integration ID is required"})
		return
	}

	err := h.IntegrationService.DeleteServiceIntegration(serviceIntegrationID)
	if err != nil {
		if err.Error() == "service integration not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Service integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete service integration", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Service integration deleted successfully"})
}

// ===========================
// INTEGRATION TEMPLATES ENDPOINTS (Future use)
// ===========================

// GetIntegrationTemplates returns available integration templates
// GET /api/integration-templates?type=prometheus
func (h *IntegrationHandler) GetIntegrationTemplates(c *gin.Context) {
	integType := c.Query("type")

	// For now, return a simple response
	// TODO: Implement template management
	templates := []map[string]interface{}{
		{
			"type":        "prometheus",
			"name":        "Prometheus Default",
			"description": "Standard Prometheus AlertManager integration",
		},
		{
			"type":        "datadog",
			"name":        "Datadog Default",
			"description": "Standard Datadog webhook integration",
		},
		{
			"type":        "webhook",
			"name":        "Generic Webhook",
			"description": "Generic webhook integration for custom monitoring tools",
		},
	}

	// Filter by type if provided
	if integType != "" {
		var filteredTemplates []map[string]interface{}
		for _, template := range templates {
			if template["type"] == integType {
				filteredTemplates = append(filteredTemplates, template)
			}
		}
		templates = filteredTemplates
	}

	c.JSON(http.StatusOK, gin.H{
		"templates": templates,
		"count":     len(templates),
	})
}

// ===========================
// INTEGRATION HEALTH ENDPOINTS
// ===========================

// GetIntegrationHealth returns health status for all integrations
// GET /api/integrations/health
func (h *IntegrationHandler) GetIntegrationHealth(c *gin.Context) {
	integrations, err := h.IntegrationService.GetIntegrations("", true) // Active only
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get integrations", "details": err.Error()})
		return
	}

	healthSummary := map[string]int{
		"healthy":   0,
		"warning":   0,
		"unhealthy": 0,
		"unknown":   0,
	}

	var integrationHealth []map[string]interface{}
	for _, integration := range integrations {
		status := integration.HealthStatus
		if status == "" {
			status = "unknown"
		}

		healthSummary[status]++

		integrationHealth = append(integrationHealth, map[string]interface{}{
			"id":             integration.ID,
			"name":           integration.Name,
			"type":           integration.Type,
			"health_status":  status,
			"last_heartbeat": integration.LastHeartbeat,
			"services_count": integration.ServicesCount,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"health_summary":     healthSummary,
		"integration_health": integrationHealth,
		"total_integrations": len(integrations),
	})
}
