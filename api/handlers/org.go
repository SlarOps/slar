package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/authz"
)

// OrgHandler handles organization-related HTTP requests
type OrgHandler struct {
	orgService *authz.OrgService
}

// NewOrgHandler creates a new OrgHandler
func NewOrgHandler(orgService *authz.OrgService) *OrgHandler {
	return &OrgHandler{orgService: orgService}
}

// CreateOrg handles POST /orgs
func (h *OrgHandler) CreateOrg(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var input authz.CreateOrgInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	org, err := h.orgService.CreateOrg(c.Request.Context(), userID, input)
	if err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrInvalidInput {
			status = http.StatusBadRequest
		} else if err == authz.ErrAlreadyExists {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, org)
}

// ListOrgs handles GET /orgs
func (h *OrgHandler) ListOrgs(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	orgs, err := h.orgService.ListUserOrgsWithRole(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"organizations": orgs})
}

// GetOrg handles GET /orgs/:id
func (h *OrgHandler) GetOrg(c *gin.Context) {
	userID := c.GetString("user_id")
	orgID := c.Param("id")

	org, err := h.orgService.GetOrg(c.Request.Context(), userID, orgID)
	if err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, org)
}

// UpdateOrg handles PATCH /orgs/:id
func (h *OrgHandler) UpdateOrg(c *gin.Context) {
	userID := c.GetString("user_id")
	orgID := c.Param("id")

	var input authz.UpdateOrgInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	org, err := h.orgService.UpdateOrg(c.Request.Context(), userID, orgID, input)
	if err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, org)
}

// DeleteOrg handles DELETE /orgs/:id
func (h *OrgHandler) DeleteOrg(c *gin.Context) {
	userID := c.GetString("user_id")
	orgID := c.Param("id")

	if err := h.orgService.DeleteOrg(c.Request.Context(), userID, orgID); err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// GetOrgMembers handles GET /orgs/:id/members
func (h *OrgHandler) GetOrgMembers(c *gin.Context) {
	userID := c.GetString("user_id")
	orgID := c.Param("id")

	members, err := h.orgService.GetOrgMembers(c.Request.Context(), userID, orgID)
	if err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"members": members})
}

// AddOrgMember handles POST /orgs/:id/members
func (h *OrgHandler) AddOrgMember(c *gin.Context) {
	userID := c.GetString("user_id")
	orgID := c.Param("id")

	var input authz.AddOrgMemberInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.orgService.AddOrgMember(c.Request.Context(), userID, orgID, input); err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrInvalidInput {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "member added"})
}

// UpdateOrgMemberRole handles PATCH /orgs/:id/members/:user_id
func (h *OrgHandler) UpdateOrgMemberRole(c *gin.Context) {
	actorID := c.GetString("user_id")
	orgID := c.Param("id")
	targetUserID := c.Param("user_id")

	var input struct {
		Role authz.Role `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.orgService.UpdateOrgMemberRole(c.Request.Context(), actorID, orgID, targetUserID, input.Role); err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrInvalidInput {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "role updated"})
}

// RemoveOrgMember handles DELETE /orgs/:id/members/:user_id
func (h *OrgHandler) RemoveOrgMember(c *gin.Context) {
	actorID := c.GetString("user_id")
	orgID := c.Param("id")
	targetUserID := c.Param("user_id")

	if err := h.orgService.RemoveOrgMember(c.Request.Context(), actorID, orgID, targetUserID); err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrCannotRemoveSelf {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}
