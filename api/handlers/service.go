package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type ServiceHandler struct {
	ServiceService *services.ServiceService
}

func NewServiceHandler(serviceService *services.ServiceService) *ServiceHandler {
	return &ServiceHandler{ServiceService: serviceService}
}

// CreateService creates a new service within a group
// POST /groups/{id}/services
func (h *ServiceHandler) CreateService(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

	var req db.CreateServiceRequest
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

	// Create service
	service, err := h.ServiceService.CreateService(groupID, req, userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create service: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"service": service,
		"message": "Service created successfully",
	})
}

// GetService returns a specific service by ID
// GET /services/{id}
func (h *ServiceHandler) GetService(c *gin.Context) {
	serviceID := c.Param("id")
	if serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service ID is required"})
		return
	}

	service, err := h.ServiceService.GetService(serviceID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"service": service})
}

// GetGroupServices returns all services in a group
// GET /groups/{id}/services
func (h *ServiceHandler) GetGroupServices(c *gin.Context) {
	groupID := c.Param("id")
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group ID is required"})
		return
	}

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

// UpdateService updates an existing service
// PUT /services/{id}
func (h *ServiceHandler) UpdateService(c *gin.Context) {
	serviceID := c.Param("id")
	if serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service ID is required"})
		return
	}

	var req db.UpdateServiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	service, err := h.ServiceService.UpdateService(serviceID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update service: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"service": service,
		"message": "Service updated successfully",
	})
}

// DeleteService soft deletes a service
// DELETE /services/{id}
func (h *ServiceHandler) DeleteService(c *gin.Context) {
	serviceID := c.Param("id")
	if serviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Service ID is required"})
		return
	}

	err := h.ServiceService.DeleteService(serviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete service: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Service deleted successfully"})
}

// GetServiceByRoutingKey returns a service by routing key (for alert ingestion)
// GET /services/by-routing-key/{routing_key}
func (h *ServiceHandler) GetServiceByRoutingKey(c *gin.Context) {
	routingKey := c.Param("routing_key")
	if routingKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Routing key is required"})
		return
	}

	service, err := h.ServiceService.GetServiceByRoutingKey(routingKey)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"service": service})
}

// ListAllServices returns all services across all groups (admin function)
// GET /services
func (h *ServiceHandler) ListAllServices(c *gin.Context) {
	// Parse query parameters
	isActiveStr := c.Query("is_active")
	var isActive *bool
	if isActiveStr != "" {
		val := isActiveStr == "true"
		isActive = &val
	}

	services, err := h.ServiceService.ListAllServices(isActive)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list services: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"services": services,
		"count":    len(services),
	})
}
