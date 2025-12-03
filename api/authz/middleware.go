package authz

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ContextKey is the type for context keys to avoid collisions
type ContextKey string

const (
	// Context keys for storing authorization data
	ContextKeyOrgID       ContextKey = "org_id"
	ContextKeyProjectID   ContextKey = "project_id"
	ContextKeyOrgRole     ContextKey = "org_role"
	ContextKeyProjectRole ContextKey = "project_role"
)

// AuthzMiddleware creates a Gin middleware for authorization
// It checks permissions based on org_id and project_id from URL params
type AuthzMiddleware struct {
	Authorizer Authorizer
}

// NewAuthzMiddleware creates a new authorization middleware
func NewAuthzMiddleware(az Authorizer) *AuthzMiddleware {
	return &AuthzMiddleware{Authorizer: az}
}

// RequireOrgAccess middleware ensures user has access to the organization
// Usage: router.Use(authzMiddleware.RequireOrgAccess())
func (m *AuthzMiddleware) RequireOrgAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		orgID := c.Param("org_id")
		if orgID == "" {
			orgID = c.Query("org_id")
		}
		if orgID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "Organization ID is required",
			})
			return
		}

		if !m.Authorizer.CanAccessOrg(c.Request.Context(), userID, orgID) {
			log.Printf("AUTHZ DENIED - User %s cannot access org %s", userID, orgID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have access to this organization",
			})
			return
		}

		// Store org info in context
		role := m.Authorizer.GetOrgRole(c.Request.Context(), userID, orgID)
		c.Set(string(ContextKeyOrgID), orgID)
		c.Set(string(ContextKeyOrgRole), role)

		log.Printf("AUTHZ OK - User %s has role %s in org %s", userID, role, orgID)
		c.Next()
	}
}

// RequireProjectAccess middleware ensures user has access to the project
// Usage: router.Use(authzMiddleware.RequireProjectAccess())
func (m *AuthzMiddleware) RequireProjectAccess() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		projectID := c.Param("project_id")
		if projectID == "" {
			projectID = c.Query("project_id")
		}
		if projectID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "Project ID is required",
			})
			return
		}

		if !m.Authorizer.CanAccessProject(c.Request.Context(), userID, projectID) {
			log.Printf("AUTHZ DENIED - User %s cannot access project %s", userID, projectID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have access to this project",
			})
			return
		}

		// Store project info in context
		role := m.Authorizer.GetProjectRole(c.Request.Context(), userID, projectID)
		c.Set(string(ContextKeyProjectID), projectID)
		c.Set(string(ContextKeyProjectRole), role)

		log.Printf("AUTHZ OK - User %s has role %s in project %s", userID, role, projectID)
		c.Next()
	}
}

// RequireOrgRole middleware ensures user has a specific role in the organization
// Usage: router.Use(authzMiddleware.RequireOrgRole(authz.RoleAdmin))
func (m *AuthzMiddleware) RequireOrgRole(requiredRoles ...Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		orgID := c.Param("org_id")
		if orgID == "" {
			orgID = c.GetString(string(ContextKeyOrgID))
		}
		if orgID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "Organization ID is required",
			})
			return
		}

		role := m.Authorizer.GetOrgRole(c.Request.Context(), userID, orgID)
		if !containsRole(requiredRoles, role) {
			log.Printf("AUTHZ DENIED - User %s role %s not in required roles %v for org %s", userID, role, requiredRoles, orgID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have the required role for this action",
			})
			return
		}

		c.Set(string(ContextKeyOrgID), orgID)
		c.Set(string(ContextKeyOrgRole), role)
		c.Next()
	}
}

// RequireProjectRole middleware ensures user has a specific role in the project
// Usage: router.Use(authzMiddleware.RequireProjectRole(authz.RoleAdmin))
func (m *AuthzMiddleware) RequireProjectRole(requiredRoles ...Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		projectID := c.Param("project_id")
		if projectID == "" {
			projectID = c.GetString(string(ContextKeyProjectID))
		}
		if projectID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "Project ID is required",
			})
			return
		}

		role := m.Authorizer.GetProjectRole(c.Request.Context(), userID, projectID)
		if !containsRole(requiredRoles, role) {
			log.Printf("AUTHZ DENIED - User %s role %s not in required roles %v for project %s", userID, role, requiredRoles, projectID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have the required role for this action",
			})
			return
		}

		c.Set(string(ContextKeyProjectID), projectID)
		c.Set(string(ContextKeyProjectRole), role)
		c.Next()
	}
}

