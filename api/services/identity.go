package services

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// IdentityService handles the instance's identity (ECDSA keypair)
// Keys are persisted to database for K8s pod restart resilience
type IdentityService struct {
	privateKey *ecdsa.PrivateKey
	keyPath    string
	instanceID string
	db         *sql.DB
	mu         sync.RWMutex
}

// NewIdentityService creates a new IdentityService and loads/generates the keypair
// Priority: 1. Database  2. File  3. Generate new
func NewIdentityService(dataDir string) (*IdentityService, error) {
	return NewIdentityServiceWithDB(dataDir, nil, "")
}

// NewIdentityServiceWithDB creates IdentityService with database support
// This is the preferred constructor for K8s deployments
func NewIdentityServiceWithDB(dataDir string, db *sql.DB, instanceID string) (*IdentityService, error) {
	keyPath := filepath.Join(dataDir, "identity.key")

	// Use environment variable for instance ID if not provided
	if instanceID == "" {
		instanceID = os.Getenv("SLAR_INSTANCE_ID")
		if instanceID == "" {
			instanceID = "default"
		}
	}

	service := &IdentityService{
		keyPath:    keyPath,
		instanceID: instanceID,
		db:         db,
	}

	if err := service.loadOrGenerateKey(); err != nil {
		return nil, err
	}

	return service, nil
}

// loadOrGenerateKey loads the private key with priority: DB -> File -> Generate
func (s *IdentityService) loadOrGenerateKey() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Priority 1: Try loading from database
	if s.db != nil {
		if err := s.loadKeyFromDB(); err == nil {
			log.Printf("[Identity] Loaded key from database for instance: %s", s.instanceID)
			return nil
		} else {
			log.Printf("[Identity] No key in database, trying file: %v", err)
		}
	}

	// Priority 2: Try loading from file
	if _, err := os.Stat(s.keyPath); err == nil {
		if err := s.loadKeyFromFile(); err == nil {
			log.Printf("[Identity] Loaded key from file: %s", s.keyPath)
			// Sync to database for future pod restarts
			s.syncKeyToDB()
			return nil
		} else {
			log.Printf("[Identity] Failed to load key from file: %v", err)
		}
	}

	// Priority 3: Generate new key
	log.Printf("[Identity] Generating new keypair for instance: %s", s.instanceID)
	if err := s.generateKey(); err != nil {
		return err
	}

	// Save to both DB and file
	s.syncKeyToDB()
	s.saveKeyToFile()

	return nil
}

// loadKeyFromDB loads the private key from database
func (s *IdentityService) loadKeyFromDB() error {
	if s.db == nil {
		return fmt.Errorf("database not configured")
	}

	var privateKeyPEM string
	err := s.db.QueryRow(
		"SELECT private_key_pem FROM instance_identity WHERE instance_id = $1",
		s.instanceID,
	).Scan(&privateKeyPEM)

	if err != nil {
		return fmt.Errorf("failed to load key from database: %w", err)
	}

	return s.parsePrivateKeyPEM(privateKeyPEM)
}

// loadKeyFromFile loads the private key from disk
func (s *IdentityService) loadKeyFromFile() error {
	pemEncoded, err := os.ReadFile(s.keyPath)
	if err != nil {
		return fmt.Errorf("failed to read key file: %w", err)
	}

	return s.parsePrivateKeyPEM(string(pemEncoded))
}

// parsePrivateKeyPEM parses PEM-encoded private key
func (s *IdentityService) parsePrivateKeyPEM(pemEncoded string) error {
	block, _ := pem.Decode([]byte(pemEncoded))
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

// generateKey generates a new P-256 keypair
func (s *IdentityService) generateKey() error {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate key: %w", err)
	}

	s.privateKey = privateKey
	return nil
}

// syncKeyToDB saves the current key to database
func (s *IdentityService) syncKeyToDB() {
	if s.db == nil || s.privateKey == nil {
		return
	}

	privateKeyPEM, err := s.getPrivateKeyPEM()
	if err != nil {
		log.Printf("[Identity] Failed to encode private key: %v", err)
		return
	}

	publicKeyPEM, err := s.getPublicKeyPEM()
	if err != nil {
		log.Printf("[Identity] Failed to encode public key: %v", err)
		return
	}

	_, err = s.db.Exec(`
		INSERT INTO instance_identity (instance_id, private_key_pem, public_key_pem, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (instance_id) DO UPDATE SET
			private_key_pem = EXCLUDED.private_key_pem,
			public_key_pem = EXCLUDED.public_key_pem,
			updated_at = NOW()
	`, s.instanceID, privateKeyPEM, publicKeyPEM)

	if err != nil {
		log.Printf("[Identity] Failed to sync key to database: %v", err)
	} else {
		log.Printf("[Identity] Synced key to database for instance: %s", s.instanceID)
	}
}

// saveKeyToFile saves the current key to file (for backward compatibility)
func (s *IdentityService) saveKeyToFile() {
	if s.privateKey == nil {
		return
	}

	privateKeyPEM, err := s.getPrivateKeyPEM()
	if err != nil {
		log.Printf("[Identity] Failed to encode private key for file: %v", err)
		return
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(s.keyPath), 0700); err != nil {
		log.Printf("[Identity] Failed to create directory: %v", err)
		return
	}

	if err := os.WriteFile(s.keyPath, []byte(privateKeyPEM), 0600); err != nil {
		log.Printf("[Identity] Failed to write key file: %v", err)
	} else {
		log.Printf("[Identity] Saved key to file: %s", s.keyPath)
	}
}

// getPrivateKeyPEM returns the private key in PEM format
func (s *IdentityService) getPrivateKeyPEM() (string, error) {
	if s.privateKey == nil {
		return "", fmt.Errorf("private key not initialized")
	}

	x509Encoded, err := x509.MarshalECPrivateKey(s.privateKey)
	if err != nil {
		return "", fmt.Errorf("failed to marshal private key: %w", err)
	}

	pemEncoded := pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: x509Encoded,
	})

	return string(pemEncoded), nil
}

// getPublicKeyPEM returns the public key in PEM format
func (s *IdentityService) getPublicKeyPEM() (string, error) {
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

	return s.getPublicKeyPEM()
}

// GetInstanceID returns the instance ID
func (s *IdentityService) GetInstanceID() string {
	return s.instanceID
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
