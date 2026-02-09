package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/internal/config"
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
// Supports three authentication methods (tried in order):
//  1. API Key - database lookup
//  2. Session Token - backend-issued JWT (fast HMAC verification, no external calls)
//  3. OIDC ID Token - provider-issued JWT (JWKS verification, backward compatible)
type OIDCAuthMiddleware struct {
	OIDCAuth      *services.OIDCAuthService
	SessionToken  *services.SessionTokenService // Backend-issued session tokens
	UserService   *services.UserService
	APIKeyService *services.APIKeyService
}

// NewOIDCAuthMiddleware creates a new OIDC auth middleware
// Reads configuration from config.App (loaded from config.yaml):
// - OIDCIssuer: The OIDC issuer URL (required)
// - OIDCClientID: Default client ID (optional, used as fallback)
// - OIDCWebClientID: Client ID for web frontend (optional)
// - OIDCMobileClientID: Client ID for mobile app (optional)
// Returns nil if OIDC is not configured - API will start but protected endpoints will be disabled
func NewOIDCAuthMiddleware(userService *services.UserService, apiKeyService *services.APIKeyService, sessionTokenService *services.SessionTokenService) *OIDCAuthMiddleware {
	// Read from config.App (loaded from config.yaml)
	oidcIssuer := config.App.OIDCIssuer

	if oidcIssuer == "" {
		log.Println("⚠️  WARNING: oidc_issuer not configured in config.yaml. Protected endpoints will be disabled.")
		log.Println("   Set oidc_issuer and oidc_client_id in config.yaml to enable authentication.")
		return nil
	}

	// Collect all configured client IDs (web, mobile, and default)
	// Backend will accept tokens from any of these client IDs
	clientIDs := []string{}

	// Add default client ID
	if config.App.OIDCClientID != "" {
		clientIDs = append(clientIDs, config.App.OIDCClientID)
	}

	// Add web-specific client ID
	if config.App.OIDCWebClientID != "" {
		// Only add if different from default
		if !contains(clientIDs, config.App.OIDCWebClientID) {
			clientIDs = append(clientIDs, config.App.OIDCWebClientID)
		}
	}

	// Add mobile-specific client ID
	if config.App.OIDCMobileClientID != "" {
		// Only add if different from others
		if !contains(clientIDs, config.App.OIDCMobileClientID) {
			clientIDs = append(clientIDs, config.App.OIDCMobileClientID)
		}
	}

	oidcAuth, err := services.NewOIDCAuthServiceWithClientIDs(oidcIssuer, clientIDs)
	if err != nil {
		log.Printf("⚠️  WARNING: OIDC discovery failed: %v", err)
		log.Println("   Protected endpoints will be disabled until OIDC provider is available.")
		return nil
	}

	log.Printf("✅ OIDC authentication configured: %s (client IDs: %v)", oidcIssuer, clientIDs)
	if sessionTokenService != nil {
		log.Println("✅ Session token support enabled (token exchange available)")
	}

	return &OIDCAuthMiddleware{
		OIDCAuth:      oidcAuth,
		SessionToken:  sessionTokenService,
		UserService:   userService,
		APIKeyService: apiKeyService,
	}
}

// contains checks if a string slice contains a specific string
func contains(slice []string, str string) bool {
	for _, s := range slice {
		if s == str {
			return true
		}
	}
	return false
}

