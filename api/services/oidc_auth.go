package services

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// OIDCAuthService handles JWT verification for any OIDC-compliant provider
// Supports: Keycloak, Auth0, Okta, Azure AD, Google, etc.
type OIDCAuthService struct {
	Issuer       string
	ClientID     string
	rsaKeys      map[string]*rsa.PublicKey
	keysMutex    sync.RWMutex
	lastKeyFetch time.Time
	jwksURI      string
}

// OIDCClaims represents standard OIDC claims
type OIDCClaims struct {
	UserID        string                 `json:"sub"`
	Email         string                 `json:"email"`
	EmailVerified bool                   `json:"email_verified"`
	Name          string                 `json:"name"`
	GivenName     string                 `json:"given_name"`
	FamilyName    string                 `json:"family_name"`
	Locale        string                 `json:"locale"`
	PreferredName string                 `json:"preferred_username"`
	Picture       string                 `json:"picture"`
	// Authentication time - when user actually logged in (not token issue time)
	AuthTime int64 `json:"auth_time"`
	// Common custom claims across providers
	Roles  []string               `json:"roles"`
	Groups []string               `json:"groups"`
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

// OIDCDiscovery represents the OIDC discovery document
type OIDCDiscovery struct {
	Issuer                string   `json:"issuer"`
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	UserInfoEndpoint      string   `json:"userinfo_endpoint"`
	JwksURI               string   `json:"jwks_uri"`
	ScopesSupported       []string `json:"scopes_supported"`
}

// NewOIDCAuthService creates a new OIDC auth service
// issuer: The OIDC issuer URL (e.g., "https://auth.example.com" or "https://accounts.google.com")
// clientID: The client ID for audience validation (optional, pass "" to skip audience check)
func NewOIDCAuthService(issuer, clientID string) (*OIDCAuthService, error) {
	// Ensure issuer has protocol
	if !strings.HasPrefix(issuer, "http://") && !strings.HasPrefix(issuer, "https://") {
		issuer = "https://" + issuer
	}
	// Remove trailing slash
	issuer = strings.TrimSuffix(issuer, "/")

	service := &OIDCAuthService{
		Issuer:   issuer,
		ClientID: clientID,
		rsaKeys:  make(map[string]*rsa.PublicKey),
	}

	// Fetch OIDC discovery document to get JWKS URI
	if err := service.fetchDiscovery(); err != nil {
		// Log warning but don't fail - JWKS URI might be configured manually
		fmt.Printf("Warning: Failed to fetch OIDC discovery: %v\n", err)
		// Use default JWKS URI pattern
		service.jwksURI = issuer + "/.well-known/jwks.json"
	}

	return service, nil
}

// fetchDiscovery fetches the OIDC discovery document
func (o *OIDCAuthService) fetchDiscovery() error {
	discoveryURL := o.Issuer + "/.well-known/openid-configuration"

	resp, err := http.Get(discoveryURL)
	if err != nil {
		return fmt.Errorf("failed to fetch OIDC discovery: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("OIDC discovery endpoint returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read discovery response: %v", err)
	}

	var discovery OIDCDiscovery
	if err := json.Unmarshal(body, &discovery); err != nil {
		return fmt.Errorf("failed to parse discovery document: %v", err)
	}

	o.jwksURI = discovery.JwksURI
	return nil
}

// ValidateToken validates an OIDC JWT token from any compliant provider
func (o *OIDCAuthService) ValidateToken(tokenString string) (*OIDCClaims, error) {
	// Parse token without verification first to get the header
	token, _, err := new(jwt.Parser).ParseUnverified(tokenString, &OIDCClaims{})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %v", err)
	}

	// Get the key ID from token header
	keyID, ok := token.Header["kid"].(string)
	if !ok || keyID == "" {
		return nil, errors.New("missing kid in token header")
	}

	// Get the signing algorithm - support RS256, RS384, RS512
	alg, _ := token.Header["alg"].(string)
	if !strings.HasPrefix(alg, "RS") {
		return nil, fmt.Errorf("unsupported algorithm: %s (expected RS256/RS384/RS512)", alg)
	}

	// Get public key and verify
	publicKey, err := o.getPublicKey(keyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get public key: %v", err)
	}

	// Parse and verify token with the public key
	parserOpts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{"RS256", "RS384", "RS512"}),
	}

	// Add issuer validation
	parserOpts = append(parserOpts, jwt.WithIssuer(o.Issuer))

	// Add audience validation if client ID is configured
	if o.ClientID != "" {
		parserOpts = append(parserOpts, jwt.WithAudience(o.ClientID))
	}

	token, err = jwt.ParseWithClaims(tokenString, &OIDCClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return publicKey, nil
	}, parserOpts...)

	if err != nil {
		return nil, fmt.Errorf("token validation failed: %v", err)
	}

	if claims, ok := token.Claims.(*OIDCClaims); ok && token.Valid {
		// Check expiration
		if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
			return nil, errors.New("token has expired")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token claims")
}

// JWKS cache TTL
const oidcJWKSCacheTTL = 10 * time.Minute

// getPublicKey retrieves RSA public key from OIDC provider's JWKS
func (o *OIDCAuthService) getPublicKey(keyID string) (*rsa.PublicKey, error) {
	o.keysMutex.RLock()
	key, exists := o.rsaKeys[keyID]
	cacheValid := time.Since(o.lastKeyFetch) < oidcJWKSCacheTTL
	o.keysMutex.RUnlock()

	if exists && cacheValid {
		return key, nil
	}

	// Fetch JWKS from OIDC provider
	jwks, err := o.fetchJWKS()
	if err != nil {
		return nil, err
	}

	// Find the key with matching key ID
	for _, jwkKey := range jwks.Keys {
		if jwkKey.Kid == keyID && jwkKey.Kty == "RSA" {
			publicKey, err := o.parseRSAPublicKey(jwkKey.N, jwkKey.E)
			if err != nil {
				return nil, fmt.Errorf("failed to parse RSA public key: %v", err)
			}

			// Cache the key
			o.keysMutex.Lock()
			o.rsaKeys[keyID] = publicKey
			o.lastKeyFetch = time.Now()
			o.keysMutex.Unlock()

			return publicKey, nil
		}
	}

	return nil, fmt.Errorf("RSA public key not found for key ID: %s", keyID)
}

// fetchJWKS fetches JWKS from the OIDC provider
func (o *OIDCAuthService) fetchJWKS() (*JWKSResponse, error) {
	if o.jwksURI == "" {
		return nil, errors.New("JWKS URI not configured")
	}

	resp, err := http.Get(o.jwksURI)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS endpoint returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read JWKS response: %v", err)
	}

	var jwks JWKSResponse
	if err := json.Unmarshal(body, &jwks); err != nil {
		return nil, fmt.Errorf("failed to parse JWKS: %v", err)
	}

	return &jwks, nil
}

// parseRSAPublicKey creates RSA public key from JWK parameters
func (o *OIDCAuthService) parseRSAPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
	// Decode base64url-encoded modulus (n)
	nBytes, err := base64.RawURLEncoding.DecodeString(nStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %v", err)
	}

	// Decode base64url-encoded exponent (e)
	eBytes, err := base64.RawURLEncoding.DecodeString(eStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %v", err)
	}

	// Create RSA public key
	publicKey := &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}

	return publicKey, nil
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

