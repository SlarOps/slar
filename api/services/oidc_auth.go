package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
)

// OIDCAuthService handles JWT verification for any OIDC-compliant provider
// Uses coreos/go-oidc for standard-compliant token verification
// Supports: Keycloak, Auth0, Okta, Azure AD, Google, Dex, Zitadel, etc.
type OIDCAuthService struct {
	Issuer    string
	ClientID  string   // Primary client ID (for backward compatibility)
	ClientIDs []string // All valid client IDs (web, mobile, etc.)

	// go-oidc provider and verifier
	provider  *oidc.Provider
	verifiers map[string]*oidc.IDTokenVerifier // verifier per client ID
}

// OIDCClaims represents standard OIDC claims
type OIDCClaims struct {
	UserID        string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Locale        string `json:"locale"`
	PreferredName string `json:"preferred_username"`
	Picture       string `json:"picture"`
	// Authentication time - when user actually logged in (not token issue time)
	AuthTime int64 `json:"auth_time"`
	// Common custom claims across providers
	Roles  []string `json:"roles"`
	Groups []string `json:"groups"`
	// Provider-specific metadata (Auth0, Keycloak, etc.)
	Metadata map[string]interface{} `json:"metadata"`
	jwt.RegisteredClaims
}

// IsFreshLogin checks if this token represents a fresh login (auth within last N minutes)
func (c *OIDCClaims) IsFreshLogin(withinMinutes int) bool {
	if c.AuthTime == 0 {
		return false
	}
	authTime := time.Unix(c.AuthTime, 0)
	return time.Since(authTime) < time.Duration(withinMinutes)*time.Minute
}

// NewOIDCAuthService creates a new OIDC auth service
// issuer: The OIDC issuer URL (e.g., "https://auth.example.com" or "https://accounts.google.com")
// clientID: The client ID for audience validation (optional, pass "" to skip audience check)
func NewOIDCAuthService(issuer, clientID string) (*OIDCAuthService, error) {
	clientIDs := []string{}
	if clientID != "" {
		clientIDs = append(clientIDs, clientID)
	}
	return NewOIDCAuthServiceWithClientIDs(issuer, clientIDs)
}

// NewOIDCAuthServiceWithClientIDs creates a new OIDC auth service with multiple client IDs
// issuer: The OIDC issuer URL (e.g., "https://auth.example.com" or "https://accounts.google.com")
// clientIDs: List of valid client IDs for audience validation (web, mobile, etc.)
// Tokens with audience matching ANY of these client IDs will be accepted
func NewOIDCAuthServiceWithClientIDs(issuer string, clientIDs []string) (*OIDCAuthService, error) {
	// Ensure issuer has protocol
	if !strings.HasPrefix(issuer, "http://") && !strings.HasPrefix(issuer, "https://") {
		issuer = "https://" + issuer
	}
	// Remove trailing slash
	issuer = strings.TrimSuffix(issuer, "/")

	// Filter out empty client IDs
	validClientIDs := []string{}
	for _, id := range clientIDs {
		if id != "" {
			validClientIDs = append(validClientIDs, id)
		}
	}

	// Set primary ClientID for backward compatibility
	primaryClientID := ""
	if len(validClientIDs) > 0 {
		primaryClientID = validClientIDs[0]
	}

	// Create OIDC provider - automatically fetches discovery document
	ctx := context.Background()
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("failed to create OIDC provider for issuer %s: %w", issuer, err)
	}

	fmt.Printf("✅ OIDC provider initialized for issuer: %s\n", issuer)

	// Create verifiers for each client ID
	verifiers := make(map[string]*oidc.IDTokenVerifier)
	for _, clientID := range validClientIDs {
		verifiers[clientID] = provider.Verifier(&oidc.Config{
			ClientID: clientID,
		})
		fmt.Printf("   ✓ Verifier created for client ID: %s\n", clientID)
	}

	// If no client IDs configured, create a verifier that skips audience check
	if len(validClientIDs) == 0 {
		verifiers[""] = provider.Verifier(&oidc.Config{
			SkipClientIDCheck: true,
		})
		fmt.Println("   ✓ Verifier created (no audience check)")
	}

	return &OIDCAuthService{
		Issuer:    issuer,
		ClientID:  primaryClientID,
		ClientIDs: validClientIDs,
		provider:  provider,
		verifiers: verifiers,
	}, nil
}

