package services

import (
	"fmt"
	"log"
	"sync"
	"time"
)

// AgentInfo holds connection info for an AI agent instance
type AgentInfo struct {
	ProjectID string    // Empty for org-level agents
	OrgID     string
	Host      string
	Port      string
	Scope     string    // "project" (dedicated) or "org" (default/shared)
	Status    string    // "healthy", "unhealthy"
	LastSeen  time.Time // Last heartbeat timestamp
}

// AgentRegistry manages mapping between projects and agent instances
type AgentRegistry struct {
	agents map[string]*AgentInfo // Key: project_id
	mu     sync.RWMutex
}

// NewAgentRegistry creates a new agent registry
func NewAgentRegistry() *AgentRegistry {
	return &AgentRegistry{
		agents: make(map[string]*AgentInfo),
	}
}

// Register adds or updates an agent
// If projectID is empty, registers as org-level (default) agent
func (r *AgentRegistry) Register(projectID, orgID, host, port string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	scope := "project"
	if projectID == "" {
		scope = "org"
		// Use org_id as key for org-level agents
		projectID = "org:" + orgID
	}

	r.agents[projectID] = &AgentInfo{
		ProjectID: projectID,
		OrgID:     orgID,
		Host:      host,
		Port:      port,
		Scope:     scope,
		Status:    "healthy",
	}
}

// GetAgentURL returns the WebSocket URL for an agent handling the given project
// Uses fallback logic: project-specific → org-level → global
func (r *AgentRegistry) GetAgentURL(projectID string) (string, error) {
	return r.GetAgentURLWithOrg(projectID, "")
}

// GetAgentURLWithOrg returns agent URL with org-level fallback
func (r *AgentRegistry) GetAgentURLWithOrg(projectID, orgID string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// Priority 1: Project-specific agent (dedicated)
	if agent, exists := r.agents[projectID]; exists && agent.Status == "healthy" {
		log.Printf("🎯 Using dedicated agent for project %s (%s:%s)", projectID, agent.Host, agent.Port)
		return fmt.Sprintf("ws://%s:%s", agent.Host, agent.Port), nil
	}

	// Priority 2: Org-level default agent (if orgID provided)
	if orgID != "" {
		orgKey := "org:" + orgID
		if agent, exists := r.agents[orgKey]; exists && agent.Status == "healthy" {
			log.Printf("🔄 Using org-level agent for project %s (fallback to %s:%s)", projectID, agent.Host, agent.Port)
			return fmt.Sprintf("ws://%s:%s", agent.Host, agent.Port), nil
		}
	}

	// Priority 3: Find any org-level agent for this org (scan all agents)
	if orgID != "" {
		for key, agent := range r.agents {
			if agent.Scope == "org" && agent.OrgID == orgID && agent.Status == "healthy" {
				log.Printf("🔄 Using org-level agent for project %s (found %s:%s)", projectID, agent.Host, agent.Port)
				return fmt.Sprintf("ws://%s:%s", agent.Host, agent.Port), nil
			}
			_ = key // Suppress unused warning
		}
	}

	return "", fmt.Errorf("no healthy agent found for project %s (org %s)", projectID, orgID)
}

// Unregister removes an agent (e.g., when it goes down)
func (r *AgentRegistry) Unregister(projectID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.agents, projectID)
}

// MarkUnhealthy marks an agent as unhealthy (but keeps registration)
func (r *AgentRegistry) MarkUnhealthy(projectID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if agent, exists := r.agents[projectID]; exists {
		agent.Status = "unhealthy"
	}
}

// MarkHealthy marks an agent as healthy
func (r *AgentRegistry) MarkHealthy(projectID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if agent, exists := r.agents[projectID]; exists {
		agent.Status = "healthy"
	}
}

// ListAgents returns all registered agents (for debugging)
func (r *AgentRegistry) ListAgents() []*AgentInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	agents := make([]*AgentInfo, 0, len(r.agents))
	for _, agent := range r.agents {
		agents = append(agents, agent)
	}
	return agents
}

// UpdateLastSeen updates the last heartbeat timestamp for an agent
func (r *AgentRegistry) UpdateLastSeen(projectID string, timestamp time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if agent, exists := r.agents[projectID]; exists {
		agent.LastSeen = timestamp
	}
}

// MarkStaleAgentsUnhealthy checks all agents and marks those without recent heartbeat as unhealthy
// This should be called periodically (e.g., every 30 seconds)
func (r *AgentRegistry) MarkStaleAgentsUnhealthy(threshold time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	for _, agent := range r.agents {
		// Skip if LastSeen is zero (newly registered, waiting for first heartbeat)
		if agent.LastSeen.IsZero() {
			continue
		}

		// Check if agent is stale
		if now.Sub(agent.LastSeen) > threshold {
			if agent.Status == "healthy" {
				agent.Status = "unhealthy"
				log.Printf("⚠️  Agent for project %s marked unhealthy (no heartbeat for %v)",
					agent.ProjectID, now.Sub(agent.LastSeen))
			}
		}
	}
}