// OIDCAuthMiddleware validates tokens in this priority order:
//  1. API Key (database lookup)
//  2. Session Token (backend-issued JWT, HMAC verification - microseconds, no external calls)
//  3. OIDC ID Token (provider-issued JWT, JWKS verification - backward compatible)
//
// This ordering ensures:
//   - Existing API key integrations continue to work
//   - New session token flow is the fast path (no DB lookup for user, no JWKS calls)
//   - Old ID Token flow still works during migration (backward compatible)
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

		// === PATH 1: API Key (database lookup) ===
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
			// API key validation failed - fall through to token validation
		}

		// === PATH 2: Session Token (backend-issued, fast HMAC verification) ===
		// Try session token first - it's the fastest path (microseconds, no external calls)
		if m.SessionToken != nil && m.SessionToken.IsSessionToken(token) {
			sessionClaims, err := m.SessionToken.ValidateSessionToken(token)
			if err == nil {
				// Ensure user exists in database (handles DB reset, fresh install scenarios)
				// This is a lightweight SELECT by PK - fast even with the extra query
				userID := sessionClaims.UserID
				if _, userErr := m.UserService.GetUser(userID); userErr != nil {
					// User not in DB - re-create from session token claims
					log.Printf("Session token user not in DB, re-creating: %s (uuid:%s)", sessionClaims.Email, userID)
					user := db.User{
						ID:         userID,
						Provider:   "oidc",
						ProviderID: userID, // Best effort - will be updated on next OIDC login
						Email:      sessionClaims.Email,
						Name:       strings.Split(sessionClaims.Email, "@")[0],
						Role:       "engineer",
						Team:       "Default Team",
						IsActive:   true,
						CreatedAt:  time.Now(),
						UpdatedAt:  time.Now(),
					}
					if createErr := m.UserService.CreateUserRecord(user); createErr != nil {
						log.Printf("Failed to re-create user from session token: %v (uuid:%s)", createErr, userID)
						c.JSON(http.StatusUnauthorized, gin.H{
							"error":   "user_sync_failed",
							"message": "User account not found. Please re-authenticate.",
						})
						c.Abort()
						return
					}
					log.Printf("Re-created user from session token: %s (uuid:%s)", sessionClaims.Email, userID)
				}

				c.Set("user_id", userID)
				c.Set("user_email", sessionClaims.Email)
				c.Set("user_role", sessionClaims.Role)
				c.Set("auth_provider", "session_token")

				// Set user map for handlers that expect it
				c.Set("user", map[string]interface{}{
					"id":    userID,
					"email": sessionClaims.Email,
					"role":  sessionClaims.Role,
				})

				c.Next()
				return
			}
			// Session token validation failed (expired, tampered, etc.)
			// Don't fall through to OIDC - if it was a session token, reject it
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "session_token_expired",
				"message": "Session token is invalid or expired. Use /auth/refresh to get a new one.",
			})
			c.Abort()
			return
		}

		// === PATH 3: OIDC ID Token (backward compatible) ===
		// This path handles:
		//   - Clients that haven't migrated to session tokens yet
		//   - Initial token exchange requests
		claims, err := m.OIDCAuth.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token: " + err.Error()})
			c.Abort()
			return
		}

		// EMAIL-BASED LOOKUP: Get or create user by email (not by sub-based UUID)
		// This enables multi-provider authentication: same email = same user
		userUUID, err := m.ensureUserExistsByEmail(claims, claims.IsFreshLogin(5))
		if err != nil {
			log.Printf("Failed to process user: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process user authentication"})
			c.Abort()
			return
		}

		// Store user info in context for use in handlers
		userInfo := m.OIDCAuth.GetUserInfo(claims)
		userInfo["id"] = userUUID // Use the actual user ID from database
		c.Set("user", userInfo)

		c.Set("user_id", userUUID)
		c.Set("oidc_sub", claims.UserID) // Keep original OIDC subject for reference
		c.Set("user_email", claims.Email)
		c.Set("user_role", "authenticated")
		c.Set("auth_provider", "oidc")

		log.Printf("AUTH SUCCESS - User: %s (oidc_sub:%s -> uuid:%s) via OIDC ID Token", claims.Email, claims.UserID, userUUID)

		c.Next()
	}
}

// OptionalOIDCAuth middleware for endpoints that can work with or without auth
// Supports both session tokens and OIDC ID tokens
func (m *OIDCAuthMiddleware) OptionalOIDCAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract token from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			token, err := m.OIDCAuth.ExtractTokenFromHeader(authHeader)
			if err == nil {
				// Try session token first (fast path)
				if m.SessionToken != nil && m.SessionToken.IsSessionToken(token) {
					sessionClaims, err := m.SessionToken.ValidateSessionToken(token)
					if err == nil {
						userID := sessionClaims.UserID
						// Ensure user exists in database
						if _, userErr := m.UserService.GetUser(userID); userErr != nil {
							log.Printf("Optional auth: session token user not in DB, re-creating: %s (uuid:%s)", sessionClaims.Email, userID)
							user := db.User{
								ID:         userID,
								Provider:   "oidc",
								ProviderID: userID,
								Email:      sessionClaims.Email,
								Name:       strings.Split(sessionClaims.Email, "@")[0],
								Role:       "engineer",
								Team:       "Default Team",
								IsActive:   true,
								CreatedAt:  time.Now(),
								UpdatedAt:  time.Now(),
							}
							if createErr := m.UserService.CreateUserRecord(user); createErr != nil {
								log.Printf("Optional auth: failed to re-create user: %v", createErr)
								// For optional auth, continue without auth
							}
						}
						c.Set("user_id", userID)
						c.Set("user_email", sessionClaims.Email)
						c.Set("user_role", sessionClaims.Role)
						c.Set("authenticated", true)
						c.Set("auth_provider", "session_token")
						c.Set("user", map[string]interface{}{
							"id":    userID,
							"email": sessionClaims.Email,
							"role":  sessionClaims.Role,
						})
					}
				} else {
					// Fallback to OIDC ID Token
					claims, err := m.OIDCAuth.ValidateToken(token)
					if err == nil {
						// EMAIL-BASED LOOKUP: Get or create user by email
						userUUID, userErr := m.ensureUserExistsByEmail(claims, claims.IsFreshLogin(5))
						if userErr != nil {
							log.Printf("Failed to sync user to database: %v", userErr)
							// Continue without auth for optional endpoints
						} else {
							// Store user info in context
							userInfo := m.OIDCAuth.GetUserInfo(claims)
							userInfo["id"] = userUUID
							c.Set("user", userInfo)

							c.Set("user_id", userUUID)
							c.Set("oidc_sub", claims.UserID)
							c.Set("user_email", claims.Email)
							c.Set("user_role", "authenticated")
							c.Set("authenticated", true)
							c.Set("auth_provider", "oidc")
						}
					}
				}
			}
		}

		// Continue regardless of auth status
		c.Next()
	}
}

