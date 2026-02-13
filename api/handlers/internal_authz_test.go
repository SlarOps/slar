package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/mock"
	"github.com/vanchonlee/slar/authz"
)

// setupInternalAuthzTest creates a test router with InternalAuthzHandler.
// MockAuthorizer is defined in incident_test.go (same package).
func setupInternalAuthzTest(authorizer authz.Authorizer) *gin.Engine {
	handler := NewInternalAuthzHandler(authorizer)
	r := gin.New()

	internal := r.Group("/internal/authz")
	{
		internal.GET("/org/:org_id/role", handler.GetOrgRole)
		internal.GET("/project/:project_id/role", handler.GetProjectRole)
		internal.POST("/check", handler.CheckAccess)
	}

	return r
}

// ============================================================================
// GET /internal/authz/org/:org_id/role?user_id=xxx
// ============================================================================

func TestInternalAuthz_GetOrgRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		orgID      string
		userID     string
		setupMock  func(*MockAuthorizer)
		wantStatus int
		wantRole   string
	}{
		{
			name:   "owner gets owner role",
			orgID:  "org-1",
			userID: "user-owner",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetOrgRole", mock.Anything, "user-owner", "org-1").Return(authz.RoleOwner)
			},
			wantStatus: http.StatusOK,
			wantRole:   "owner",
		},
		{
			name:   "admin gets admin role",
			orgID:  "org-1",
			userID: "user-admin",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetOrgRole", mock.Anything, "user-admin", "org-1").Return(authz.RoleAdmin)
			},
			wantStatus: http.StatusOK,
			wantRole:   "admin",
		},
		{
			name:   "member gets member role",
			orgID:  "org-1",
			userID: "user-member",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetOrgRole", mock.Anything, "user-member", "org-1").Return(authz.RoleMember)
			},
			wantStatus: http.StatusOK,
			wantRole:   "member",
		},
		{
			name:   "viewer gets viewer role",
			orgID:  "org-1",
			userID: "user-viewer",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetOrgRole", mock.Anything, "user-viewer", "org-1").Return(authz.RoleViewer)
			},
			wantStatus: http.StatusOK,
			wantRole:   "viewer",
		},
		{
			name:   "outsider gets 404",
			orgID:  "org-1",
			userID: "user-outsider",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetOrgRole", mock.Anything, "user-outsider", "org-1").Return(authz.Role(""))
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "missing user_id returns 400",
			orgID:      "org-1",
			userID:     "",
			setupMock:  func(m *MockAuthorizer) {},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAuthz := new(MockAuthorizer)
			tt.setupMock(mockAuthz)

			router := setupInternalAuthzTest(mockAuthz)

			url := "/internal/authz/org/" + tt.orgID + "/role"
			if tt.userID != "" {
				url += "?user_id=" + tt.userID
			}

			req, _ := http.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", w.Code, tt.wantStatus, w.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var resp map[string]interface{}
				if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
					t.Fatalf("failed to parse response: %v", err)
				}
				if resp["role"] != tt.wantRole {
					t.Errorf("role = %v, want %v", resp["role"], tt.wantRole)
				}
			}

			mockAuthz.AssertExpectations(t)
		})
	}
}

// ============================================================================
// GET /internal/authz/project/:project_id/role?user_id=xxx
// ============================================================================

func TestInternalAuthz_GetProjectRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		projectID  string
		userID     string
		setupMock  func(*MockAuthorizer)
		wantStatus int
		wantRole   string
	}{
		{
			name:      "org owner gets admin on project (inherited)",
			projectID: "proj-1",
			userID:    "user-org-owner",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetProjectRole", mock.Anything, "user-org-owner", "proj-1").Return(authz.RoleAdmin)
			},
			wantStatus: http.StatusOK,
			wantRole:   "admin",
		},
		{
			name:      "explicit project member gets member role",
			projectID: "proj-1",
			userID:    "user-proj-member",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetProjectRole", mock.Anything, "user-proj-member", "proj-1").Return(authz.RoleMember)
			},
			wantStatus: http.StatusOK,
			wantRole:   "member",
		},
		{
			name:      "explicit project admin gets admin role",
			projectID: "proj-1",
			userID:    "user-proj-admin",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetProjectRole", mock.Anything, "user-proj-admin", "proj-1").Return(authz.RoleAdmin)
			},
			wantStatus: http.StatusOK,
			wantRole:   "admin",
		},
		{
			name:      "outsider gets 404",
			projectID: "proj-1",
			userID:    "user-outsider",
			setupMock: func(m *MockAuthorizer) {
				m.On("GetProjectRole", mock.Anything, "user-outsider", "proj-1").Return(authz.Role(""))
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "missing user_id returns 400",
			projectID:  "proj-1",
			userID:     "",
			setupMock:  func(m *MockAuthorizer) {},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAuthz := new(MockAuthorizer)
			tt.setupMock(mockAuthz)

			router := setupInternalAuthzTest(mockAuthz)

			url := "/internal/authz/project/" + tt.projectID + "/role"
			if tt.userID != "" {
				url += "?user_id=" + tt.userID
			}

			req, _ := http.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", w.Code, tt.wantStatus, w.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var resp map[string]interface{}
				if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
					t.Fatalf("failed to parse response: %v", err)
				}
				if resp["role"] != tt.wantRole {
					t.Errorf("role = %v, want %v", resp["role"], tt.wantRole)
				}
			}

			mockAuthz.AssertExpectations(t)
		})
	}
}

