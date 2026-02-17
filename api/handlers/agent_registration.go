package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

// AgentRegistrationHandler handles agent self-registration and lifecycle
type AgentRegistrationHandler struct {
	Registry *services.AgentRegistry
}

// NewAgentRegistrationHandler creates a new agent registration handler
func NewAgentRegistrationHandler(registry *services.AgentRegistry) *AgentRegistrationHandler {
	return &AgentRegistrationHandler{Registry: registry}
}

// RegisterAgent - Agent calls this on startup to register with Control Plane
// POST /internal/agents/register
// project_id is optional - if empty, registers as org-level (default) agent
func (h *AgentRegistrationHandler) RegisterAgent(c *gin.Context) {
	var req struct {
		ProjectID string `json:"project_id"` // Optional - empty for org-level agent
		OrgID     string `json:"org_id" binding:"required"`
		Host      string `json:"host" binding:"required"`
		Port      string `json:"port" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Register agent with current timestamp
	h.Registry.Register(req.ProjectID, req.OrgID, req.Host, req.Port)

	// Use appropriate key for UpdateLastSeen
	registryKey := req.ProjectID
	if registryKey == "" {
		registryKey = "org:" + req.OrgID
	}
	h.Registry.UpdateLastSeen(registryKey, time.Now())

	scope := "project-specific"
	if req.ProjectID == "" {
		scope = "org-level (default)"
	}

	log.Printf("✅ Agent registered - Scope: %s, Org: %s, Host: %s:%s",
		scope, req.OrgID, req.Host, req.Port)

	c.JSON(http.StatusOK, gin.H{
		"message":    "Agent registered successfully",
		"scope":      scope,
		"project_id": req.ProjectID,
		"org_id":     req.OrgID,
		"status":     "healthy",
	})
}

// Heartbeat - Agent calls this periodically (every 30s) to maintain healthy status
// POST /internal/agents/heartbeat
// Supports both project-specific and org-level agents
func (h *AgentRegistrationHandler) Heartbeat(c *gin.Context) {
	var req struct {
		ProjectID string `json:"project_id"` // Optional - empty for org-level agents
		OrgID     string `json:"org_id"`     // Required for org-level agents
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine registry key
	registryKey := req.ProjectID
	if registryKey == "" {
		if req.OrgID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Either project_id or org_id must be provided",
			})
			return
		}
		registryKey = "org:" + req.OrgID
	}

	// Check if agent exists
	_, err := h.Registry.GetAgentURL(registryKey)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "Agent not registered",
			"message": "Please call /internal/agents/register first",
		})
		return
	}

	// Mark as healthy and update last_seen
	h.Registry.MarkHealthy(registryKey)
	h.Registry.UpdateLastSeen(registryKey, time.Now())

	scope := "project"
	if req.ProjectID == "" {
		scope = "org-level"
	}

	log.Printf("💓 Heartbeat received - Scope: %s, Key: %s", scope, registryKey)

	c.JSON(http.StatusOK, gin.H{
		"message": "Heartbeat received",
		"status":  "healthy",
		"scope":   scope,
	})
}

// UnregisterAgent - Agent calls this on graceful shutdown
// POST /internal/agents/unregister
func (h *AgentRegistrationHandler) UnregisterAgent(c *gin.Context) {
	var req struct {
		ProjectID string `json:"project_id"` // Optional - empty for org-level agents
		OrgID     string `json:"org_id"`     // Required for org-level agents
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine registry key
	registryKey := req.ProjectID
	if registryKey == "" {
		if req.OrgID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Either project_id or org_id must be provided",
			})
			return
		}
		registryKey = "org:" + req.OrgID
	}

	h.Registry.Unregister(registryKey)

	scope := "project"
	if req.ProjectID == "" {
		scope = "org-level"
	}

	log.Printf("👋 Agent unregistered - Scope: %s, Key: %s", scope, registryKey)

	c.JSON(http.StatusOK, gin.H{
		"message": "Agent unregistered successfully",
		"scope":   scope,
	})
}

// ListAgents - Admin endpoint to view all registered agents
// GET /internal/agents
func (h *AgentRegistrationHandler) ListAgents(c *gin.Context) {
	agents := h.Registry.ListAgents()

	c.JSON(http.StatusOK, gin.H{
		"agents": agents,
		"count":  len(agents),
	})
}
