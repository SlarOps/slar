package handlers

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/vanchonlee/slar/services"
)

// AIProxyHandler handles WebSocket proxying to AI Agent
type AIProxyHandler struct {
	AgentRegistry *services.AgentRegistry // Multi-agent routing
}

// NewAIProxyHandler creates a new AI proxy handler
func NewAIProxyHandler(registry *services.AgentRegistry) *AIProxyHandler {
	return &AIProxyHandler{
		AgentRegistry: registry,
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		// TODO: Validate origin properly in production
		return true
	},
}

// ProxyWebSocket handles WebSocket connection from client and proxies to AI Agent
// Supports both "jwt" and "zero-trust" protocols
func (h *AIProxyHandler) ProxyWebSocket(c *gin.Context) {
	// Extract context from query params
	protocol := c.Query("protocol")
	projectID := c.Query("project_id")
	token := c.Query("token")
	orgID := c.Query("org_id")

	// Validate required params
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}

	// Default to jwt if not specified
	if protocol == "" {
		protocol = "jwt"
	}

	// Validate protocol
	if protocol != "jwt" && protocol != "zero-trust" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid protocol",
			"hint":  "Use protocol=jwt or protocol=zero-trust",
		})
		return
	}

	log.Printf("🔄 Proxy request - Protocol: %s, Org: %s, Project: %s", protocol, orgID, projectID)

	// Step 1: Lookup agent for this project (with org-level fallback)
	agentURL, err := h.AgentRegistry.GetAgentURLWithOrg(projectID, orgID)
	if err != nil {
		log.Printf("❌ No agent found for project %s (org %s): %v", projectID, orgID, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "AI Agent not available",
			"message": fmt.Sprintf("No healthy agent found for project %s. Please ensure an agent is registered.", projectID),
		})
		return
	}

	log.Printf("🔍 Routing to agent: %s (project: %s, org: %s, protocol: %s)", agentURL, projectID, orgID, protocol)

	// Step 2: UPGRADE client WebSocket connection
	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ Failed to upgrade client WebSocket: %v", err)
		return
	}
	defer clientConn.Close()
	log.Printf("📡 Client WebSocket connected")

	// Step 3: CONNECT to agent endpoint based on protocol
	var agentWSURL string
	if protocol == "jwt" {
		// Route to regular /ws/chat (Agent does JWT auth)
		agentWSURL = fmt.Sprintf("%s/ws/chat?token=%s&org_id=%s&project_id=%s",
			agentURL, url.QueryEscape(token), url.QueryEscape(orgID), url.QueryEscape(projectID))
	} else {
		// Route to /ws/secure/chat (Agent does Zero-Trust verification)
		// Don't pass token - Zero-Trust uses certificate
		agentWSURL = fmt.Sprintf("%s/ws/secure/chat?org_id=%s&project_id=%s",
			agentURL, url.QueryEscape(orgID), url.QueryEscape(projectID))
	}

	// Parse and set headers
	header := http.Header{}
	header.Add("Origin", "http://control-plane")

	agentConn, resp, err := websocket.DefaultDialer.Dial(agentWSURL, header)
	if err != nil {
		log.Printf("❌ Failed to connect to AI Agent: %v", err)
		if resp != nil {
			log.Printf("   Response status: %d", resp.StatusCode)
		}
		clientConn.WriteJSON(map[string]string{
			"type":    "error",
			"message": "Failed to connect to AI service",
		})
		return
	}
	defer agentConn.Close()
	log.Printf("🤖 Connected to AI Agent: %s", agentWSURL)

	// Step 5: PIPE - Bidirectional message forwarding
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	errChan := make(chan error, 2)

	// Goroutine 1: Client → Agent
	wg.Add(1)
	go func() {
		defer wg.Done()
		errChan <- pipeMessages(ctx, clientConn, agentConn, "Client→Agent")
	}()

	// Goroutine 2: Agent → Client
	wg.Add(1)
	go func() {
		defer wg.Done()
		errChan <- pipeMessages(ctx, agentConn, clientConn, "Agent→Client")
	}()

	// Wait for first error or disconnect
	err = <-errChan
	if err != nil && err != io.EOF {
		log.Printf("⚠️  Connection error: %v", err)
	}

	cancel() // Signal other goroutine to stop
	wg.Wait()
	log.Printf("🔌 Proxy connection closed")
}

// pipeMessages forwards messages from src to dst
func pipeMessages(ctx context.Context, src, dst *websocket.Conn, direction string) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			// Set read deadline to detect disconnects
			src.SetReadDeadline(time.Now().Add(60 * time.Second))

			messageType, payload, err := src.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("❌ %s read error: %v", direction, err)
				}
				return err
			}

			// Simple logging (can be enhanced later)
			log.Printf("📨 %s: %d bytes (type: %d)", direction, len(payload), messageType)

			// Set write deadline
			dst.SetWriteDeadline(time.Now().Add(10 * time.Second))

			// Forward message
			if err := dst.WriteMessage(messageType, payload); err != nil {
				log.Printf("❌ %s write error: %v", direction, err)
				return err
			}
		}
	}
}