// ============================================================================
// POST /internal/authz/check
// ============================================================================

func TestInternalAuthz_CheckAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name        string
		body        map[string]string
		setupMock   func(*MockAuthorizer)
		wantStatus  int
		wantAllowed bool
	}{
		{
			name: "owner can delete org",
			body: map[string]string{
				"user_id":       "user-owner",
				"resource_type": "org",
				"resource_id":   "org-1",
				"action":        "delete",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-owner", authz.ActionDelete, authz.ResourceOrg, "org-1").Return(true)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: true,
		},
		{
			name: "admin cannot delete org",
			body: map[string]string{
				"user_id":       "user-admin",
				"resource_type": "org",
				"resource_id":   "org-1",
				"action":        "delete",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-admin", authz.ActionDelete, authz.ResourceOrg, "org-1").Return(false)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: false,
		},
		{
			name: "admin can manage org",
			body: map[string]string{
				"user_id":       "user-admin",
				"resource_type": "org",
				"resource_id":   "org-1",
				"action":        "manage",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-admin", authz.ActionManage, authz.ResourceOrg, "org-1").Return(true)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: true,
		},
		{
			name: "member can view project",
			body: map[string]string{
				"user_id":       "user-member",
				"resource_type": "project",
				"resource_id":   "proj-1",
				"action":        "view",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-member", authz.ActionView, authz.ResourceProject, "proj-1").Return(true)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: true,
		},
		{
			name: "member cannot delete project",
			body: map[string]string{
				"user_id":       "user-member",
				"resource_type": "project",
				"resource_id":   "proj-1",
				"action":        "delete",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-member", authz.ActionDelete, authz.ResourceProject, "proj-1").Return(false)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: false,
		},
		{
			name: "outsider cannot view org",
			body: map[string]string{
				"user_id":       "user-outsider",
				"resource_type": "org",
				"resource_id":   "org-1",
				"action":        "view",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-outsider", authz.ActionView, authz.ResourceOrg, "org-1").Return(false)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: false,
		},
		{
			name: "missing user_id returns 400",
			body: map[string]string{
				"resource_type": "org",
				"resource_id":   "org-1",
				"action":        "view",
			},
			setupMock:  func(m *MockAuthorizer) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing resource_type returns 400",
			body: map[string]string{
				"user_id":     "user-1",
				"resource_id": "org-1",
				"action":      "view",
			},
			setupMock:  func(m *MockAuthorizer) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing action returns 400",
			body: map[string]string{
				"user_id":       "user-1",
				"resource_type": "org",
				"resource_id":   "org-1",
			},
			setupMock:  func(m *MockAuthorizer) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "unknown resource_type returns allowed=false",
			body: map[string]string{
				"user_id":       "user-1",
				"resource_type": "unknown",
				"resource_id":   "res-1",
				"action":        "view",
			},
			setupMock: func(m *MockAuthorizer) {
				m.On("Check", mock.Anything, "user-1", authz.ActionView, authz.ResourceType("unknown"), "res-1").Return(false)
			},
			wantStatus:  http.StatusOK,
			wantAllowed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockAuthz := new(MockAuthorizer)
			tt.setupMock(mockAuthz)

			router := setupInternalAuthzTest(mockAuthz)

			bodyBytes, _ := json.Marshal(tt.body)
			req, _ := http.NewRequest("POST", "/internal/authz/check", bytes.NewBuffer(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", w.Code, tt.wantStatus, w.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var resp map[string]interface{}
				if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
					t.Fatalf("failed to parse response: %v", err)
				}
				allowed, ok := resp["allowed"].(bool)
				if !ok {
					t.Fatalf("response missing 'allowed' field: %v", resp)
				}
				if allowed != tt.wantAllowed {
					t.Errorf("allowed = %v, want %v", allowed, tt.wantAllowed)
				}
			}

			mockAuthz.AssertExpectations(t)
		})
	}
}