// ValidateToken validates an OIDC JWT token from any compliant provider
func (o *OIDCAuthService) ValidateToken(tokenString string) (*OIDCClaims, error) {
	ctx := context.Background()

	// Try to verify with each configured verifier
	var lastErr error
	for clientID, verifier := range o.verifiers {
		idToken, err := verifier.Verify(ctx, tokenString)
		if err != nil {
			lastErr = err
			continue
		}

		// Token verified successfully - extract claims
		claims := &OIDCClaims{}
		if err := idToken.Claims(claims); err != nil {
			return nil, fmt.Errorf("failed to parse claims: %w", err)
		}

		// Set UserID from subject
		claims.UserID = idToken.Subject

		// Set RegisteredClaims from idToken
		claims.RegisteredClaims = jwt.RegisteredClaims{
			Issuer:    idToken.Issuer,
			Subject:   idToken.Subject,
			Audience:  idToken.Audience,
			ExpiresAt: jwt.NewNumericDate(idToken.Expiry),
			IssuedAt:  jwt.NewNumericDate(idToken.IssuedAt),
		}

		if clientID != "" {
			fmt.Printf("✅ Token verified for client ID: %s, user: %s\n", clientID, claims.UserID)
		}

		return claims, nil
	}

	// All verifiers failed
	if lastErr != nil {
		return nil, fmt.Errorf("token validation failed: %w", lastErr)
	}
	return nil, errors.New("no verifier available")
}

// ExtractTokenFromHeader extracts token from Authorization header
func (o *OIDCAuthService) ExtractTokenFromHeader(authHeader string) (string, error) {
	if authHeader == "" {
		return "", errors.New("authorization header is required")
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", errors.New("invalid authorization header format")
	}

	return parts[1], nil
}

// GetUserInfo extracts user information from OIDC claims
// Returns a map compatible with existing code
func (o *OIDCAuthService) GetUserInfo(claims *OIDCClaims) map[string]interface{} {
	userInfo := map[string]interface{}{
		"id":    claims.UserID,
		"email": claims.Email,
		"role":  "authenticated",
	}

	// Add name if available
	if claims.Name != "" {
		userInfo["name"] = claims.Name
	} else if claims.GivenName != "" || claims.FamilyName != "" {
		userInfo["name"] = strings.TrimSpace(claims.GivenName + " " + claims.FamilyName)
	}

	// Add preferred username
	if claims.PreferredName != "" {
		userInfo["preferred_username"] = claims.PreferredName
	}

	// Add picture
	if claims.Picture != "" {
		userInfo["picture"] = claims.Picture
	}

	// Add roles and groups if available
	if len(claims.Roles) > 0 {
		userInfo["roles"] = claims.Roles
	}
	if len(claims.Groups) > 0 {
		userInfo["groups"] = claims.Groups
	}

	// Add metadata if available
	if claims.Metadata != nil {
		userInfo["metadata"] = claims.Metadata
	}

	return userInfo
}

// ToSupabaseClaims converts OIDCClaims to SupabaseClaims for backward compatibility
// This allows existing code that uses SupabaseClaims to work with OIDC tokens
func (o *OIDCAuthService) ToSupabaseClaims(oClaims *OIDCClaims) *SupabaseClaims {
	return &SupabaseClaims{
		UserID: oClaims.UserID,
		Email:  oClaims.Email,
		Role:   "authenticated",
		UserMeta: map[string]interface{}{
			"full_name":   oClaims.Name,
			"given_name":  oClaims.GivenName,
			"family_name": oClaims.FamilyName,
			"picture":     oClaims.Picture,
		},
		RegisteredClaims: oClaims.RegisteredClaims,
	}
}
