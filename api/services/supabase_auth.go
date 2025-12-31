package services

import (
	"crypto/ecdsa"
	"crypto/elliptic"
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

type SupabaseAuthService struct {
	SupabaseURL  string
	JWTSecret    string // Legacy: only for HS256 fallback
	rsaKeys      map[string]*rsa.PublicKey
	ecdsaKeys    map[string]*ecdsa.PublicKey
	keysMutex    sync.RWMutex
	lastKeyFetch time.Time
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
	Kty string `json:"kty"` // Key type: "RSA" or "EC"
	Kid string `json:"kid"` // Key ID
	Use string `json:"use"` // Key usage: "sig"
	Alg string `json:"alg"` // Algorithm: "RS256", "ES256"
	// RSA fields
	N string `json:"n,omitempty"` // RSA modulus
	E string `json:"e,omitempty"` // RSA exponent
	// EC fields
	Crv string `json:"crv,omitempty"` // Curve: "P-256"
	X   string `json:"x,omitempty"`   // EC X coordinate
	Y   string `json:"y,omitempty"`   // EC Y coordinate
}

func NewSupabaseAuthService(supabaseURL, jwtSecret string) *SupabaseAuthService {
	return &SupabaseAuthService{
		SupabaseURL: supabaseURL,
		JWTSecret:   jwtSecret,
		rsaKeys:     make(map[string]*rsa.PublicKey),
		ecdsaKeys:   make(map[string]*ecdsa.PublicKey),
	}
}

// ValidateSupabaseToken validates a Supabase JWT token
func (s *SupabaseAuthService) ValidateSupabaseToken(tokenString string) (*SupabaseClaims, error) {
	// Parse token without verification first to get the header
	token, _, err := new(jwt.Parser).ParseUnverified(tokenString, &SupabaseClaims{})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %v", err)
	}

	// Get the key ID from token header
	var keyID string
	if kid, ok := token.Header["kid"].(string); ok {
		keyID = kid
	}

	// Get the signing algorithm
	alg, _ := token.Header["alg"].(string)

	// Try to validate with JWT secret first (for HS256 tokens - legacy)
	if s.JWTSecret != "" && alg == "HS256" {
		if claims, err := s.validateWithSecret(tokenString); err == nil {
			return claims, nil
		}
	}

	// For asymmetric algorithms (ES256, RS256), use JWKS
	if keyID != "" {
		switch alg {
		case "ES256":
			return s.validateWithECDSA(tokenString, keyID)
		case "RS256":
			return s.validateWithRSA(tokenString, keyID)
		}
	}

	return nil, errors.New("invalid token: no valid validation method found")
}

// validateWithSecret validates token using JWT secret (HS256)
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
		if time.Now().Unix() > claims.Exp {
			return nil, errors.New("token has expired")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token claims")
}