// RequireOrgAction middleware ensures user can perform a specific action on the org
// Usage: router.DELETE("/orgs/:org_id", authzMiddleware.RequireOrgAction(authz.ActionDelete), handler)
func (m *AuthzMiddleware) RequireOrgAction(action Action) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		orgID := c.Param("org_id")
		if orgID == "" {
			orgID = c.GetString(string(ContextKeyOrgID))
		}
		if orgID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "Organization ID is required",
			})
			return
		}

		if !m.Authorizer.CanPerformOrgAction(c.Request.Context(), userID, orgID, action) {
			log.Printf("AUTHZ DENIED - User %s cannot perform %s on org %s", userID, action, orgID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have permission to perform this action",
			})
			return
		}

		role := m.Authorizer.GetOrgRole(c.Request.Context(), userID, orgID)
		c.Set(string(ContextKeyOrgID), orgID)
		c.Set(string(ContextKeyOrgRole), role)
		c.Next()
	}
}

// RequireProjectAction middleware ensures user can perform a specific action on the project
// Usage: router.DELETE("/projects/:project_id", authzMiddleware.RequireProjectAction(authz.ActionDelete), handler)
func (m *AuthzMiddleware) RequireProjectAction(action Action) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		projectID := c.Param("project_id")
		if projectID == "" {
			projectID = c.GetString(string(ContextKeyProjectID))
		}
		if projectID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "Project ID is required",
			})
			return
		}

		if !m.Authorizer.CanPerformProjectAction(c.Request.Context(), userID, projectID, action) {
			log.Printf("AUTHZ DENIED - User %s cannot perform %s on project %s", userID, action, projectID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have permission to perform this action",
			})
			return
		}

		role := m.Authorizer.GetProjectRole(c.Request.Context(), userID, projectID)
		c.Set(string(ContextKeyProjectID), projectID)
		c.Set(string(ContextKeyProjectRole), role)
		c.Next()
	}
}

// AutoDetectAction middleware automatically determines action from HTTP method
// Usage: router.Use(authzMiddleware.AutoDetectAction())
func (m *AuthzMiddleware) AutoDetectAction() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		action := MethodToAction(c.Request.Method)

		// Check project first, then org
		projectID := c.Param("project_id")
		if projectID != "" {
			if !m.Authorizer.CanPerformProjectAction(c.Request.Context(), userID, projectID, action) {
				log.Printf("AUTHZ DENIED - User %s cannot %s on project %s", userID, action, projectID)
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"error":   "forbidden",
					"message": "You don't have permission to perform this action",
				})
				return
			}
			role := m.Authorizer.GetProjectRole(c.Request.Context(), userID, projectID)
			c.Set(string(ContextKeyProjectID), projectID)
			c.Set(string(ContextKeyProjectRole), role)
			c.Next()
			return
		}

		orgID := c.Param("org_id")
		if orgID != "" {
			if !m.Authorizer.CanPerformOrgAction(c.Request.Context(), userID, orgID, action) {
				log.Printf("AUTHZ DENIED - User %s cannot %s on org %s", userID, action, orgID)
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"error":   "forbidden",
					"message": "You don't have permission to perform this action",
				})
				return
			}
			role := m.Authorizer.GetOrgRole(c.Request.Context(), userID, orgID)
			c.Set(string(ContextKeyOrgID), orgID)
			c.Set(string(ContextKeyOrgRole), role)
		}

		c.Next()
	}
}

// MethodToAction maps HTTP methods to authorization actions
func MethodToAction(method string) Action {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return ActionView
	case http.MethodPost:
		return ActionCreate
	case http.MethodPut, http.MethodPatch:
		return ActionUpdate
	case http.MethodDelete:
		return ActionDelete
	default:
		return ActionView
	}
}

