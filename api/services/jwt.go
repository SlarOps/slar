package services

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Simple JWT implementation without external dependencies
type JWTService struct {
	secretKey string
}

type JWTClaims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

type JWTHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

func NewJWTService(secretKey string) *JWTService {
	if secretKey == "" {
		secretKey = "slar-default-secret-key-change-in-production"
	}
	return &JWTService{secretKey: secretKey}
}

// GenerateToken creates a JWT token for the user
func (j *JWTService) GenerateToken(userID, email, role string) (string, error) {
	// Create header
	header := JWTHeader{
		Alg: "HS256",
		Typ: "JWT",
	}

	// Create claims
	now := time.Now()
	claims := JWTClaims{
		UserID: userID,
		Email:  email,
		Role:   role,
		Iat:    now.Unix(),
		Exp:    now.Add(24 * time.Hour).Unix(), // Token expires in 24 hours
	}

	// Encode header
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	headerEncoded := base64.RawURLEncoding.EncodeToString(headerBytes)

	// Encode claims
	claimsBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	claimsEncoded := base64.RawURLEncoding.EncodeToString(claimsBytes)

	// Create signature
	message := headerEncoded + "." + claimsEncoded
	signature := j.createSignature(message)

	// Combine all parts
	token := message + "." + signature

	return token, nil
}

// ValidateToken validates a JWT token and returns claims
func (j *JWTService) ValidateToken(tokenString string) (*JWTClaims, error) {
	// Split token into parts
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}

	headerEncoded := parts[0]
	claimsEncoded := parts[1]
	signature := parts[2]

	// Verify signature
	message := headerEncoded + "." + claimsEncoded
	expectedSignature := j.createSignature(message)
	if signature != expectedSignature {
		return nil, errors.New("invalid token signature")
	}

	// Decode claims
	claimsBytes, err := base64.RawURLEncoding.DecodeString(claimsEncoded)
	if err != nil {
		return nil, errors.New("invalid token claims encoding")
	}

	var claims JWTClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, errors.New("invalid token claims format")
	}

	// Check expiration
	if time.Now().Unix() > claims.Exp {
		return nil, errors.New("token has expired")
	}

	return &claims, nil
}

// createSignature creates HMAC-SHA256 signature
func (j *JWTService) createSignature(message string) string {
	h := hmac.New(sha256.New, []byte(j.secretKey))
	h.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// ExtractTokenFromHeader extracts token from Authorization header
func (j *JWTService) ExtractTokenFromHeader(authHeader string) (string, error) {
	if authHeader == "" {
		return "", errors.New("authorization header is required")
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", errors.New("invalid authorization header format")
	}

	return parts[1], nil
}

// RefreshToken creates a new token with extended expiration
func (j *JWTService) RefreshToken(tokenString string) (string, error) {
	claims, err := j.ValidateToken(tokenString)
	if err != nil {
		return "", err
	}

	// Generate new token with same claims but new expiration
	return j.GenerateToken(claims.UserID, claims.Email, claims.Role)
}
