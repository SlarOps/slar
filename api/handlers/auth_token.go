package handlers

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

// AuthTokenHandler handles token exchange and refresh endpoints
//
// Flow:
//
//  1. Client authenticates with OIDC provider (Cloudflare, Google, Zitadel, etc.)
//  2. Client receives ID Token (JWT, 5-min lifetime)
//  3. Client calls POST /auth/token with the ID Token
//  4. Backend verifies ID Token via go-oidc (JWKS), creates/finds user
//  5. Backend issues session_token (1h) + refresh_token (7d)
//  6. Client uses session_token for all subsequent API calls
//  7. When session_token expires, client calls POST /auth/refresh
//
// This decouples the API from the OIDC provider's token lifetime
// and works identically regardless of provider (no per-provider logic needed)
type AuthTokenHandler struct {
	OIDCAuth     *services.OIDCAuthService
	SessionToken *services.SessionTokenService
	UserService  *services.UserService
}

// NewAuthTokenHandler creates a new auth token handler
func NewAuthTokenHandler(
	oidcAuth *services.OIDCAuthService,
	sessionToken *services.SessionTokenService,
	userService *services.UserService,
) *AuthTokenHandler {
	return &AuthTokenHandler{
		OIDCAuth:     oidcAuth,
		SessionToken: sessionToken,
		UserService:  userService,
	}
}

// TokenExchangeRequest is the request body for POST /auth/token
type TokenExchangeRequest struct {
	IDToken string `json:"id_token" binding:"required"`
}

// TokenResponse is the response for token exchange and refresh endpoints
type TokenResponse struct {
	SessionToken string `json:"session_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"` // Session token TTL in seconds
	TokenType    string `json:"token_type"` // Always "Bearer"
}

// RefreshRequest is the request body for POST /auth/refresh
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// ExchangeToken exchanges an OIDC ID Token for a backend session token
//
// POST /auth/token
// Body: { "id_token": "<oidc-id-token-from-provider>" }
// Response: { "session_token": "...", "refresh_token": "...", "expires_in": 3600, "token_type": "Bearer" }
//
// This is the entry point for authentication. After OIDC login:
//   - Web: NextAuth gets ID Token → calls this endpoint → stores session_token
//   - Mobile: flutter_appauth gets ID Token → calls this endpoint → stores session_token
//
// Works with ANY OIDC provider because all providers return standard ID Tokens
func (h *AuthTokenHandler) ExchangeToken(c *gin.Context) {
	var req TokenExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "id_token is required",
		})
		return
	}

	// Step 1: Verify the OIDC ID Token using go-oidc (JWKS verification)
	// This works for ANY provider: Cloudflare, Google, Zitadel, Dex, Okta, Auth0...
	claims, err := h.OIDCAuth.ValidateToken(req.IDToken)
	if err != nil {
		log.Printf("TOKEN EXCHANGE FAILED - Invalid ID Token: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "invalid_token",
			"message": "ID Token verification failed: " + err.Error(),
		})
		return
	}

	// Step 2: Ensure user exists in our database (create if first login)
	if claims.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "missing_email",
			"message": "ID Token must contain an email claim",
		})
		return
	}

	userID, err := h.ensureUserExists(claims)
	if err != nil {
		log.Printf("TOKEN EXCHANGE FAILED - User creation error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "user_error",
			"message": "Failed to process user",
		})
		return
	}

	// Step 3: Issue backend session token + refresh token
	tokenPair, err := h.SessionToken.IssueTokenPair(userID, claims.Email, "authenticated")
	if err != nil {
		log.Printf("TOKEN EXCHANGE FAILED - Token generation error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "token_error",
			"message": "Failed to generate session token",
		})
		return
	}

	log.Printf("TOKEN EXCHANGE SUCCESS - User: %s (uuid:%s) - session_token issued (expires_in: %ds)",
		claims.Email, userID, tokenPair.ExpiresIn)

	c.JSON(http.StatusOK, TokenResponse{
		SessionToken: tokenPair.SessionToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresIn:    tokenPair.ExpiresIn,
		TokenType:    tokenPair.TokenType,
	})
}

// RefreshToken refreshes an expired session token using a valid refresh token
//
// POST /auth/refresh
// Body: { "refresh_token": "<refresh-token>" }
// Response: { "session_token": "...", "refresh_token": "...", "expires_in": 3600, "token_type": "Bearer" }
//
// The refresh token is NOT rotated (stays the same until its 7-day expiry).
// When the refresh token expires, the client must re-authenticate via OIDC.
// No external calls are made - everything is verified locally (HMAC-SHA256).
func (h *AuthTokenHandler) RefreshToken(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "refresh_token is required",
		})
		return
	}

	// Validate refresh token and issue new session token
	// This is entirely local - no external calls to OIDC provider
	tokenPair, err := h.SessionToken.RefreshSessionToken(req.RefreshToken)
	if err != nil {
		log.Printf("TOKEN REFRESH FAILED: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "invalid_refresh_token",
			"message": "Refresh token is invalid or expired. Please re-authenticate.",
		})
		return
	}

	log.Printf("TOKEN REFRESH SUCCESS - session_token refreshed (expires_in: %ds)", tokenPair.ExpiresIn)

	c.JSON(http.StatusOK, TokenResponse{
		SessionToken: tokenPair.SessionToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresIn:    tokenPair.ExpiresIn,
		TokenType:    tokenPair.TokenType,
	})
}

// ensureUserExists creates or looks up user by email (same logic as OIDC middleware)
func (h *AuthTokenHandler) ensureUserExists(claims *services.OIDCClaims) (string, error) {
	// Look up user by email
	existingUser, err := h.UserService.GetUserByEmail(claims.Email)
	if err != nil {
		return "", err
	}

	if existingUser != nil {
		// Link identity (idempotent)
		if linkErr := h.UserService.LinkUserIdentity(existingUser.ID, "oidc", claims.UserID, claims.Email); linkErr != nil {
			log.Printf("Warning: failed to link identity during token exchange: %v", linkErr)
		}
		return existingUser.ID, nil
	}

	// Create new user
	return h.createNewUser(claims)
}

// createNewUser creates a new user from OIDC claims
func (h *AuthTokenHandler) createNewUser(claims *services.OIDCClaims) (string, error) {
	userID := uuid.New().String()

	name := claims.Name
	if name == "" {
		if claims.GivenName != "" || claims.FamilyName != "" {
			name = strings.TrimSpace(claims.GivenName + " " + claims.FamilyName)
		} else if claims.PreferredName != "" {
			name = claims.PreferredName
		} else if strings.Contains(claims.Email, "@") {
			name = strings.Split(claims.Email, "@")[0]
		} else {
			name = "User"
		}
	}

	user := db.User{
		ID:         userID,
		Provider:   "oidc",
		ProviderID: claims.UserID,
		Email:      claims.Email,
		Name:       name,
		Role:       "engineer",
		Team:       "Default Team",
		IsActive:   true,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if err := h.UserService.CreateUserRecord(user); err != nil {
		return "", err
	}

	// Link identity
	if linkErr := h.UserService.LinkUserIdentity(userID, "oidc", claims.UserID, claims.Email); linkErr != nil {
		log.Printf("Warning: failed to link identity for new user: %v", linkErr)
	}

	log.Printf("TOKEN EXCHANGE - Created new user: %s (uuid:%s)", claims.Email, userID)
	return userID, nil
}