// Helper function to check if a role is in a list of roles
func containsRole(roles []Role, role Role) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}

// GetOrgIDFromContext retrieves the organization ID from Gin context
func GetOrgIDFromContext(c *gin.Context) string {
	return c.GetString(string(ContextKeyOrgID))
}

// GetProjectIDFromContext retrieves the project ID from Gin context
func GetProjectIDFromContext(c *gin.Context) string {
	return c.GetString(string(ContextKeyProjectID))
}

// GetOrgRoleFromContext retrieves the user's org role from Gin context
func GetOrgRoleFromContext(c *gin.Context) Role {
	role := c.GetString(string(ContextKeyOrgRole))
	return Role(role)
}

// GetProjectRoleFromContext retrieves the user's project role from Gin context
func GetProjectRoleFromContext(c *gin.Context) Role {
	role := c.GetString(string(ContextKeyProjectRole))
	return Role(role)
}


// ProjectScopedMiddleware injects project context for resource creation/listing
// - If project_id provided (param/query/header): validate access, set project_id + org_id
// - If no project_id: compute accessible projects list for filtering
type ProjectScopedMiddleware struct {
	Authorizer     Authorizer
	ProjectService *ProjectService
}

// NewProjectScopedMiddleware creates middleware for project-scoped resources
func NewProjectScopedMiddleware(az Authorizer, ps *ProjectService) *ProjectScopedMiddleware {
	return &ProjectScopedMiddleware{
		Authorizer:     az,
		ProjectService: ps,
	}
}

// InjectProjectContext middleware for resource handlers
// Simple ReBAC: Just pass user context, service layer handles relationship traversal
func (m *ProjectScopedMiddleware) InjectProjectContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		// Optional: If project_id provided, validate and set context for scoping
		projectID := c.Param("project_id")
		if projectID == "" {
			projectID = c.Query("project_id")
		}
		if projectID == "" {
			projectID = c.GetHeader("X-Project-ID")
		}

		if projectID != "" {
			// Validate project access via ReBAC
			if !m.Authorizer.CanAccessProject(c.Request.Context(), userID, projectID) {
				log.Printf("REBAC DENIED: User %s cannot access project %s", userID, projectID)
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"error":   "forbidden",
					"message": "You don't have access to this project",
				})
				return
			}
			c.Set(string(ContextKeyProjectID), projectID)
			log.Printf("REBAC: User %s scoped to project %s", userID, projectID)
		}
		// No pre-computed lists - service layer uses EXISTS for relationship traversal

		c.Next()
	}
}

// =============================================================================
// ReBAC FILTER HELPER (Shared across all handlers)
// =============================================================================

// GetReBACFilters extracts security context from Gin Context and returns
// a standardized filter map to pass to Service layer.
// ReBAC with Tenant Isolation: Pass user_id + org_id (mandatory), service layer handles relationship traversal.
//
// Usage:
//
//	func (h *Handler) List(c *gin.Context) {
//	    filters := authz.GetReBACFilters(c)
//	    // Add resource-specific filters
//	    if status := c.Query("status"); status != "" {
//	        filters["status"] = status
//	    }
//	    results, err := h.Service.List(c.Request.Context(), filters)
//	}
func GetReBACFilters(c *gin.Context) map[string]interface{} {
	filters := make(map[string]interface{})

	// ReBAC: Pass user_id, service layer handles relationship traversal via EXISTS
	if userID := c.GetString("user_id"); userID != "" {
		filters["current_user_id"] = userID
	}

	// TENANT ISOLATION (MANDATORY): Pass org_id for all queries
	// Priority: context (set by middleware) > query param > header
	orgID := GetOrgIDFromContext(c)
	if orgID == "" {
		orgID = c.Query("org_id")
	}
	if orgID == "" {
		orgID = c.GetHeader("X-Org-ID")
	}
	if orgID != "" {
		filters["current_org_id"] = orgID
	}

	// Optional: Project scoping (if explicitly provided)
	if projectID := GetProjectIDFromContext(c); projectID != "" {
		filters["project_id"] = projectID
	}

	return filters
}

