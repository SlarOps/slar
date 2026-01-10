package handlers

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

// OIDC namespace for generating deterministic UUIDs from OIDC subject IDs
var oidcNamespace = uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8") // DNS namespace

// oidcSubToUUID converts an OIDC subject ID to a deterministic UUID
// This ensures the same OIDC user always gets the same UUID in our database
func oidcSubToUUID(sub string) string {
	// If it's already a valid UUID, return as-is
	if _, err := uuid.Parse(sub); err == nil {
		return sub
	}

	// Generate UUID v5 from OIDC subject
	// Uses SHA-1 hash of namespace + subject to create deterministic UUID
	id := uuid.NewSHA1(oidcNamespace, []byte(sub))
	return id.String()
}

// OIDCAuthMiddleware handles JWT authentication using any OIDC-compliant provider
type OIDCAuthMiddleware struct {
	OIDCAuth      *services.OIDCAuthService
	UserService   *services.UserService
	APIKeyService *services.APIKeyService
}

// NewOIDCAuthMiddleware creates a new OIDC auth middleware
// Reads configuration from environment variable OIDC_ISSUER (optional)
// Returns nil if OIDC is not configured - API will start but protected endpoints will be disabled
func NewOIDCAuthMiddleware(userService *services.UserService, apiKeyService *services.APIKeyService) *OIDCAuthMiddleware {
	oidcIssuer := os.Getenv("OIDC_ISSUER")
	oidcClientID := os.Getenv("OIDC_CLIENT_ID")

	if oidcIssuer == "" {
		log.Println("⚠️  WARNING: OIDC_ISSUER not configured. Protected endpoints will be disabled.")
		log.Println("   Set OIDC_ISSUER and OIDC_CLIENT_ID to enable authentication.")
		return nil
	}

	oidcAuth, err := services.NewOIDCAuthService(oidcIssuer, oidcClientID)
	if err != nil {
		log.Printf("⚠️  WARNING: OIDC discovery failed: %v", err)
		log.Println("   Protected endpoints will be disabled until OIDC provider is available.")
		return nil
	}

	log.Printf("✅ OIDC authentication configured: %s", oidcIssuer)
	return &OIDCAuthMiddleware{
		OIDCAuth:      oidcAuth,
		UserService:   userService,
		APIKeyService: apiKeyService,
	}
}

// OIDCAuthMiddleware validates OIDC JWT tokens
func (m *OIDCAuthMiddleware) OIDCAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract token from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		token, err := m.OIDCAuth.ExtractTokenFromHeader(authHeader)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		// Check if it's an API key (database lookup via APIKeyService)
		if m.APIKeyService != nil {
			apiKey, err := m.APIKeyService.ValidateAPIKey(token)
			if err == nil {
				// Valid API key - set context from database record
				c.Set("user_id", apiKey.UserID)
				c.Set("user_email", "api-key@slar.local")
				c.Set("user_role", "api_key")
				c.Set("is_api_key", true)
				c.Set("api_key_id", apiKey.ID)
				c.Set("api_key_permissions", apiKey.Permissions)
				// Set org_id if available on API key
				if apiKey.OrganizationID != "" {
					c.Set("org_id", apiKey.OrganizationID)
				}
				log.Printf("AUTH SUCCESS - API Key: %s (user: %s)", apiKey.Name, apiKey.UserID)
				// Update last used timestamp (async, don't block request)
				go m.APIKeyService.UpdateLastUsed(apiKey.ID)
				c.Next()
				return
			}
			// API key validation failed - fall through to JWT validation
		}

		// Validate the OIDC token (normal user JWT)
		claims, err := m.OIDCAuth.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token: " + err.Error()})
			c.Abort()
			return
		}

		// Convert OIDC subject to UUID for database compatibility
		userUUID := oidcSubToUUID(claims.UserID)

		// Store user info in context for use in handlers
		userInfo := m.OIDCAuth.GetUserInfo(claims)
		userInfo["id"] = userUUID // Override with UUID
		c.Set("user", userInfo)

		// Always ensure user exists (required for FK constraints)
		// Only update profile fields on fresh login (within 5 minutes of auth_time)
		err = m.ensureUserExists(userUUID, claims, claims.IsFreshLogin(5))
		if err != nil {
			log.Printf("Failed to sync user to database: %v", err)
			// Don't block request on sync failure, just log it
		}

		c.Set("user_id", userUUID)
		c.Set("oidc_sub", claims.UserID) // Keep original OIDC subject for reference
		c.Set("user_email", claims.Email)
		c.Set("user_role", "authenticated")
		c.Set("auth_provider", "oidc")

		log.Printf("AUTH SUCCESS - User: %s (oidc:%s -> uuid:%s) via OIDC", claims.Email, claims.UserID, userUUID)

		c.Next()
	}
}

