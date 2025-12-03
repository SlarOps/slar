package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/authz"
)

// ProjectHandler handles project-related HTTP requests
type ProjectHandler struct {
	projectService *authz.ProjectService
}

// NewProjectHandler creates a new ProjectHandler
func NewProjectHandler(projectService *authz.ProjectService) *ProjectHandler {
	return &ProjectHandler{projectService: projectService}
}

// CreateProject handles POST /orgs/:id/projects
func (h *ProjectHandler) CreateProject(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	orgID := c.Param("id")

	var input struct {
		Name        string `json:"name" binding:"required"`
		Slug        string `json:"slug" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project, err := h.projectService.CreateProject(c.Request.Context(), userID, authz.CreateProjectInput{
		OrganizationID: orgID,
		Name:           input.Name,
		Slug:           input.Slug,
		Description:    input.Description,
	})
	if err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		} else if err == authz.ErrInvalidInput {
			status = http.StatusBadRequest
		} else if err == authz.ErrAlreadyExists {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, project)
}

// ListOrgProjects handles GET /orgs/:id/projects
func (h *ProjectHandler) ListOrgProjects(c *gin.Context) {
	userID := c.GetString("user_id")
	orgID := c.Param("id")

	projects, err := h.projectService.ListOrgProjects(c.Request.Context(), userID, orgID)
	if err != nil {
		status := http.StatusInternalServerError
		if err == authz.ErrForbidden {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

// ListUserProjects handles GET /projects (all projects user has access to)
func (h *ProjectHandler) ListUserProjects(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	projects, err := h.projectService.ListUserProjects(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

// GetProject handles GET /projects/:id
func (h *ProjectHandler) GetProject(c *gin.Context) {
	userID := c.GetString("user_id")
	projectID := c.Param("id")

	project, err := h.projectService.GetProject(c.Request.Context(), userID, projectID)
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

	c.JSON(http.StatusOK, project)
}

// UpdateProject handles PATCH /projects/:id
func (h *ProjectHandler) UpdateProject(c *gin.Context) {
	userID := c.GetString("user_id")
	projectID := c.Param("id")

	var input authz.UpdateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project, err := h.projectService.UpdateProject(c.Request.Context(), userID, projectID, input)
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

	c.JSON(http.StatusOK, project)
}

// DeleteProject handles DELETE /projects/:id
func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	userID := c.GetString("user_id")
	projectID := c.Param("id")

	if err := h.projectService.DeleteProject(c.Request.Context(), userID, projectID); err != nil {
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

// GetProjectMembers handles GET /projects/:id/members
func (h *ProjectHandler) GetProjectMembers(c *gin.Context) {
	userID := c.GetString("user_id")
	projectID := c.Param("id")

	members, err := h.projectService.GetProjectMembers(c.Request.Context(), userID, projectID)
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

// AddProjectMember handles POST /projects/:id/members
func (h *ProjectHandler) AddProjectMember(c *gin.Context) {
	userID := c.GetString("user_id")
	projectID := c.Param("id")

	var input authz.AddProjectMemberInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.projectService.AddProjectMember(c.Request.Context(), userID, projectID, input); err != nil {
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

// RemoveProjectMember handles DELETE /projects/:id/members/:user_id
func (h *ProjectHandler) RemoveProjectMember(c *gin.Context) {
	actorID := c.GetString("user_id")
	projectID := c.Param("id")
	targetUserID := c.Param("user_id")

	if err := h.projectService.RemoveProjectMember(c.Request.Context(), actorID, projectID, targetUserID); err != nil {
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
