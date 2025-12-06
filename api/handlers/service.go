package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/authz"
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

	// =========================================================================
	// ReBAC: Auto-fill tenant context if not provided in request
	// =========================================================================
	filters := authz.GetReBACFilters(c)

	// Auto-fill organization_id from context (if not provided in request)
	if req.OrganizationID == "" {
		if orgID, ok := filters["current_org_id"].(string); ok && orgID != "" {
			req.OrganizationID = orgID
		}
	}

	// Auto-fill project_id from context (if not provided in request)
	if req.ProjectID == "" {
		if projectID, ok := filters["current_project_id"].(string); ok && projectID != "" {
			req.ProjectID = projectID
		}
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

// ListAllServices returns all services with ReBAC filtering
// GET /services
// ReBAC: Uses organization context for MANDATORY tenant isolation
func (h *ServiceHandler) ListAllServices(c *gin.Context) {
	// =========================================================================
	// ReBAC: Get security context from middleware
	// =========================================================================
	filters := authz.GetReBACFilters(c)

	// SECURITY: org_id is MANDATORY for tenant isolation
	if filters["current_org_id"] == nil || filters["current_org_id"].(string) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "organization_id is required",
			"message": "Please provide org_id query param or X-Org-ID header for tenant isolation",
		})
		return
	}

	// Optional: Filter by project_id (if provided)
	if projectID := c.Query("project_id"); projectID != "" {
		filters["project_id"] = projectID
	} else if projectID := c.GetHeader("X-Project-ID"); projectID != "" {
		filters["project_id"] = projectID
	}

	// Parse resource-specific query parameters
	if isActiveStr := c.Query("is_active"); isActiveStr != "" {
		filters["is_active"] = isActiveStr == "true"
	}
	if search := c.Query("search"); search != "" {
		filters["search"] = search
	}
	if groupID := c.Query("group_id"); groupID != "" {
		filters["group_id"] = groupID
	}

	services, err := h.ServiceService.ListServices(filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list services: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"services": services,
		"count":    len(services),
	})
}
