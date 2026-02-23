package handlers

import (
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/vanchonlee/slar/services"
)

// mockUserService wraps a real UserService with a mock database
type mockUserService struct {
	*services.UserService
	mock sqlmock.Sqlmock
}

func newMockUserService(t *testing.T) (*mockUserService, func()) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	return &mockUserService{
		UserService: services.NewUserService(db),
		mock:        mock,
	}, func() { db.Close() }
}

func TestEnsureUserExistsByEmail_ExistingUser(t *testing.T) {
	// Test: User exists with same email but different provider_sub
	// Expected: Use existing user ID, link new identity

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	userService := services.NewUserService(db)

	// Create middleware (without OIDC auth - we're testing user lookup logic)
	middleware := &OIDCAuthMiddleware{
		OIDCAuth:    nil,
		UserService: userService,
	}

	claims := &services.OIDCClaims{
		UserID: "new-cf-access-sub",
		Email:  "user@company.com",
		Name:   "Test User",
	}

	// Mock: User found by email
	existingUserID := "existing-user-uuid-123"
	rows := sqlmock.NewRows([]string{
		"id", "provider", "provider_id", "name", "email",
		"phone", "role", "team", "fcm_token",
		"is_active", "created_at", "updated_at",
	}).AddRow(
		existingUserID, "oidc", "old-google-sub", "Test User", "user@company.com",
		"", "engineer", "Platform", "",
		true, time.Now(), time.Now(),
	)
	mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
		WithArgs("user@company.com").
		WillReturnRows(rows)

	// Mock: Link new identity
	mock.ExpectExec("INSERT INTO user_identities").
		WithArgs(existingUserID, "oidc", "new-cf-access-sub", "user@company.com").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Execute
	userID, err := middleware.ensureUserExistsByEmail(claims, false)

	// Verify
	if err != nil {
		t.Fatalf("ensureUserExistsByEmail() error = %v", err)
	}
	if userID != existingUserID {
		t.Errorf("ensureUserExistsByEmail() = %v, want %v", userID, existingUserID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestEnsureUserExistsByEmail_NewUser(t *testing.T) {
	// Test: User does not exist
	// Expected: Create new user with random UUID

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	userService := services.NewUserService(db)

	middleware := &OIDCAuthMiddleware{
		OIDCAuth:    nil,
		UserService: userService,
	}

	claims := &services.OIDCClaims{
		UserID: "new-provider-sub",
		Email:  "newuser@company.com",
		Name:   "New User",
	}

	// Mock: User NOT found by email
	mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
		WithArgs("newuser@company.com").
		WillReturnError(sql.ErrNoRows)

	// Mock: Create new user (any UUID)
	mock.ExpectExec("INSERT INTO users").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock: Link identity for new user
	mock.ExpectExec("INSERT INTO user_identities").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Execute
	userID, err := middleware.ensureUserExistsByEmail(claims, false)

	// Verify
	if err != nil {
		t.Fatalf("ensureUserExistsByEmail() error = %v", err)
	}
	if userID == "" {
		t.Error("ensureUserExistsByEmail() returned empty user ID")
	}

	// User ID should be a valid UUID (36 chars with dashes)
	if len(userID) != 36 {
		t.Errorf("ensureUserExistsByEmail() returned invalid UUID: %v", userID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestEnsureUserExistsByEmail_MissingEmail(t *testing.T) {
	// Test: Email is missing in claims
	// Expected: Return error

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	userService := services.NewUserService(db)

	middleware := &OIDCAuthMiddleware{
		OIDCAuth:    nil,
		UserService: userService,
	}

	claims := &services.OIDCClaims{
		UserID: "some-provider-sub",
		Email:  "", // Empty email
		Name:   "User Without Email",
	}

	// Execute
	_, err = middleware.ensureUserExistsByEmail(claims, false)

	// Verify: Should return error
	if err == nil {
		t.Error("ensureUserExistsByEmail() should return error for missing email")
	}
}

func TestEnsureUserExistsByEmail_UpdateProfileOnFreshLogin(t *testing.T) {
	// Test: Existing user with updateProfile=true should update name

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	userService := services.NewUserService(db)

	middleware := &OIDCAuthMiddleware{
		OIDCAuth:    nil,
		UserService: userService,
	}

	claims := &services.OIDCClaims{
		UserID: "same-provider-sub",
		Email:  "user@company.com",
		Name:   "Updated Name", // Name changed
	}

	existingUserID := "existing-user-uuid"

	// Mock: User found with old name
	rows := sqlmock.NewRows([]string{
		"id", "provider", "provider_id", "name", "email",
		"phone", "role", "team", "fcm_token",
		"is_active", "created_at", "updated_at",
	}).AddRow(
		existingUserID, "oidc", "same-provider-sub", "Old Name", "user@company.com",
		"", "engineer", "Platform", "",
		true, time.Now(), time.Now(),
	)
	mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
		WithArgs("user@company.com").
		WillReturnRows(rows)

	// Mock: Link identity
	mock.ExpectExec("INSERT INTO user_identities").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Mock: Update user profile (name changed)
	mock.ExpectExec("INSERT INTO users").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Execute with updateProfile=true
	userID, err := middleware.ensureUserExistsByEmail(claims, true)

	// Verify
	if err != nil {
		t.Fatalf("ensureUserExistsByEmail() error = %v", err)
	}
	if userID != existingUserID {
		t.Errorf("ensureUserExistsByEmail() = %v, want %v", userID, existingUserID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestOidcSubToUUID(t *testing.T) {
	// Test that oidcSubToUUID still works (backward compatibility)
	tests := []struct {
		name string
		sub  string
		want string
	}{
		{
			name: "already valid UUID",
			sub:  "550e8400-e29b-41d4-a716-446655440000",
			want: "550e8400-e29b-41d4-a716-446655440000",
		},
		{
			name: "non-UUID sub - generates deterministic UUID",
			sub:  "google|123456789",
			want: oidcSubToUUID("google|123456789"), // Should be deterministic
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := oidcSubToUUID(tt.sub)
			if got != tt.want {
				t.Errorf("oidcSubToUUID() = %v, want %v", got, tt.want)
			}

			// Verify determinism: same input = same output
			got2 := oidcSubToUUID(tt.sub)
			if got != got2 {
				t.Errorf("oidcSubToUUID() not deterministic: %v != %v", got, got2)
			}
		})
	}
}

// TestMultiProviderAuthenticationFlow tests the complete flow
func TestMultiProviderAuthenticationFlow(t *testing.T) {
	t.Run("same user logging in from Google then CF Access", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("failed to create mock: %v", err)
		}
		defer db.Close()

		userService := services.NewUserService(db)
		middleware := &OIDCAuthMiddleware{
			OIDCAuth:    nil,
			UserService: userService,
		}

		email := "engineer@company.com"
		existingUserID := "user-uuid-from-first-login"

		// Scenario: User first logged in with Google (user already exists)
		// Now logging in with CF Access

		// Step 1: CF Access login - lookup by email finds existing user
		rows := sqlmock.NewRows([]string{
			"id", "provider", "provider_id", "name", "email",
			"phone", "role", "team", "fcm_token",
			"is_active", "created_at", "updated_at",
		}).AddRow(
			existingUserID, "oidc", "google-sub-original", "Engineer Name", email,
			"", "engineer", "Platform", "",
			true, time.Now(), time.Now(),
		)
		mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
			WithArgs(email).
			WillReturnRows(rows)

		// Step 2: Link CF Access identity to existing user
		mock.ExpectExec("INSERT INTO user_identities").
			WithArgs(existingUserID, "oidc", "cf-access-sub-new", email).
			WillReturnResult(sqlmock.NewResult(1, 1))

		cfAccessClaims := &services.OIDCClaims{
			UserID: "cf-access-sub-new",
			Email:  email,
			Name:   "Engineer Name",
		}

		userID, err := middleware.ensureUserExistsByEmail(cfAccessClaims, false)
		if err != nil {
			t.Fatalf("ensureUserExistsByEmail() error = %v", err)
		}

		// Verify: Same user ID is returned (not a new user created)
		if userID != existingUserID {
			t.Errorf("Expected existing user ID %s, got %s", existingUserID, userID)
		}

		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled expectations: %v", err)
		}
	})
}
