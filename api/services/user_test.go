package services

import (
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestUserService_GetUserByEmail(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	service := NewUserService(db)

	tests := []struct {
		name      string
		email     string
		mockFunc  func()
		wantID    string
		wantEmail string
		wantErr   bool
		wantNil   bool
	}{
		{
			name:  "user found by email",
			email: "user@example.com",
			mockFunc: func() {
				rows := sqlmock.NewRows([]string{
					"id", "provider", "provider_id", "name", "email",
					"phone", "role", "team", "fcm_token",
					"is_active", "created_at", "updated_at",
				}).AddRow(
					"user-uuid-123", "oidc", "provider-sub-456", "Test User", "user@example.com",
					"", "engineer", "Platform", "",
					true, time.Now(), time.Now(),
				)
				mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
					WithArgs("user@example.com").
					WillReturnRows(rows)
			},
			wantID:    "user-uuid-123",
			wantEmail: "user@example.com",
			wantErr:   false,
			wantNil:   false,
		},
		{
			name:  "user not found - returns nil without error",
			email: "notfound@example.com",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
					WithArgs("notfound@example.com").
					WillReturnError(sql.ErrNoRows)
			},
			wantID:    "",
			wantEmail: "",
			wantErr:   false,
			wantNil:   true,
		},
		{
			name:  "inactive user not returned",
			email: "inactive@example.com",
			mockFunc: func() {
				// Query has is_active = true, so inactive users won't be returned
				mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
					WithArgs("inactive@example.com").
					WillReturnError(sql.ErrNoRows)
			},
			wantID:    "",
			wantEmail: "",
			wantErr:   false,
			wantNil:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()

			user, err := service.GetUserByEmail(tt.email)

			if (err != nil) != tt.wantErr {
				t.Errorf("GetUserByEmail() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.wantNil {
				if user != nil {
					t.Errorf("GetUserByEmail() = %v, want nil", user)
				}
			} else {
				if user == nil {
					t.Errorf("GetUserByEmail() = nil, want user")
					return
				}
				if user.ID != tt.wantID {
					t.Errorf("GetUserByEmail() ID = %v, want %v", user.ID, tt.wantID)
				}
				if user.Email != tt.wantEmail {
					t.Errorf("GetUserByEmail() Email = %v, want %v", user.Email, tt.wantEmail)
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestUserService_LinkUserIdentity(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	service := NewUserService(db)

	tests := []struct {
		name        string
		userID      string
		provider    string
		providerSub string
		email       string
		mockFunc    func()
		wantErr     bool
	}{
		{
			name:        "link new identity",
			userID:      "user-uuid-123",
			provider:    "cf-access",
			providerSub: "cf-sub-456",
			email:       "user@example.com",
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO user_identities").
					WithArgs("user-uuid-123", "cf-access", "cf-sub-456", "user@example.com").
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
		{
			name:        "link existing identity - updates last_used_at",
			userID:      "user-uuid-123",
			provider:    "google",
			providerSub: "google-sub-789",
			email:       "user@example.com",
			mockFunc: func() {
				// ON CONFLICT updates last_used_at
				mock.ExpectExec("INSERT INTO user_identities").
					WithArgs("user-uuid-123", "google", "google-sub-789", "user@example.com").
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()

			err := service.LinkUserIdentity(tt.userID, tt.provider, tt.providerSub, tt.email)

			if (err != nil) != tt.wantErr {
				t.Errorf("LinkUserIdentity() error = %v, wantErr %v", err, tt.wantErr)
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestUserService_GetUserByProviderSub(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	service := NewUserService(db)

	tests := []struct {
		name        string
		provider    string
		providerSub string
		mockFunc    func()
		wantID      string
		wantErr     bool
		wantNil     bool
	}{
		{
			name:        "user found by provider sub",
			provider:    "google",
			providerSub: "google-sub-123",
			mockFunc: func() {
				// First query: get user_id from user_identities
				mock.ExpectQuery("SELECT user_id FROM user_identities").
					WithArgs("google", "google-sub-123").
					WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("user-uuid-123"))

				// Second query: get full user from users table
				rows := sqlmock.NewRows([]string{
					"id", "provider", "provider_id", "name", "email",
					"phone", "role", "team", "fcm_token",
					"is_active", "created_at", "updated_at",
				}).AddRow(
					"user-uuid-123", "oidc", "google-sub-123", "Test User", "user@example.com",
					"", "engineer", "Platform", "",
					true, time.Now(), time.Now(),
				)
				mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
					WithArgs("user-uuid-123").
					WillReturnRows(rows)
			},
			wantID:  "user-uuid-123",
			wantErr: false,
			wantNil: false,
		},
		{
			name:        "identity not found",
			provider:    "github",
			providerSub: "unknown-sub",
			mockFunc: func() {
				mock.ExpectQuery("SELECT user_id FROM user_identities").
					WithArgs("github", "unknown-sub").
					WillReturnError(sql.ErrNoRows)
			},
			wantID:  "",
			wantErr: false,
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()

			user, err := service.GetUserByProviderSub(tt.provider, tt.providerSub)

			if (err != nil) != tt.wantErr {
				t.Errorf("GetUserByProviderSub() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.wantNil {
				if user != nil {
					t.Errorf("GetUserByProviderSub() = %v, want nil", user)
				}
			} else {
				if user == nil {
					t.Errorf("GetUserByProviderSub() = nil, want user")
					return
				}
				if user.ID != tt.wantID {
					t.Errorf("GetUserByProviderSub() ID = %v, want %v", user.ID, tt.wantID)
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

// TestEmailBasedLookup_MultiProviderScenario tests the complete flow of
// a user logging in with multiple providers
func TestEmailBasedLookup_MultiProviderScenario(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	service := NewUserService(db)

	// Scenario: User first logged in with Google, now logging in with CF Access
	// Same email should return the same user

	t.Run("same email different provider returns same user", func(t *testing.T) {
		email := "user@company.com"
		existingUserID := "existing-user-uuid"

		// Step 1: Lookup by email - user exists
		rows := sqlmock.NewRows([]string{
			"id", "provider", "provider_id", "name", "email",
			"phone", "role", "team", "fcm_token",
			"is_active", "created_at", "updated_at",
		}).AddRow(
			existingUserID, "oidc", "google-sub-old", "Test User", email,
			"", "engineer", "Platform", "",
			true, time.Now(), time.Now(),
		)
		mock.ExpectQuery("SELECT id, provider, provider_id, name, email").
			WithArgs(email).
			WillReturnRows(rows)

		user, err := service.GetUserByEmail(email)
		if err != nil {
			t.Fatalf("GetUserByEmail() error = %v", err)
		}
		if user == nil {
			t.Fatal("GetUserByEmail() returned nil")
		}
		if user.ID != existingUserID {
			t.Errorf("Expected user ID %s, got %s", existingUserID, user.ID)
		}

		// Step 2: Link new CF Access identity
		mock.ExpectExec("INSERT INTO user_identities").
			WithArgs(existingUserID, "cf-access", "cf-access-sub-new", email).
			WillReturnResult(sqlmock.NewResult(1, 1))

		err = service.LinkUserIdentity(existingUserID, "cf-access", "cf-access-sub-new", email)
		if err != nil {
			t.Fatalf("LinkUserIdentity() error = %v", err)
		}

		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled expectations: %v", err)
		}
	})
}
