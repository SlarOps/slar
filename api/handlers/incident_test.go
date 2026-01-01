package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/vanchonlee/slar/authz"
	"github.com/vanchonlee/slar/services"
)

// MockAuthorizer
type MockAuthorizer struct {
	mock.Mock
}

func (m *MockAuthorizer) Check(ctx context.Context, userID string, action authz.Action, resourceType authz.ResourceType, resourceID string) bool {
	args := m.Called(ctx, userID, action, resourceType, resourceID)
	return args.Bool(0)
}

func (m *MockAuthorizer) CanAccessOrg(ctx context.Context, userID, orgID string) bool {
	args := m.Called(ctx, userID, orgID)
	return args.Bool(0)
}

func (m *MockAuthorizer) CanAccessProject(ctx context.Context, userID, projectID string) bool {
	args := m.Called(ctx, userID, projectID)
	return args.Bool(0)
}

func (m *MockAuthorizer) CanPerformOrgAction(ctx context.Context, userID, orgID string, action authz.Action) bool {
	args := m.Called(ctx, userID, orgID, action)
	return args.Bool(0)
}

func (m *MockAuthorizer) CanPerformProjectAction(ctx context.Context, userID, projectID string, action authz.Action) bool {
	args := m.Called(ctx, userID, projectID, action)
	return args.Bool(0)
}

func (m *MockAuthorizer) GetOrgRole(ctx context.Context, userID, orgID string) authz.Role {
	args := m.Called(ctx, userID, orgID)
	return args.Get(0).(authz.Role)
}

func (m *MockAuthorizer) GetProjectRole(ctx context.Context, userID, projectID string) authz.Role {
	args := m.Called(ctx, userID, projectID)
	return args.Get(0).(authz.Role)
}

// MockProjectService (minimal for testing)
type MockProjectService struct {
	mock.Mock
}

// MockIncidentService (we need to mock the service layer too, but it's a struct not interface)
// For unit testing handlers, we usually need to mock the service.
// However, IncidentService is a struct. We might need to integration test or refactor service to interface.
// For now, let's try to run a basic test that fails if dependencies aren't set up,
// just to verify the handler structure.
// Actually, since IncidentService is a struct, we can't easily mock it without an interface.
// But we can test the `checkIncidentAccess` logic if we can control the service response.
// Or we can create a real IncidentService with a mocked DB? That's integration testing.

// Let's create a test that focuses on the Authorizer interaction, assuming we can
// somehow inject a mock service or use a real one with a mocked DB.
// Since `IncidentService` uses `*sql.DB`, we can use `DATA-DOG/go-sqlmock`.