// validateWithECDSA validates token using ECDSA public key (ES256)
func (s *SupabaseAuthService) validateWithECDSA(tokenString string, keyID string) (*SupabaseClaims, error) {
	publicKey, err := s.getECDSAPublicKey(keyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get ECDSA public key: %v", err)
	}

	token, err := jwt.ParseWithClaims(tokenString, &SupabaseClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodECDSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return publicKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*SupabaseClaims); ok && token.Valid {
		if time.Now().Unix() > claims.Exp {
			return nil, errors.New("token has expired")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token claims")
}

// validateWithRSA validates token using RSA public key (RS256)
func (s *SupabaseAuthService) validateWithRSA(tokenString string, keyID string) (*SupabaseClaims, error) {
	publicKey, err := s.getRSAPublicKey(keyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get RSA public key: %v", err)
	}

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
		if time.Now().Unix() > claims.Exp {
			return nil, errors.New("token has expired")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token claims")
}

// fetchJWKS fetches and caches JWKS from Supabase
func (s *SupabaseAuthService) fetchJWKS() (*JWKSResponse, error) {
	jwksURL := fmt.Sprintf("%s/auth/v1/.well-known/jwks.json", s.SupabaseURL)
	resp, err := http.Get(jwksURL)
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

// Cache TTL for JWKS keys (per Supabase docs: edge caches for 10 min)
const jwksCacheTTL = 10 * time.Minute

// getECDSAPublicKey retrieves ECDSA public key from JWKS
func (s *SupabaseAuthService) getECDSAPublicKey(keyID string) (*ecdsa.PublicKey, error) {
	s.keysMutex.RLock()
	key, exists := s.ecdsaKeys[keyID]
	cacheValid := time.Since(s.lastKeyFetch) < jwksCacheTTL
	s.keysMutex.RUnlock()

	if exists && cacheValid {
		return key, nil
	}

	// Fetch JWKS
	jwks, err := s.fetchJWKS()
	if err != nil {
		return nil, err
	}

	// Find the EC key with matching key ID
	for _, key := range jwks.Keys {
		if key.Kid == keyID && key.Kty == "EC" {
			publicKey, err := s.parseECDSAPublicKey(key.Crv, key.X, key.Y)
			if err != nil {
				return nil, fmt.Errorf("failed to parse ECDSA public key: %v", err)
			}

			// Cache the key
			s.keysMutex.Lock()
			s.ecdsaKeys[keyID] = publicKey
			s.lastKeyFetch = time.Now()
			s.keysMutex.Unlock()

			return publicKey, nil
		}
	}

	return nil, fmt.Errorf("ECDSA public key not found for key ID: %s", keyID)
}

// getRSAPublicKey retrieves RSA public key from JWKS
func (s *SupabaseAuthService) getRSAPublicKey(keyID string) (*rsa.PublicKey, error) {
	s.keysMutex.RLock()
	key, exists := s.rsaKeys[keyID]
	cacheValid := time.Since(s.lastKeyFetch) < jwksCacheTTL
	s.keysMutex.RUnlock()

	if exists && cacheValid {
		return key, nil
	}

	// Fetch JWKS
	jwks, err := s.fetchJWKS()
	if err != nil {
		return nil, err
	}

	// Find the RSA key with matching key ID
	for _, key := range jwks.Keys {
		if key.Kid == keyID && key.Kty == "RSA" {
			publicKey, err := s.parseRSAPublicKey(key.N, key.E)
			if err != nil {
				return nil, fmt.Errorf("failed to parse RSA public key: %v", err)
			}

			// Cache the key
			s.keysMutex.Lock()
			s.rsaKeys[keyID] = publicKey
			s.lastKeyFetch = time.Now()
			s.keysMutex.Unlock()

			return publicKey, nil
		}
	}

	return nil, fmt.Errorf("RSA public key not found for key ID: %s", keyID)
}

// parseECDSAPublicKey creates ECDSA public key from JWK parameters
func (s *SupabaseAuthService) parseECDSAPublicKey(crv, xStr, yStr string) (*ecdsa.PublicKey, error) {
	// Determine curve
	var curve elliptic.Curve
	switch crv {
	case "P-256":
		curve = elliptic.P256()
	case "P-384":
		curve = elliptic.P384()
	case "P-521":
		curve = elliptic.P521()
	default:
		return nil, fmt.Errorf("unsupported curve: %s", crv)
	}

	// Decode base64url-encoded X coordinate
	xBytes, err := base64.RawURLEncoding.DecodeString(xStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode X coordinate: %v", err)
	}

	// Decode base64url-encoded Y coordinate
	yBytes, err := base64.RawURLEncoding.DecodeString(yStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode Y coordinate: %v", err)
	}

	// Create ECDSA public key
	publicKey := &ecdsa.PublicKey{
		Curve: curve,
		X:     new(big.Int).SetBytes(xBytes),
		Y:     new(big.Int).SetBytes(yBytes),
	}

	return publicKey, nil
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

	// Create RSA public key
	publicKey := &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
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
