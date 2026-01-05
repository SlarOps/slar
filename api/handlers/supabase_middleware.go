package handlers

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type SupabaseAuthMiddleware struct {
	SupabaseAuth  *services.SupabaseAuthService
	UserService   *services.UserService
	APIKeyService *services.APIKeyService
}

func NewSupabaseAuthMiddleware(userService *services.UserService, apiKeyService *services.APIKeyService) *SupabaseAuthMiddleware {
	// Get Supabase configuration from environment variables
	supabaseURL := os.Getenv("SUPABASE_URL")
	jwtSecret := os.Getenv("SUPABASE_JWT_SECRET") // Legacy: only needed for HS256

	if supabaseURL == "" {
		log.Fatal("Missing SUPABASE_URL configuration")
	}

	// Note: jwtSecret is optional - ES256/RS256 tokens use JWKS public key verification
	supabaseAuth := services.NewSupabaseAuthService(supabaseURL, jwtSecret)

	return &SupabaseAuthMiddleware{
		SupabaseAuth:  supabaseAuth,
		UserService:   userService,
		APIKeyService: apiKeyService,
	}
}

// SupabaseAuthMiddleware validates Supabase JWT tokens
func (m *SupabaseAuthMiddleware) SupabaseAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract token from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		token, err := m.SupabaseAuth.ExtractTokenFromHeader(authHeader)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		// Check if it's an API key (database lookup via APIKeyService)
		// This handles both internal (AI Pilot) and external API keys
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

		// Validate the Supabase token (normal user JWT)
		claims, err := m.SupabaseAuth.ValidateSupabaseToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token: " + err.Error()})
			c.Abort()
			return
		}

		// Store user info in context for use in handlers
		userInfo := m.SupabaseAuth.GetUserInfo(claims)
		c.Set("user", userInfo)

		// Ensure user exists in database (auto-sync)
		err = m.ensureUserExists(claims.UserID, claims)
		if err != nil {
			log.Printf("Failed to sync user to database: %v", err)
			// Don't fail the request, just log the error
		}

		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Set("user_role", claims.Role)

		log.Printf("AUTH SUCCESS - User: %s (%s)", claims.Email, claims.UserID)

		c.Next()
	}
}

// OptionalSupabaseAuth middleware for endpoints that can work with or without auth
func (m *SupabaseAuthMiddleware) OptionalSupabaseAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract token from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			token, err := m.SupabaseAuth.ExtractTokenFromHeader(authHeader)
			if err == nil {
				// Validate the Supabase token
				claims, err := m.SupabaseAuth.ValidateSupabaseToken(token)
				if err == nil {
					// Store user info in context
					userInfo := m.SupabaseAuth.GetUserInfo(claims)
					c.Set("user", userInfo)
					// Transform user_id to match database format
					dbUserID := m.transformUserIDForDatabase(claims)

					// Ensure user exists in database (auto-sync)
					syncErr := m.ensureUserExists(dbUserID, claims)
					if syncErr != nil {
						log.Printf("Failed to sync user to database: %v", syncErr)
						// Don't fail the request, just log the error
					}

					c.Set("user_id", dbUserID)
					c.Set("user_email", claims.Email)
					c.Set("user_role", claims.Role)
					c.Set("authenticated", true)
				}
			}
		}

		// Continue regardless of auth status
		c.Next()
	}
}

// transformUserIDForDatabase converts user_id to database format based on OAuth provider
func (m *SupabaseAuthMiddleware) transformUserIDForDatabase(claims *services.SupabaseClaims) string {
	// Try to detect OAuth provider from various sources in JWT claims
	return claims.UserID
}

// ensureUserExists checks if user exists in database and creates if not
func (m *SupabaseAuthMiddleware) ensureUserExists(userID string, claims *services.SupabaseClaims) error {
	// Check if user exists
	_, err := m.UserService.GetUser(userID)
	if err != nil {
		// User doesn't exist, create it
		log.Printf("Creating new user record for: %s (%s)", claims.Email, userID)

		user := db.User{
			ID:         userID,
			Provider:   "supabase",
			ProviderID: userID,
			Email:      claims.Email,
			Name:       m.extractNameFromClaims(claims),
			Role:       "engineer", // Default role
			Team:       m.extractTeamFromClaims(claims),
			IsActive:   true,
			CreatedAt:  time.Now(),
			UpdatedAt:  time.Now(),
		}

		return m.UserService.CreateUserRecord(user)
	}
	return nil
}

// extractNameFromClaims extracts full name from Supabase claims
func (m *SupabaseAuthMiddleware) extractNameFromClaims(claims *services.SupabaseClaims) string {
	// Try to get full name from user metadata
	if claims.UserMeta != nil {
		if fullName, ok := claims.UserMeta["full_name"].(string); ok && fullName != "" {
			return fullName
		}
		if name, ok := claims.UserMeta["name"].(string); ok && name != "" {
			return name
		}
		// Try GitHub specific fields
		if displayName, ok := claims.UserMeta["user_name"].(string); ok && displayName != "" {
			return displayName
		}
	}

	// Try app metadata
	if claims.AppMeta != nil {
		if fullName, ok := claims.AppMeta["full_name"].(string); ok && fullName != "" {
			return fullName
		}
	}

	// Fallback to email without domain
	if strings.Contains(claims.Email, "@") {
		emailParts := strings.Split(claims.Email, "@")
		return emailParts[0]
	}

	return "User"
}

// extractTeamFromClaims extracts team/company from Supabase claims
func (m *SupabaseAuthMiddleware) extractTeamFromClaims(claims *services.SupabaseClaims) string {
	// Try to get company from user metadata
	if claims.UserMeta != nil {
		if company, ok := claims.UserMeta["company"].(string); ok && company != "" {
			return company
		}
		if team, ok := claims.UserMeta["team"].(string); ok && team != "" {
			return team
		}
	}

	// Try app metadata
	if claims.AppMeta != nil {
		if company, ok := claims.AppMeta["company"].(string); ok && company != "" {
			return company
		}
	}

	// Fallback to email domain
	if strings.Contains(claims.Email, "@") {
		emailParts := strings.Split(claims.Email, "@")
		domain := emailParts[1]
		// Remove common email providers to get company domain
		if domain != "gmail.com" && domain != "yahoo.com" && domain != "hotmail.com" && domain != "outlook.com" {
			return strings.Title(strings.Split(domain, ".")[0])
		}
	}

	return "Default Team"
}