// OptionalOIDCAuth middleware for endpoints that can work with or without auth
func (m *OIDCAuthMiddleware) OptionalOIDCAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract token from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			token, err := m.OIDCAuth.ExtractTokenFromHeader(authHeader)
			if err == nil {
				// Validate the OIDC token
				claims, err := m.OIDCAuth.ValidateToken(token)
				if err == nil {
					// Convert OIDC subject to UUID
					userUUID := oidcSubToUUID(claims.UserID)

					// Store user info in context
					userInfo := m.OIDCAuth.GetUserInfo(claims)
					userInfo["id"] = userUUID
					c.Set("user", userInfo)

					// Always ensure user exists, update profile only on fresh login
					syncErr := m.ensureUserExists(userUUID, claims, claims.IsFreshLogin(5))
					if syncErr != nil {
						log.Printf("Failed to sync user to database: %v", syncErr)
					}

					c.Set("user_id", userUUID)
					c.Set("oidc_sub", claims.UserID)
					c.Set("user_email", claims.Email)
					c.Set("user_role", "authenticated")
					c.Set("authenticated", true)
					c.Set("auth_provider", "oidc")
				}
			}
		}

		// Continue regardless of auth status
		c.Next()
	}
}

// ensureUserExists checks if user exists in database and creates/updates accordingly
// userID is the UUID (converted from OIDC subject), claims.UserID is original OIDC subject
// updateProfile: if true, sync profile data from IdP (for fresh logins)
func (m *OIDCAuthMiddleware) ensureUserExists(userID string, claims *services.OIDCClaims, updateProfile bool) error {
	newName := m.extractNameFromClaims(claims)
	newTeam := m.extractTeamFromClaims(claims)

	// Check if user exists
	existingUser, err := m.UserService.GetUser(userID)
	if err == nil {
		// User exists - only update profile if updateProfile=true (fresh login)
		if !updateProfile {
			return nil // User exists, no update needed
		}

		// Check if profile needs updating (IdP is source of truth)
		needsUpdate := existingUser.Email != claims.Email ||
			existingUser.Name != newName ||
			existingUser.ProviderID != claims.UserID

		if needsUpdate {
			log.Printf("Syncing user profile from IdP: %s -> %s (uuid:%s)",
				existingUser.Email, claims.Email, userID)

			// Update with latest data from IdP (preserve user's role and team if set)
			user := db.User{
				ID:         userID,
				Provider:   "oidc",
				ProviderID: claims.UserID,
				Email:      claims.Email,
				Name:       newName,
				Role:       existingUser.Role, // Preserve existing role
				Team:       existingUser.Team, // Preserve existing team (can be overridden by IdP if needed)
				IsActive:   existingUser.IsActive,
				CreatedAt:  existingUser.CreatedAt,
				UpdatedAt:  time.Now(),
			}

			// If team was default and IdP has better info, update it
			if existingUser.Team == "Default Team" && newTeam != "Default Team" {
				user.Team = newTeam
			}

			updateErr := m.UserService.CreateUserRecord(user)
			if updateErr != nil {
				log.Printf("ERROR updating user profile: %v (uuid:%s)", updateErr, userID)
				return updateErr
			}
			log.Printf("Successfully synced user profile: %s (uuid:%s)", claims.Email, userID)
		}
		return nil
	}

	// User doesn't exist, create it
	log.Printf("Creating new user record for: %s (uuid:%s, oidc_sub:%s)", claims.Email, userID, claims.UserID)

	user := db.User{
		ID:         userID,        // UUID for database
		Provider:   "oidc",
		ProviderID: claims.UserID, // Original OIDC subject for reference
		Email:      claims.Email,
		Name:       newName,
		Role:       "engineer", // Default role
		Team:       newTeam,
		IsActive:   true,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	createErr := m.UserService.CreateUserRecord(user)
	if createErr != nil {
		log.Printf("ERROR creating user record: %v (uuid:%s, email:%s)", createErr, userID, claims.Email)
		return createErr
	}

	log.Printf("Successfully created user: %s (uuid:%s)", claims.Email, userID)
	return nil
}

// extractNameFromClaims extracts full name from OIDC claims
func (m *OIDCAuthMiddleware) extractNameFromClaims(claims *services.OIDCClaims) string {
	// Try full name first
	if claims.Name != "" {
		return claims.Name
	}

	// Try given + family name
	if claims.GivenName != "" || claims.FamilyName != "" {
		return strings.TrimSpace(claims.GivenName + " " + claims.FamilyName)
	}

	// Try preferred username
	if claims.PreferredName != "" {
		return claims.PreferredName
	}

	// Fallback to email without domain
	if strings.Contains(claims.Email, "@") {
		emailParts := strings.Split(claims.Email, "@")
		return emailParts[0]
	}

	return "User"
}

// extractTeamFromClaims extracts team/company from OIDC claims
func (m *OIDCAuthMiddleware) extractTeamFromClaims(claims *services.OIDCClaims) string {
	// Try to get from metadata
	if claims.Metadata != nil {
		if company, ok := claims.Metadata["company"].(string); ok && company != "" {
			return company
		}
		if team, ok := claims.Metadata["team"].(string); ok && team != "" {
			return team
		}
	}

	// Try to get from groups
	if len(claims.Groups) > 0 {
		return claims.Groups[0]
	}

	// Fallback to email domain
	if strings.Contains(claims.Email, "@") {
		emailParts := strings.Split(claims.Email, "@")
		domain := emailParts[1]
		// Remove common email providers to get company domain
		if domain != "gmail.com" && domain != "yahoo.com" && domain != "hotmail.com" && domain != "outlook.com" {
			domainParts := strings.Split(domain, ".")
			if len(domainParts) > 0 {
				return strings.Title(domainParts[0])
			}
		}
	}

	return "Default Team"
}

