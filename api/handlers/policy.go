package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/authz"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

// PolicyHandler handles HTTP requests for agent policy management.
type PolicyHandler struct {
	PolicyService *services.PolicyService
}

// NewPolicyHandler creates a new PolicyHandler.
func NewPolicyHandler(policyService *services.PolicyService) *PolicyHandler {
	return &PolicyHandler{PolicyService: policyService}
}

// resolveOrgID reads org_id: body field handled by caller, then query param, then X-Org-ID header.
// Mirrors CreateGroup: body > query param > header.
func resolveOrgID(c *gin.Context) string {
	if id := c.Query("org_id"); id != "" {
		return id
	}
	return c.GetHeader("X-Org-ID")
}

// ListPolicies retrieves policies for an org with optional project scoping.
// GET /policies?org_id=...&project_id=...&active_only=true
// GET /internal/policies?org_id=...&project_id=...&active_only=true
func (h *PolicyHandler) ListPolicies(c *gin.Context) {
	orgID := resolveOrgID(c)
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "organization_id is required",
			"message": "Please provide org_id query param or X-Org-ID header for tenant isolation",
		})
		return
	}

	policyFilters := map[string]interface{}{
		"org_id": orgID,
	}

	if projectID := c.Query("project_id"); projectID != "" {
		policyFilters["project_id"] = projectID
	} else if projectID := c.GetHeader("X-Project-ID"); projectID != "" {
		policyFilters["project_id"] = projectID
	}

	if activeOnlyStr := c.Query("active_only"); activeOnlyStr != "" {
		if val, err := strconv.ParseBool(activeOnlyStr); err == nil {
			policyFilters["active_only"] = val
		}
	}

	policies, err := h.PolicyService.ListPolicies(policyFilters)
	if err != nil {
		log.Printf("ListPolicies error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve policies"})
		return
	}

	responses := make([]db.AgentPolicyResponse, len(policies))
	for i, p := range policies {
		responses[i] = p.ToResponse()
	}

	c.JSON(http.StatusOK, gin.H{
		"policies": responses,
		"total":    len(responses),
	})
}

// GetPolicy retrieves a specific policy by ID.
// GET /policies/:id?org_id=...
func (h *PolicyHandler) GetPolicy(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "policy id is required"})
		return
	}

	orgID := resolveOrgID(c)
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id is required"})
		return
	}

	policy, err := h.PolicyService.GetPolicy(id, orgID)
	if err != nil {
		log.Printf("GetPolicy error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve policy"})
		return
	}
	if policy == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	c.JSON(http.StatusOK, policy.ToResponse())
}

// CreatePolicy creates a new agent policy.
// POST /policies   body: CreatePolicyRequest
// Pattern follows CreateGroup exactly: body > query param > X-Org-ID header
func (h *PolicyHandler) CreatePolicy(c *gin.Context) {
	var req db.CreatePolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// ReBAC: resolve org_id — body > query param > header
	if req.OrgID == "" {
		req.OrgID = c.Query("org_id")
	}
	if req.OrgID == "" {
		req.OrgID = c.GetHeader("X-Org-ID")
	}
	if req.OrgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "organization_id is required",
			"message": "Please provide org_id in request body, query param, or X-Org-ID header",
		})
		return
	}

	// Optional: inject project context
	if req.ProjectID == nil {
		if projectID := c.Query("project_id"); projectID != "" {
			req.ProjectID = &projectID
		} else if projectID := c.GetHeader("X-Project-ID"); projectID != "" {
			req.ProjectID = &projectID
		}
	}

	log.Printf("CreatePolicy: org_id=%s, user_id=%v", req.OrgID, userID)

	policy, err := h.PolicyService.CreatePolicy(&req, userID.(string))
	if err != nil {
		log.Printf("CreatePolicy error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create policy"})
		return
	}

	c.JSON(http.StatusCreated, policy.ToResponse())
}

// UpdatePolicy applies partial updates to a policy.
// PATCH /policies/:id?org_id=...
func (h *PolicyHandler) UpdatePolicy(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "policy id is required"})
		return
	}

	var req db.UpdatePolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgID := resolveOrgID(c)
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id is required"})
		return
	}

	policy, err := h.PolicyService.UpdatePolicy(id, orgID, &req)
	if err != nil {
		log.Printf("UpdatePolicy error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update policy"})
		return
	}
	if policy == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	c.JSON(http.StatusOK, policy.ToResponse())
}

// DeletePolicy removes a policy.
// DELETE /policies/:id?org_id=...
func (h *PolicyHandler) DeletePolicy(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "policy id is required"})
		return
	}

	orgID := resolveOrgID(c)
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id is required"})
		return
	}

	deleted, err := h.PolicyService.DeletePolicy(id, orgID)
	if err != nil {
		log.Printf("DeletePolicy error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete policy"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Policy deleted successfully"})
}

// GetPolicyVersion returns the current policy version for cache invalidation.
// GET /policies/version?org_id=...  or  GET /internal/policies/version?org_id=...
func (h *PolicyHandler) GetPolicyVersion(c *gin.Context) {
	orgID := resolveOrgID(c)
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id is required"})
		return
	}

	version, err := h.PolicyService.GetPolicyVersion(orgID)
	if err != nil {
		log.Printf("GetPolicyVersion error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get policy version"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"org_id":  orgID,
		"version": version,
	})
}

// Ensure authz package import is used (GetReBACFilters is not needed here; we follow group pattern)
var _ = authz.RoleAdmin
