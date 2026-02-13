package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/authz"
)

// InternalAuthzHandler handles internal authorization check requests from
// other services (e.g., AI Agent). These endpoints are NOT exposed externally
// and should only be accessible within the internal network.
type InternalAuthzHandler struct {
	authorizer authz.Authorizer
}

// NewInternalAuthzHandler creates a new InternalAuthzHandler.
func NewInternalAuthzHandler(authorizer authz.Authorizer) *InternalAuthzHandler {
	return &InternalAuthzHandler{authorizer: authorizer}
}

// GetOrgRole handles GET /internal/authz/org/:org_id/role?user_id=xxx
// Returns the user's role in the specified organization.
func (h *InternalAuthzHandler) GetOrgRole(c *gin.Context) {
	orgID := c.Param("org_id")
	userID := c.Query("user_id")

	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id query parameter is required"})
		return
	}

	role := h.authorizer.GetOrgRole(c.Request.Context(), userID, orgID)
	if role == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "no membership found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"role": string(role)})
}

// GetProjectRole handles GET /internal/authz/project/:project_id/role?user_id=xxx
// Returns the user's effective role in the specified project (including inherited org roles).
func (h *InternalAuthzHandler) GetProjectRole(c *gin.Context) {
	projectID := c.Param("project_id")
	userID := c.Query("user_id")

	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id query parameter is required"})
		return
	}

	role := h.authorizer.GetProjectRole(c.Request.Context(), userID, projectID)
	if role == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "no membership found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"role": string(role)})
}

// checkAccessRequest represents the JSON body for POST /internal/authz/check
type checkAccessRequest struct {
	UserID       string `json:"user_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	Action       string `json:"action"`
}

// CheckAccess handles POST /internal/authz/check
// Performs a generic authorization check: can user perform action on resource?
func (h *InternalAuthzHandler) CheckAccess(c *gin.Context) {
	var req checkAccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.UserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}
	if req.ResourceType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resource_type is required"})
		return
	}
	if req.Action == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action is required"})
		return
	}

	allowed := h.authorizer.Check(
		c.Request.Context(),
		req.UserID,
		authz.Action(req.Action),
		authz.ResourceType(req.ResourceType),
		req.ResourceID,
	)

	c.JSON(http.StatusOK, gin.H{"allowed": allowed})
}
