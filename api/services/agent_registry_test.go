package services

import (
	"sync"
	"testing"
)

// TestAgentRegistry_Register tests basic agent registration
func TestAgentRegistry_Register(t *testing.T) {
	registry := NewAgentRegistry()

	// Register an agent
	registry.Register("project-1", "org-1", "localhost", "8002")

	// Verify it was registered
	url, err := registry.GetAgentURL("project-1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	expected := "ws://localhost:8002"
	if url != expected {
		t.Errorf("Expected URL %s, got %s", expected, url)
	}
}

// TestAgentRegistry_GetAgentURL_NotFound tests error when project not found
func TestAgentRegistry_GetAgentURL_NotFound(t *testing.T) {
	registry := NewAgentRegistry()

	// Try to get agent for non-existent project
	_, err := registry.GetAgentURL("non-existent-project")
	if err == nil {
		t.Fatal("Expected error for non-existent project, got nil")
	}

	expectedMsg := "no agent found for project"
	if !contains(err.Error(), expectedMsg) {
		t.Errorf("Expected error message to contain '%s', got: %s", expectedMsg, err.Error())
	}
}

// TestAgentRegistry_MarkUnhealthy tests marking agent as unhealthy
func TestAgentRegistry_MarkUnhealthy(t *testing.T) {
	registry := NewAgentRegistry()

	// Register agent
	registry.Register("project-1", "org-1", "localhost", "8002")

	// Mark as unhealthy
	registry.MarkUnhealthy("project-1")

	// Should return error
	_, err := registry.GetAgentURL("project-1")
	if err == nil {
		t.Fatal("Expected error for unhealthy agent, got nil")
	}

	expectedMsg := "unhealthy"
	if !contains(err.Error(), expectedMsg) {
		t.Errorf("Expected error message to contain '%s', got: %s", expectedMsg, err.Error())
	}
}

// TestAgentRegistry_MarkHealthy tests marking agent back as healthy
func TestAgentRegistry_MarkHealthy(t *testing.T) {
	registry := NewAgentRegistry()

	// Register and mark unhealthy
	registry.Register("project-1", "org-1", "localhost", "8002")
	registry.MarkUnhealthy("project-1")

	// Mark back as healthy
	registry.MarkHealthy("project-1")

	// Should work now
	url, err := registry.GetAgentURL("project-1")
	if err != nil {
		t.Fatalf("Expected no error after marking healthy, got: %v", err)
	}

	if url != "ws://localhost:8002" {
		t.Errorf("Expected URL ws://localhost:8002, got %s", url)
	}
}

// TestAgentRegistry_Unregister tests agent unregistration
func TestAgentRegistry_Unregister(t *testing.T) {
	registry := NewAgentRegistry()

	// Register and then unregister
	registry.Register("project-1", "org-1", "localhost", "8002")
	registry.Unregister("project-1")

	// Should not be found
	_, err := registry.GetAgentURL("project-1")
	if err == nil {
		t.Fatal("Expected error after unregister, got nil")
	}
}

// TestAgentRegistry_ListAgents tests listing all agents
func TestAgentRegistry_ListAgents(t *testing.T) {
	registry := NewAgentRegistry()

	// Register multiple agents
	registry.Register("project-1", "org-1", "host1", "8002")
	registry.Register("project-2", "org-1", "host2", "8002")
	registry.Register("project-3", "org-2", "host3", "8002")

	// List all
	agents := registry.ListAgents()

	if len(agents) != 3 {
		t.Errorf("Expected 3 agents, got %d", len(agents))
	}

	// Verify project IDs are present
	projectIDs := make(map[string]bool)
	for _, agent := range agents {
		projectIDs[agent.ProjectID] = true
	}

	for _, pid := range []string{"project-1", "project-2", "project-3"} {
		if !projectIDs[pid] {
			t.Errorf("Expected to find project %s in list", pid)
		}
	}
}

// TestAgentRegistry_ConcurrentAccess tests thread safety
func TestAgentRegistry_ConcurrentAccess(t *testing.T) {
	registry := NewAgentRegistry()

	// Register initial agent
	registry.Register("project-1", "org-1", "localhost", "8002")

	var wg sync.WaitGroup
	numGoroutines := 100

	// Concurrent reads
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()
			_, err := registry.GetAgentURL("project-1")
			if err != nil {
				t.Errorf("Concurrent read failed: %v", err)
			}
		}()
	}

	// Concurrent writes
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		projectID := "project-" + string(rune(i))
		go func(pid string) {
			defer wg.Done()
			registry.Register(pid, "org-1", "localhost", "8002")
		}(projectID)
	}

	// Wait for all goroutines
	wg.Wait()

	// Should have at least 1 agent (project-1)
	agents := registry.ListAgents()
	if len(agents) < 1 {
		t.Errorf("Expected at least 1 agent after concurrent access, got %d", len(agents))
	}
}

// TestAgentRegistry_UpdateExisting tests updating an existing agent
func TestAgentRegistry_UpdateExisting(t *testing.T) {
	registry := NewAgentRegistry()

	// Register agent
	registry.Register("project-1", "org-1", "host1", "8002")

	// Update (re-register with new host)
	registry.Register("project-1", "org-1", "host2", "8003")

	// Should return new URL
	url, err := registry.GetAgentURL("project-1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	expected := "ws://host2:8003"
	if url != expected {
		t.Errorf("Expected updated URL %s, got %s", expected, url)
	}
}

// Helper function
func contains(s, substr string) bool {
	return len(s) >= len(substr) && s[:len(substr)] == substr ||
		   len(s) > len(substr) && containsRec(s[1:], substr)
}

func containsRec(s, substr string) bool {
	if len(s) < len(substr) {
		return false
	}
	if s[:len(substr)] == substr {
		return true
	}
	return containsRec(s[1:], substr)
}