// ensureUserExistsByEmail looks up user by EMAIL first (not by sub-based UUID)
// This enables multi-provider authentication: same email = same user
// Returns: (userID string, error)
// updateProfile: if true, sync profile data from IdP (for fresh logins)
func (m *OIDCAuthMiddleware) ensureUserExistsByEmail(claims *services.OIDCClaims, updateProfile bool) (string, error) {
	// Validate email is present (required for email-based lookup)
	if claims.Email == "" {
		return "", fmt.Errorf("email claim is required for authentication")
	}

	newName := m.extractNameFromClaims(claims)
	newTeam := m.extractTeamFromClaims(claims)

	// STEP 1: Lookup by EMAIL first (key change for multi-provider support)
	existingUser, err := m.UserService.GetUserByEmail(claims.Email)
	if err != nil {
		return "", fmt.Errorf("failed to lookup user by email: %w", err)
	}

	if existingUser != nil {
		// User found by email → USE EXISTING ID (don't create new)
		userID := existingUser.ID

		// Log if provider changed (useful for audit)
		if existingUser.ProviderID != claims.UserID {
			log.Printf("User %s logged in with different provider: old_sub=%s, new_sub=%s",
				claims.Email, existingUser.ProviderID, claims.UserID)
		}

		// Link this identity (idempotent - won't duplicate)
		if linkErr := m.UserService.LinkUserIdentity(userID, "oidc", claims.UserID, claims.Email); linkErr != nil {
			log.Printf("Warning: failed to link identity: %v", linkErr)
			// Don't fail the request, just log
		}

		// Update profile if fresh login
		if updateProfile {
			needsUpdate := existingUser.Name != newName || existingUser.ProviderID != claims.UserID

			if needsUpdate {
				log.Printf("Syncing user profile from IdP: %s (uuid:%s)", claims.Email, userID)

				user := db.User{
					ID:         userID,
					Provider:   "oidc",
					ProviderID: claims.UserID, // Update to latest provider sub
					Email:      claims.Email,
					Name:       newName,
					Role:       existingUser.Role,
					Team:       existingUser.Team,
					IsActive:   existingUser.IsActive,
					CreatedAt:  existingUser.CreatedAt,
					UpdatedAt:  time.Now(),
				}

				// Update team if it was default and IdP has better info
				if existingUser.Team == "Default Team" && newTeam != "Default Team" {
					user.Team = newTeam
				}

				if updateErr := m.UserService.CreateUserRecord(user); updateErr != nil {
					log.Printf("ERROR updating user profile: %v (uuid:%s)", updateErr, userID)
					// Don't fail, just log
				}
			}
		}

		return userID, nil
	}

	// STEP 2: User doesn't exist by email → Create new user with random UUID
	userID := uuid.New().String()
	log.Printf("Creating new user: %s (uuid:%s, provider_sub:%s)", claims.Email, userID, claims.UserID)

	user := db.User{
		ID:         userID,
		Provider:   "oidc",
		ProviderID: claims.UserID,
		Email:      claims.Email,
		Name:       newName,
		Role:       "engineer",
		Team:       newTeam,
		IsActive:   true,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if createErr := m.UserService.CreateUserRecord(user); createErr != nil {
		return "", fmt.Errorf("failed to create user: %w", createErr)
	}

	// Link identity for the new user
	if linkErr := m.UserService.LinkUserIdentity(userID, "oidc", claims.UserID, claims.Email); linkErr != nil {
		log.Printf("Warning: failed to link identity for new user: %v", linkErr)
	}

	log.Printf("Successfully created user: %s (uuid:%s)", claims.Email, userID)
	return userID, nil
}

// ensureUserExists is kept for backward compatibility but now delegates to ensureUserExistsByEmail
// Deprecated: Use ensureUserExistsByEmail directly
func (m *OIDCAuthMiddleware) ensureUserExists(userID string, claims *services.OIDCClaims, updateProfile bool) error {
	_, err := m.ensureUserExistsByEmail(claims, updateProfile)
	return err
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
