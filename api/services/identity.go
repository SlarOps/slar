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
