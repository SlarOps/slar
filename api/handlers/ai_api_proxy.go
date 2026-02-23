package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

// AIAPIProxyHandler handles HTTP API proxying to AI Agent (non-WebSocket)
type AIAPIProxyHandler struct {
	AgentRegistry *services.AgentRegistry
}

// NewAIAPIProxyHandler creates a new AI API proxy handler
func NewAIAPIProxyHandler(registry *services.AgentRegistry) *AIAPIProxyHandler {
	return &AIAPIProxyHandler{
		AgentRegistry: registry,
	}
}

// ProxySyncBucket proxies /api/sync-bucket requests to AI Agent
// POST /api/sync-bucket
func (h *AIAPIProxyHandler) ProxySyncBucket(c *gin.Context) {
	// Extract context from query params or body
	var requestBody map[string]interface{}
	if err := c.ShouldBindJSON(&requestBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Get project_id and org_id from request body or query params
	projectID, _ := requestBody["project_id"].(string)
	orgID := c.Query("org_id")
	if orgID == "" {
		// Try to get from request body
		if orgIDValue, ok := requestBody["org_id"]; ok {
			orgID, _ = orgIDValue.(string)
		}
	}

	// Get auth token from header
	authToken := c.GetHeader("Authorization")
	if authToken == "" {
		// Try to get from request body (legacy)
		if tokenValue, ok := requestBody["auth_token"]; ok {
			authToken, _ = tokenValue.(string)
		}
	}

	log.Printf("🔄 Sync bucket request - Org: %s, Project: %s", orgID, projectID)

	// Lookup agent (with fallback to org-level)
	agentURL, err := h.AgentRegistry.GetAgentURLWithOrg(projectID, orgID)
	if err != nil {
		log.Printf("❌ No agent found for project %s (org %s): %v", projectID, orgID, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"message": "AI Agent not available. Please ensure an agent is registered.",
		})
		return
	}

	// Build target URL (convert ws:// to http://)
	targetURL := agentURL
	if len(targetURL) > 5 && targetURL[:5] == "ws://" {
		targetURL = "http://" + targetURL[5:]
	} else if len(targetURL) > 6 && targetURL[:6] == "wss://" {
		targetURL = "https://" + targetURL[6:]
	}
	targetURL = targetURL + "/api/sync-bucket"

	log.Printf("🔍 Proxying sync request to: %s", targetURL)

	// Marshal request body
	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		log.Printf("❌ Failed to marshal request body: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Internal server error",
		})
		return
	}

	// Create HTTP request to AI Agent
	req, err := http.NewRequest("POST", targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("❌ Failed to create request: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to create proxy request",
		})
		return
	}

	// Copy headers
	req.Header.Set("Content-Type", "application/json")
	if authToken != "" {
		req.Header.Set("Authorization", authToken)
	}

	// Send request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ Failed to proxy request: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "Failed to connect to AI service",
		})
		return
	}
	defer resp.Body.Close()

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ Failed to read response: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": "Failed to read AI service response",
		})
		return
	}

	log.Printf("✅ Sync request proxied successfully - Status: %d", resp.StatusCode)

	// Forward response
	c.Data(resp.StatusCode, "application/json", respBody)
}

// ProxyGenericAPI proxies generic API requests to AI Agent
// This can be used for other AI Agent endpoints in the future
func (h *AIAPIProxyHandler) ProxyGenericAPI(c *gin.Context, endpoint string) {
	// Similar implementation to ProxySyncBucket but with configurable endpoint
	// TODO: Implement if needed for other endpoints
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": "Generic proxy not yet implemented",
	})
}
