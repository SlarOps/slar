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
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type SupabaseAuthService struct {
	SupabaseURL string
	AnonKey     string
	JWTSecret   string
	publicKeys  map[string]*rsa.PublicKey
}

type SupabaseClaims struct {
	UserID   string                 `json:"sub"`
	Email    string                 `json:"email"`
	Role     string                 `json:"role"`
	Aud      string                 `json:"aud"`
	Exp      int64                  `json:"exp"`
	Iat      int64                  `json:"iat"`
	UserMeta map[string]interface{} `json:"user_metadata"`
	AppMeta  map[string]interface{} `json:"app_metadata"`
	jwt.RegisteredClaims
}

type JWKSResponse struct {
	Keys []JWKKey `json:"keys"`
}

type JWKKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func NewSupabaseAuthService(supabaseURL, anonKey, jwtSecret string) *SupabaseAuthService {
	return &SupabaseAuthService{
		SupabaseURL: supabaseURL,
		AnonKey:     anonKey,
		JWTSecret:   jwtSecret,
		publicKeys:  make(map[string]*rsa.PublicKey),
	}
}

// ValidateSupabaseToken validates a Supabase JWT token
func (s *SupabaseAuthService) ValidateSupabaseToken(tokenString string) (*SupabaseClaims, error) {
	// Parse token without verification first to get the header
	token, _, err := new(jwt.Parser).ParseUnverified(tokenString, &SupabaseClaims{})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %v", err)
	}

	// Log token header for debugging
	fmt.Printf("DEBUG: Token algorithm: %v\n", token.Header["alg"])
	fmt.Printf("DEBUG: Token kid: %v\n", token.Header["kid"])
	fmt.Printf("DEBUG: JWT Secret present: %v\n", s.JWTSecret != "")

	// Get the key ID from token header
	var keyID string
	if kid, ok := token.Header["kid"].(string); ok {
		keyID = kid
	}

	// Get the signing algorithm
	alg, _ := token.Header["alg"].(string)

	// Try to validate with JWT secret first (for HS256 tokens like service role)
	if s.JWTSecret != "" && alg == "HS256" {
		fmt.Println("DEBUG: Attempting HS256 validation with JWT secret")
		if claims, err := s.validateWithSecret(tokenString); err == nil {
			return claims, nil
		} else {
			fmt.Printf("DEBUG: HS256 validation failed: %v\n", err)
		}
	}

	// If JWT secret validation fails, try JWKS validation (for RS256 user tokens)
	if keyID != "" {
		fmt.Println("DEBUG: Attempting JWKS validation")
		publicKey, err := s.getPublicKey(keyID)
		if err != nil {
			fmt.Printf("DEBUG: Failed to get public key: %v\n", err)
			return nil, fmt.Errorf("failed to get public key: %v", err)
		}

		return s.validateWithPublicKey(tokenString, publicKey)
	}

	fmt.Println("DEBUG: No valid validation method found")
	return nil, errors.New("invalid token: no valid validation method found")
}

// validateWithSecret validates token using JWT secret
func (s *SupabaseAuthService) validateWithSecret(tokenString string) (*SupabaseClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &SupabaseClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(s.JWTSecret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*SupabaseClaims); ok && token.Valid {
		// Check if token is expired
		if time.Now().Unix() > claims.Exp {
			return nil, errors.New("token has expired")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token claims")
}

// validateWithPublicKey validates token using RSA public key from JWKS
func (s *SupabaseAuthService) validateWithPublicKey(tokenString string, publicKey *rsa.PublicKey) (*SupabaseClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &SupabaseClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return publicKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*SupabaseClaims); ok && token.Valid {
		// Check if token is expired
		if time.Now().Unix() > claims.Exp {
			return nil, errors.New("token has expired")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token claims")
}

// getPublicKey retrieves RSA public key from Supabase JWKS endpoint
func (s *SupabaseAuthService) getPublicKey(keyID string) (*rsa.PublicKey, error) {
	// Check if we already have this key cached
	if key, exists := s.publicKeys[keyID]; exists {
		return key, nil
	}

	// Fetch JWKS from Supabase
	jwksURL := fmt.Sprintf("%s/auth/v1/jwks", s.SupabaseURL)
	resp, err := http.Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read JWKS response: %v", err)
	}

	var jwks JWKSResponse
	if err := json.Unmarshal(body, &jwks); err != nil {
		return nil, fmt.Errorf("failed to parse JWKS: %v", err)
	}

	// Find the key with matching key ID
	for _, key := range jwks.Keys {
		if key.Kid == keyID && key.Kty == "RSA" {
			publicKey, err := s.parseRSAPublicKey(key.N, key.E)
			if err != nil {
				return nil, fmt.Errorf("failed to parse RSA public key: %v", err)
			}

			// Cache the key
			s.publicKeys[keyID] = publicKey
			return publicKey, nil
		}
	}

	return nil, fmt.Errorf("public key not found for key ID: %s", keyID)
}

// parseRSAPublicKey creates RSA public key from JWK parameters
func (s *SupabaseAuthService) parseRSAPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
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

	// Convert bytes to big integers
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	// Create RSA public key
	publicKey := &rsa.PublicKey{
		N: n,
		E: int(e.Int64()),
	}

	return publicKey, nil
}

// ExtractTokenFromHeader extracts token from Authorization header
func (s *SupabaseAuthService) ExtractTokenFromHeader(authHeader string) (string, error) {
	if authHeader == "" {
		return "", errors.New("authorization header is required")
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", errors.New("invalid authorization header format")
	}

	return parts[1], nil
}

// GetUserInfo extracts user information from Supabase claims
func (s *SupabaseAuthService) GetUserInfo(claims *SupabaseClaims) map[string]interface{} {
	userInfo := map[string]interface{}{
		"id":    claims.UserID,
		"email": claims.Email,
		"role":  claims.Role,
	}

	// Add user metadata if available
	if claims.UserMeta != nil {
		if name, ok := claims.UserMeta["full_name"]; ok {
			userInfo["name"] = name
		}
		if avatar, ok := claims.UserMeta["avatar_url"]; ok {
			userInfo["avatar"] = avatar
		}
	}

	return userInfo
}