// =============================================================================
// GENERIC PERMISSION MIDDLEWARE (Defense in Depth Pattern)
// =============================================================================

// RequirePermission is a flexible middleware that checks permissions based on
// action and resource type. It extracts resource ID from URL params.
//
// URL param naming convention: {resourceType}ID or {resourceType}_id
// Example: /orgs/:org_id/projects/:project_id
//
// Usage:
//   router.Use(authzMiddleware.RequirePermission(authz.ActionView, authz.ResourceProject))
//   router.DELETE("/:id", authzMiddleware.RequirePermission(authz.ActionDelete, authz.ResourceOrg), handler)
func (m *AuthzMiddleware) RequirePermission(action Action, resourceType ResourceType) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		// Try to get resource ID from URL params
		// Naming convention: project_id, org_id, or id (fallback)
		resourceID := c.Param(string(resourceType) + "_id")
		if resourceID == "" {
			resourceID = c.Param("id") // Fallback to generic :id
		}

		// If no ID found in URL, skip middleware (let handler deal with it)
		// This is useful for POST requests where ID doesn't exist yet
		if resourceID == "" {
			log.Printf("AUTHZ SKIP - No %s_id in URL, delegating to handler", resourceType)
			c.Next()
			return
		}

		// Check permission using Authorizer.Check()
		allowed := m.Authorizer.Check(c.Request.Context(), userID, action, resourceType, resourceID)
		if !allowed {
			log.Printf("AUTHZ DENIED - User %s cannot %s on %s %s", userID, action, resourceType, resourceID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have permission to perform this action",
				"details": map[string]string{
					"action":        string(action),
					"resource_type": string(resourceType),
					"resource_id":   resourceID,
				},
			})
			return
		}

		// Store resource info in context for handler use
		switch resourceType {
		case ResourceOrg:
			role := m.Authorizer.GetOrgRole(c.Request.Context(), userID, resourceID)
			c.Set(string(ContextKeyOrgID), resourceID)
			c.Set(string(ContextKeyOrgRole), string(role))
			log.Printf("AUTHZ OK - User %s (role: %s) can %s on %s %s", userID, role, action, resourceType, resourceID)
		case ResourceProject:
			role := m.Authorizer.GetProjectRole(c.Request.Context(), userID, resourceID)
			c.Set(string(ContextKeyProjectID), resourceID)
			c.Set(string(ContextKeyProjectRole), string(role))
			log.Printf("AUTHZ OK - User %s (role: %s) can %s on %s %s", userID, role, action, resourceType, resourceID)
		}

		c.Next()
	}
}

// RequirePermissionWithParamKey is like RequirePermission but allows specifying
// a custom URL param key for the resource ID.
//
// Usage:
//   router.GET("/custom/:customID", authzMiddleware.RequirePermissionWithParamKey(
//       authz.ActionView, authz.ResourceProject, "customID"), handler)
func (m *AuthzMiddleware) RequirePermissionWithParamKey(action Action, resourceType ResourceType, paramKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "User not authenticated",
			})
			return
		}

		resourceID := c.Param(paramKey)
		if resourceID == "" {
			log.Printf("AUTHZ SKIP - No %s in URL, delegating to handler", paramKey)
			c.Next()
			return
		}

		allowed := m.Authorizer.Check(c.Request.Context(), userID, action, resourceType, resourceID)
		if !allowed {
			log.Printf("AUTHZ DENIED - User %s cannot %s on %s %s", userID, action, resourceType, resourceID)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "You don't have permission to perform this action",
			})
			return
		}

		// Store in context
		switch resourceType {
		case ResourceOrg:
			role := m.Authorizer.GetOrgRole(c.Request.Context(), userID, resourceID)
			c.Set(string(ContextKeyOrgID), resourceID)
			c.Set(string(ContextKeyOrgRole), string(role))
		case ResourceProject:
			role := m.Authorizer.GetProjectRole(c.Request.Context(), userID, resourceID)
			c.Set(string(ContextKeyProjectID), resourceID)
			c.Set(string(ContextKeyProjectRole), string(role))
		}

		c.Next()
	}
}
