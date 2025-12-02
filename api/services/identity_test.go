package services

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
)

func TestIdentityService(t *testing.T) {
	// Create temp dir
	tmpDir, err := os.MkdirTemp("", "identity_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test 1: New Service (Generate Key)
	service, err := NewIdentityService(tmpDir)
	if err != nil {
		t.Fatalf("Failed to create identity service: %v", err)
	}

	// Check if key file exists
	keyPath := filepath.Join(tmpDir, "identity.key")
	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		t.Errorf("Key file was not created at %s", keyPath)
	}

	// Test 2: Get Public Key
	pubKeyPEM, err := service.GetPublicKey()
	if err != nil {
		t.Fatalf("Failed to get public key: %v", err)
	}
	if pubKeyPEM == "" {
		t.Error("Public key is empty")
	}

	// Test 3: Sign Data
	data := []byte("test payload")
	signatureHex, err := service.Sign(data)
	if err != nil {
		t.Fatalf("Failed to sign data: %v", err)
	}
	if signatureHex == "" {
		t.Error("Signature is empty")
	}

	// Test 4: Verify Signature (Manual)
	// Decode PEM public key
	block, _ := pem.Decode([]byte(pubKeyPEM))
	if block == nil {
		t.Fatal("Failed to decode public key PEM")
	}
	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("Failed to parse public key: %v", err)
	}
	ecdsaPubKey, ok := pubKey.(*ecdsa.PublicKey)
	if !ok {
		t.Fatal("Public key is not ECDSA")
	}

	// Decode signature (Raw hex)
	sigBytes, err := hex.DecodeString(signatureHex)
	if err != nil {
		t.Fatalf("Failed to decode hex signature: %v", err)
	}

	if len(sigBytes) != 64 {
		t.Fatalf("Invalid signature length: got %d, want 64", len(sigBytes))
	}

	r := new(big.Int).SetBytes(sigBytes[:32])
	s := new(big.Int).SetBytes(sigBytes[32:])

	hash := sha256.Sum256(data)
	if !ecdsa.Verify(ecdsaPubKey, hash[:], r, s) {
		t.Error("Signature verification failed")
	}
}