func TestIncidentHandler_GetIncident_ReBAC(t *testing.T) {
	// Setup Gin
	gin.SetMode(gin.TestMode)

	// Setup SQL Mock
	db, mockDB, err := sqlmock.New()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database connection", err)
	}
	defer db.Close()

	// Setup Mocks
	mockAuthorizer := new(MockAuthorizer)
	mockProjectService := &authz.ProjectService{} // We might need to mock this if used, but for GetIncident it's not used directly

	// Create Service with mocked DB
	// Note: We need to initialize the service with dependencies.
	// Since we can't easily mock the internal fields of IncidentService (like Redis/FCM),
	// we'll pass nil for them as they shouldn't be used in GetIncident (read-only).
	incidentService := services.NewIncidentService(db, nil, nil)
	serviceService := services.NewServiceService(db) // For routing_key lookup

	// Create Handler
	handler := NewIncidentHandler(incidentService, serviceService, mockProjectService, mockAuthorizer, nil)

	// Test Case 1: User has project access (Allowed)
	t.Run("Allowed_ProjectAccess", func(t *testing.T) {
		// Mock DB response for GetIncident
		rows := sqlmock.NewRows([]string{
			"id", "title", "description", "status", "urgency", "priority",
			"created_at", "updated_at", "assigned_to", "assigned_at",
			"acknowledged_by", "acknowledged_at", "resolved_by", "resolved_at",
			"source", "integration_id", "service_id", "external_id", "external_url",
			"escalation_policy_id", "current_escalation_level", "last_escalated_at",
			"escalation_status", "group_id", "api_key_id", "severity", "incident_key",
			"alert_count", "labels", "custom_fields",
			"organization_id", "project_id",
			"assigned_to_name", "assigned_to_email",
			"acknowledged_by_name", "acknowledged_by_email",
			"resolved_by_name", "resolved_by_email",
			"group_name", "service_name", "escalation_policy_name",
		}).AddRow(
			"inc-1", "Test Incident", "Desc", "triggered", "high", "P1",
			time.Now(), time.Now(), nil, nil,
			nil, nil, nil, nil,
			"manual", nil, nil, nil, nil,
			nil, 0, nil,
			"pending", nil, nil, "critical", "key-1",
			1, nil, nil,
			"org-1", "proj-1",
			nil, nil, nil, nil, nil, nil, nil, nil, nil,
		)

		mockDB.ExpectQuery("SELECT .* FROM incidents").WithArgs("inc-1").WillReturnRows(rows)

		// Mock Authorizer response
		mockAuthorizer.On("Check", mock.Anything, "user-1", authz.ActionView, authz.ResourceProject, "proj-1").Return(true)

		// Make Request
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request, _ = http.NewRequest("GET", "/incidents/inc-1", nil)
		c.Set("user_id", "user-1")
		c.Params = []gin.Param{{Key: "id", Value: "inc-1"}}

		handler.GetIncident(c)

		// Assertions
		if w.Code != http.StatusOK {
			t.Logf("Response Body: %s", w.Body.String())
		}
		assert.Equal(t, http.StatusOK, w.Code)
		mockAuthorizer.AssertExpectations(t)
	})

	// Test Case 2: User has NO project access (Forbidden)
	t.Run("Forbidden_NoAccess", func(t *testing.T) {
		// Mock DB response for GetIncident
		rows := sqlmock.NewRows([]string{
			"id", "title", "description", "status", "urgency", "priority",
			"created_at", "updated_at", "assigned_to", "assigned_at",
			"acknowledged_by", "acknowledged_at", "resolved_by", "resolved_at",
			"source", "integration_id", "service_id", "external_id", "external_url",
			"escalation_policy_id", "current_escalation_level", "last_escalated_at",
			"escalation_status", "group_id", "api_key_id", "severity", "incident_key",
			"alert_count", "labels", "custom_fields",
			"organization_id", "project_id",
			"assigned_to_name", "assigned_to_email",
			"acknowledged_by_name", "acknowledged_by_email",
			"resolved_by_name", "resolved_by_email",
			"group_name", "service_name", "escalation_policy_name",
		}).AddRow(
			"inc-2", "Test Incident 2", "Desc", "triggered", "high", "P1",
			time.Now(), time.Now(), nil, nil,
			nil, nil, nil, nil,
			"manual", nil, nil, nil, nil,
			nil, 0, nil,
			"pending", nil, nil, "critical", "key-2",
			1, nil, nil,
			"org-1", "proj-2",
			nil, nil, nil, nil, nil, nil, nil, nil, nil,
		)

		mockDB.ExpectQuery("SELECT .* FROM incidents").WithArgs("inc-2").WillReturnRows(rows)

		// Mock Authorizer response
		mockAuthorizer.On("Check", mock.Anything, "user-1", authz.ActionView, authz.ResourceProject, "proj-2").Return(false)

		// Make Request
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request, _ = http.NewRequest("GET", "/incidents/inc-2", nil)
		c.Set("user_id", "user-1")
		c.Params = []gin.Param{{Key: "id", Value: "inc-2"}}

		handler.GetIncident(c)

		// Assertions
		if w.Code != http.StatusForbidden {
			t.Logf("Response Body: %s", w.Body.String())
		}
		assert.Equal(t, http.StatusForbidden, w.Code)
		mockAuthorizer.AssertExpectations(t)
	})

	// Test Case 3: Ad-hoc Access (Assigned User)
	t.Run("Allowed_AdHocAccess", func(t *testing.T) {
		// Mock DB response for GetIncident - Assigned to user-1
		rows := sqlmock.NewRows([]string{
			"id", "title", "description", "status", "urgency", "priority",
			"created_at", "updated_at", "assigned_to", "assigned_at",
			"acknowledged_by", "acknowledged_at", "resolved_by", "resolved_at",
			"source", "integration_id", "service_id", "external_id", "external_url",
			"escalation_policy_id", "current_escalation_level", "last_escalated_at",
			"escalation_status", "group_id", "api_key_id", "severity", "incident_key",
			"alert_count", "labels", "custom_fields",
			"organization_id", "project_id",
			"assigned_to_name", "assigned_to_email",
			"acknowledged_by_name", "acknowledged_by_email",
			"resolved_by_name", "resolved_by_email",
			"group_name", "service_name", "escalation_policy_name",
		}).AddRow(
			"inc-3", "Test Incident 3", "Desc", "triggered", "high", "P1",
			time.Now(), time.Now(), "user-1", time.Now(),
			nil, nil, nil, nil,
			"manual", nil, nil, nil, nil,
			nil, 0, nil,
			"pending", nil, nil, "critical", "key-3",
			1, nil, nil,
			"org-1", "proj-3",
			"User One", "user1@example.com", nil, nil, nil, nil, nil, nil, nil,
		)

		mockDB.ExpectQuery("SELECT .* FROM incidents").WithArgs("inc-3").WillReturnRows(rows)

		// Mock Authorizer NOT called because ad-hoc check passes first
		// (No expectation set for Check)

		// Make Request
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request, _ = http.NewRequest("GET", "/incidents/inc-3", nil)
		c.Set("user_id", "user-1")
		c.Params = []gin.Param{{Key: "id", Value: "inc-3"}}

		handler.GetIncident(c)

		// Assertions
		assert.Equal(t, http.StatusOK, w.Code)
	})
}
