package services

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// IdentityService handles the instance's identity (ECDSA keypair)
type IdentityService struct {
	privateKey *ecdsa.PrivateKey
	keyPath    string
	mu         sync.RWMutex
}

// NewIdentityService creates a new IdentityService and loads/generates the keypair
func NewIdentityService(dataDir string) (*IdentityService, error) {
	keyPath := filepath.Join(dataDir, "identity.key")
	service := &IdentityService{
		keyPath: keyPath,
	}

	if err := service.loadOrGenerateKey(); err != nil {
		return nil, err
	}

	return service, nil
}

// loadOrGenerateKey loads the private key from disk or generates a new one
func (s *IdentityService) loadOrGenerateKey() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if key file exists
	if _, err := os.Stat(s.keyPath); os.IsNotExist(err) {
		// Generate new key
		return s.generateAndSaveKey()
	}

	// Load existing key
	return s.loadKey()
}

// generateAndSaveKey generates a new P-256 keypair and saves it to disk
func (s *IdentityService) generateAndSaveKey() error {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate key: %w", err)
	}

	// Encode private key to PEM
	x509Encoded, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		return fmt.Errorf("failed to marshal private key: %w", err)
	}

	pemEncoded := pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: x509Encoded,
	})

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(s.keyPath), 0700); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Write to file
	if err := os.WriteFile(s.keyPath, pemEncoded, 0600); err != nil {
		return fmt.Errorf("failed to write key file: %w", err)
	}

	s.privateKey = privateKey
	return nil
}

// loadKey loads the private key from disk
func (s *IdentityService) loadKey() error {
	pemEncoded, err := os.ReadFile(s.keyPath)
	if err != nil {
		return fmt.Errorf("failed to read key file: %w", err)
	}

	block, _ := pem.Decode(pemEncoded)
	if block == nil {
		return fmt.Errorf("failed to decode PEM block")
	}

	privateKey, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse private key: %w", err)
	}

	s.privateKey = privateKey
	return nil
}

// Sign signs the data using the private key
// Returns the signature as a hex-encoded string (r + s)
func (s *IdentityService) Sign(data []byte) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.privateKey == nil {
		return "", fmt.Errorf("private key not initialized")
	}

	hash := sha256.Sum256(data)
	r, sBig, err := ecdsa.Sign(rand.Reader, s.privateKey, hash[:])
	if err != nil {
		return "", fmt.Errorf("failed to sign data: %w", err)
	}

	// Serialize signature to Raw (R|S) format (64 bytes for P-256)
	// This is easier for Web Crypto API to verify than ASN.1
	params := s.privateKey.Curve.Params()
	curveOrderByteSize := (params.BitSize + 7) / 8

	rBytes := r.Bytes()
	sBytes := sBig.Bytes()

	// Pad R and S to curve order size
	signature := make([]byte, curveOrderByteSize*2)
	copy(signature[curveOrderByteSize-len(rBytes):curveOrderByteSize], rBytes)
	copy(signature[curveOrderByteSize*2-len(sBytes):], sBytes)

	return hex.EncodeToString(signature), nil
}

// SignMap signs a map by converting it to canonical JSON first
// Keys are sorted alphabetically for consistent hashing
func (s *IdentityService) SignMap(data map[string]interface{}) (string, error) {
	// Convert to canonical JSON (sorted keys)
	canonicalJSON, err := canonicalJSONEncode(data)
	if err != nil {
		return "", fmt.Errorf("failed to encode canonical JSON: %w", err)
	}
	return s.Sign([]byte(canonicalJSON))
}

// GetPublicKey returns the public key in PEM format
func (s *IdentityService) GetPublicKey() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.privateKey == nil {
		return "", fmt.Errorf("private key not initialized")
	}

	publicKey := &s.privateKey.PublicKey
	x509EncodedPub, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("failed to marshal public key: %w", err)
	}

	pemEncodedPub := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: x509EncodedPub,
	})

	return string(pemEncodedPub), nil
}

// canonicalJSONEncode converts a map to canonical JSON with sorted keys
func canonicalJSONEncode(data interface{}) (string, error) {
	return encodeValue(data)
}

func encodeValue(v interface{}) (string, error) {
	switch val := v.(type) {
	case map[string]interface{}:
		return encodeMap(val)
	case []interface{}:
		return encodeArray(val)
	case []string:
		arr := make([]interface{}, len(val))
		for i, s := range val {
			arr[i] = s
		}
		return encodeArray(arr)
	case string:
		return fmt.Sprintf("%q", val), nil
	case float64:
		// Check if it's an integer
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val)), nil
		}
		return fmt.Sprintf("%v", val), nil
	case int:
		return fmt.Sprintf("%d", val), nil
	case int64:
		return fmt.Sprintf("%d", val), nil
	case bool:
		if val {
			return "true", nil
		}
		return "false", nil
	case nil:
		return "null", nil
	default:
		return fmt.Sprintf("%q", fmt.Sprintf("%v", val)), nil
	}
}

func encodeMap(m map[string]interface{}) (string, error) {
	// Get sorted keys
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sortStrings(keys)

	result := "{"
	for i, k := range keys {
		if i > 0 {
			result += ","
		}
		encodedValue, err := encodeValue(m[k])
		if err != nil {
			return "", err
		}
		result += fmt.Sprintf("%q:%s", k, encodedValue)
	}
	result += "}"
	return result, nil
}

func encodeArray(arr []interface{}) (string, error) {
	result := "["
	for i, v := range arr {
		if i > 0 {
			result += ","
		}
		encodedValue, err := encodeValue(v)
		if err != nil {
			return "", err
		}
		result += encodedValue
	}
	result += "]"
	return result, nil
}

// Simple string sort (to avoid importing sort package)
func sortStrings(s []string) {
	for i := 0; i < len(s)-1; i++ {
		for j := i + 1; j < len(s); j++ {
			if s[i] > s[j] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
}
