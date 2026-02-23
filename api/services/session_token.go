package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// SessionTokenService handles backend-issued session tokens.
//
// Architecture: "Token Exchange" pattern (RFC 8693 inspired)
//
//	┌──────────┐    ID Token     ┌──────────────┐     JWKS      ┌──────────────┐
//	│  Client   │───────────────>│   Backend     │──────────────>│ OIDC Provider│
//	│ (Web/App) │                │ /auth/token   │<──────────────│ (Cloudflare) │
//	└──────────┘                 └──────────────┘                └──────────────┘
//	     │                             │
//	     │  session_token (1h)         │ Verify ID Token once,
//	     │  refresh_token (7d)         │ then issue own tokens
//	     │<────────────────────────────│
//	     │                             │
//	     │  Bearer session_token       │
//	     │────────────────────────────>│ Fast local HMAC verify
//	     │  200 OK                     │ No external calls!
//	     │<────────────────────────────│
//
// Benefits:
//   - Provider-agnostic: Works with ANY OIDC provider (Cloudflare, Google, Zitadel, Dex...)
//   - Backend controls lifetime: No dependency on provider's 5-min ID Token expiry
//   - Stateless & fast: HMAC-SHA256 verification in microseconds
//   - Zero external calls: After initial exchange, no calls to OIDC provider
type SessionTokenService struct {
	secretKey     []byte
	sessionExpiry time.Duration
	refreshExpiry time.Duration
	issuer        string // "slar" - distinguishes from OIDC tokens
}

// SessionTokenClaims represents claims in a backend-issued session token
type SessionTokenClaims struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	TokenType string `json:"token_type"` // "session" or "refresh"
	jwt.RegisteredClaims
}

// TokenPair contains the session token and refresh token returned to clients
type TokenPair struct {
	SessionToken string `json:"session_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"` // Session token TTL in seconds
	TokenType    string `json:"token_type"` // Always "Bearer"
}

const (
	TokenTypeSession = "session"
	TokenTypeRefresh = "refresh"
	SessionIssuer    = "slar"
)

// NewSessionTokenService creates a new session token service
// secretKey: HMAC secret for signing tokens (min 32 bytes recommended)
// If empty, generates a random secret (tokens won't survive server restart)
func NewSessionTokenService(secretKey string) *SessionTokenService {
	var key []byte
	if secretKey != "" {
		key = []byte(secretKey)
	} else {
		// Generate random secret - tokens won't survive restart
		// This is acceptable for development but should be configured in production
		key = make([]byte, 32)
		rand.Read(key)
		fmt.Println("⚠️  SESSION_SECRET not configured, using random key (tokens won't survive restart)")
	}

	return &SessionTokenService{
		secretKey:     key,
		sessionExpiry: 1 * time.Hour,      // Session token: 1 hour
		refreshExpiry: 7 * 24 * time.Hour, // Refresh token: 7 days
		issuer:        SessionIssuer,
	}
}

// IssueTokenPair creates a session token + refresh token for a verified user
// Called after successful OIDC ID Token verification
func (s *SessionTokenService) IssueTokenPair(userID, email, role string) (*TokenPair, error) {
	if userID == "" || email == "" {
		return nil, errors.New("user_id and email are required")
	}
	if role == "" {
		role = "authenticated"
	}

	now := time.Now()

	// Generate unique token ID for the session token
	sessionJTI, err := generateTokenID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate token ID: %w", err)
	}

	// Create session token (short-lived, for API calls)
	sessionClaims := SessionTokenClaims{
		UserID:    userID,
		Email:     email,
		Role:      role,
		TokenType: TokenTypeSession,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.sessionExpiry)),
			ID:        sessionJTI,
		},
	}

	sessionToken, err := s.signToken(sessionClaims)
	if err != nil {
		return nil, fmt.Errorf("failed to sign session token: %w", err)
	}

	// Generate unique token ID for the refresh token
	refreshJTI, err := generateTokenID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate token ID: %w", err)
	}

	// Create refresh token (long-lived, for getting new session tokens)
	refreshClaims := SessionTokenClaims{
		UserID:    userID,
		Email:     email,
		Role:      role,
		TokenType: TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.refreshExpiry)),
			ID:        refreshJTI,
		},
	}

	refreshToken, err := s.signToken(refreshClaims)
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenPair{
		SessionToken: sessionToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(s.sessionExpiry.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

// ValidateSessionToken validates a session token and returns claims
// Returns error if token is expired, invalid, or not a session token
func (s *SessionTokenService) ValidateSessionToken(tokenString string) (*SessionTokenClaims, error) {
	claims, err := s.parseToken(tokenString)
	if err != nil {
		return nil, err
	}

	if claims.TokenType != TokenTypeSession {
		return nil, errors.New("not a session token")
	}

	return claims, nil
}

// ValidateRefreshToken validates a refresh token and returns claims
// Returns error if token is expired, invalid, or not a refresh token
func (s *SessionTokenService) ValidateRefreshToken(tokenString string) (*SessionTokenClaims, error) {
	claims, err := s.parseToken(tokenString)
	if err != nil {
		return nil, err
	}

	if claims.TokenType != TokenTypeRefresh {
		return nil, errors.New("not a refresh token")
	}

	return claims, nil
}

// RefreshSessionToken validates a refresh token and issues a new session token
// The refresh token itself is NOT rotated (stays valid until its expiry)
// This keeps the implementation stateless while being secure enough for most use cases
func (s *SessionTokenService) RefreshSessionToken(refreshTokenString string) (*TokenPair, error) {
	// Validate the refresh token
	claims, err := s.ValidateRefreshToken(refreshTokenString)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}

	// Issue new session token with same user info
	now := time.Now()
	sessionJTI, err := generateTokenID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate token ID: %w", err)
	}

	sessionClaims := SessionTokenClaims{
		UserID:    claims.UserID,
		Email:     claims.Email,
		Role:      claims.Role,
		TokenType: TokenTypeSession,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   claims.UserID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.sessionExpiry)),
			ID:        sessionJTI,
		},
	}

	sessionToken, err := s.signToken(sessionClaims)
	if err != nil {
		return nil, fmt.Errorf("failed to sign session token: %w", err)
	}

	return &TokenPair{
		SessionToken: sessionToken,
		RefreshToken: refreshTokenString, // Return same refresh token (not rotated)
		ExpiresIn:    int64(s.sessionExpiry.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

// IsSessionToken performs a quick check to see if a token MIGHT be a session token
// This is used by the middleware to decide which verification path to take
// It does NOT fully validate the token - just checks the issuer claim
func (s *SessionTokenService) IsSessionToken(tokenString string) bool {
	// Parse without validation to peek at claims
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	claims := &SessionTokenClaims{}
	_, _, err := parser.ParseUnverified(tokenString, claims)
	if err != nil {
		return false
	}
	return claims.Issuer == s.issuer
}

// signToken signs a token with HMAC-SHA256
func (s *SessionTokenService) signToken(claims SessionTokenClaims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secretKey)
}

// parseToken parses and validates a token
func (s *SessionTokenService) parseToken(tokenString string) (*SessionTokenClaims, error) {
	claims := &SessionTokenClaims{}

	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		// Verify signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.secretKey, nil
	}, jwt.WithIssuer(s.issuer), jwt.WithValidMethods([]string{"HS256"}))

	if err != nil {
		return nil, fmt.Errorf("token validation failed: %w", err)
	}

	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}

// generateTokenID creates a random token ID (jti claim)
func generateTokenID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
