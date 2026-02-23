package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

// setupTestRouter creates a test router with proxy handler
func setupTestRouter() (*gin.Engine, *services.AgentRegistry) {
	gin.SetMode(gin.TestMode)
	router := gin.New()

	registry := services.NewAgentRegistry()
	handler := NewAIProxyHandler(registry)

	router.GET("/ws/proxy", handler.ProxyWebSocket)

	return router, registry
}

// TestProxyWebSocket_MissingProjectID tests missing project_id parameter
func TestProxyWebSocket_MissingProjectID(t *testing.T) {
	router, _ := setupTestRouter()

	// Request without project_id
	req := httptest.NewRequest("GET", "/ws/proxy", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Should return 400 Bad Request
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}

	// Check error message
	body := w.Body.String()
	if !strings.Contains(body, "project_id") {
		t.Errorf("Expected error about project_id, got: %s", body)
	}
}

// TestProxyWebSocket_ProjectNotFound tests non-existent project
func TestProxyWebSocket_ProjectNotFound(t *testing.T) {
	router, _ := setupTestRouter()

	// Request with non-existent project
	req := httptest.NewRequest("GET", "/ws/proxy?project_id=non-existent", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Should return 503 Service Unavailable
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503, got %d", w.Code)
	}

	// Check error message
	body := w.Body.String()
	if !strings.Contains(body, "not available") {
		t.Errorf("Expected error about agent not available, got: %s", body)
	}
}

// TestProxyWebSocket_ValidProject tests successful project lookup
// Note: WebSocket upgrade cannot be fully tested with httptest.ResponseRecorder
// This test verifies routing logic without actual WebSocket connection
func TestProxyWebSocket_ValidProject(t *testing.T) {
	// This test is skipped because WebSocket upgrade requires real HTTP server
	// Routing logic is tested in other test cases (NotFound, Unhealthy, etc.)
	// Integration tests with real server should be added separately
	t.Skip("WebSocket upgrade requires real HTTP server, see integration tests")
}

// TestProxyWebSocket_UnhealthyAgent tests unhealthy agent
func TestProxyWebSocket_UnhealthyAgent(t *testing.T) {
	router, registry := setupTestRouter()

	// Register agent and mark unhealthy
	registry.Register("test-project", "test-org", "localhost", "8002")
	registry.MarkUnhealthy("test-project")

	// Request with unhealthy agent
	req := httptest.NewRequest("GET", "/ws/proxy?project_id=test-project", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Should return 503
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503 for unhealthy agent, got %d", w.Code)
	}
}

// TestProxyWebSocket_MultipleProjects tests routing logic for different projects
func TestProxyWebSocket_MultipleProjects(t *testing.T) {
	router, registry := setupTestRouter()

	// Register multiple agents
	registry.Register("project-1", "org-1", "host1", "8002")
	registry.Register("project-2", "org-1", "host2", "8002")
	registry.Register("project-3", "org-2", "host3", "8002")

	testCases := []struct {
		projectID    string
		expectedCode int
		description  string
	}{
		{"project-4", http.StatusServiceUnavailable, "Should fail for non-existent project"},
	}

	for _, tc := range testCases {
		t.Run(tc.description, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/ws/proxy?project_id="+tc.projectID, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tc.expectedCode {
				t.Errorf("Expected %d for %s, got %d", tc.expectedCode, tc.projectID, w.Code)
			}
		})
	}

	// Test that agents are registered correctly
	url1, _ := registry.GetAgentURL("project-1")
	url2, _ := registry.GetAgentURL("project-2")
	url3, _ := registry.GetAgentURL("project-3")

	if url1 != "ws://host1:8002" {
		t.Errorf("Expected project-1 to route to host1:8002, got %s", url1)
	}
	if url2 != "ws://host2:8002" {
		t.Errorf("Expected project-2 to route to host2:8002, got %s", url2)
	}
	if url3 != "ws://host3:8002" {
		t.Errorf("Expected project-3 to route to host3:8002, got %s", url3)
	}
}

// TestProxyWebSocket_ConcurrentRequests tests handling multiple concurrent requests
func TestProxyWebSocket_ConcurrentRequests(t *testing.T) {
	router, registry := setupTestRouter()

	// Register agents
	registry.Register("project-1", "org-1", "localhost", "8002")
	registry.Register("project-2", "org-1", "localhost", "8003")

	// Simulate concurrent requests
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			projectID := "project-1"
			if id%2 == 0 {
				projectID = "project-2"
			}

			req := httptest.NewRequest("GET", "/ws/proxy?project_id="+projectID, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			// Should not panic or return 503
			if w.Code == http.StatusServiceUnavailable {
				t.Errorf("Concurrent request %d failed with 503", id)
			}

			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}

// TestProxyWebSocket_QueryParams tests query parameter extraction
func TestProxyWebSocket_QueryParams(t *testing.T) {
	router, registry := setupTestRouter()
	registry.Register("test-project", "test-org", "localhost", "8002")

	testCases := []struct {
		url          string
		expectedCode int
		description  string
	}{
		{
			"/ws/proxy?token=abc&org_id=org123",
			http.StatusBadRequest,
			"Missing project_id",
		},
		{
			"/ws/proxy",
			http.StatusBadRequest,
			"No params",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.description, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.url, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tc.expectedCode {
				t.Errorf("Expected %d for %s, got %d", tc.expectedCode, tc.description, w.Code)
			}
		})
	}
}

// TestProxyWebSocket_ProtocolDetection tests protocol parameter validation
func TestProxyWebSocket_ProtocolDetection(t *testing.T) {
	router, registry := setupTestRouter()
	registry.Register("test-project", "test-org", "localhost", "8002")

	// Test invalid protocol (should return 400)
	req := httptest.NewRequest("GET", "/ws/proxy?project_id=test-project&protocol=invalid", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for invalid protocol, got %d", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, "Invalid protocol") {
		t.Errorf("Expected error message about invalid protocol, got: %s", body)
	}
}
