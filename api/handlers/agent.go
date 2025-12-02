package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

// AgentHandler handles AI agent authentication endpoints
type AgentHandler struct {
	PG              *sql.DB
	IdentityService *services.IdentityService
}

// NewAgentHandler creates a new AgentHandler
func NewAgentHandler(pg *sql.DB, identityService *services.IdentityService) *AgentHandler {
	return &AgentHandler{
		PG:              pg,
		IdentityService: identityService,
	}
}

// DeviceCertificate represents a device certificate for Zero-Trust auth
type DeviceCertificate struct {
	ID                string   `json:"id"`
	DevicePublicKey   string   `json:"device_public_key"`
	UserID            string   `json:"user_id"`
	InstanceID        string   `json:"instance_id"`
	Permissions       []string `json:"permissions"`
	IssuedAt          int64    `json:"issued_at"`
	ExpiresAt         int64    `json:"expires_at"`
	InstanceSignature string   `json:"instance_signature"`
}

// DeviceCertRequest is the request body for device certificate
type DeviceCertRequest struct {
	DevicePublicKey string `json:"device_public_key" binding:"required"`
	DeviceID        string `json:"device_id" binding:"required"`
}

// GenerateDeviceCertificate creates a signed device certificate for mobile app
// POST /api/agent/device-cert
// This enables Zero-Trust per-message verification
func (h *AgentHandler) GenerateDeviceCertificate(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req DeviceCertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Validate public key format (should be base64 encoded Ed25519 public key)
	if len(req.DevicePublicKey) < 32 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid device public key"})
		return
	}

	instanceID := os.Getenv("SLAR_INSTANCE_ID")
	if instanceID == "" {
		instanceID = "default"
	}

	// Generate certificate ID
	certID, err := generateCertID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate certificate ID"})
		return
	}

	// Certificate validity: 24 hours
	now := time.Now()
	expiresAt := now.Add(24 * time.Hour)

	// Build certificate payload (to be signed)
	certPayload := map[string]interface{}{
		"id":                certID,
		"device_public_key": req.DevicePublicKey,
		"user_id":           userID,
		"instance_id":       instanceID,
		"permissions":       []string{"chat", "tools"},
		"issued_at":         now.Unix(),
		"expires_at":        expiresAt.Unix(),
	}

	// Sign certificate with instance private key (ECDSA)
	signature, err := h.IdentityService.SignMap(certPayload)
	if err != nil {
		fmt.Printf("Failed to sign certificate: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sign certificate"})
		return
	}

	// Store certificate in database for tracking/revocation
	_, err = h.PG.Exec(`
		INSERT INTO agent_device_certs (id, device_id, user_id, device_public_key, instance_id, permissions, issued_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (device_id, user_id) DO UPDATE SET
			id = EXCLUDED.id,
			device_public_key = EXCLUDED.device_public_key,
			permissions = EXCLUDED.permissions,
			issued_at = EXCLUDED.issued_at,
			expires_at = EXCLUDED.expires_at,
			updated_at = NOW()
	`,
		certID,
		req.DeviceID,
		userID,
		req.DevicePublicKey,
		instanceID,
		`{"chat","tools"}`,
		now,
		expiresAt,
	)
	if err != nil {
		// Log but don't fail - DB storage is optional for MVP
		fmt.Printf("Warning: Failed to store certificate: %v\n", err)
	}

	// Return signed certificate
	certificate := DeviceCertificate{
		ID:                certID,
		DevicePublicKey:   req.DevicePublicKey,
		UserID:            userID,
		InstanceID:        instanceID,
		Permissions:       []string{"chat", "tools"},
		IssuedAt:          now.Unix(),
		ExpiresAt:         expiresAt.Unix(),
		InstanceSignature: signature,
	}

	c.JSON(http.StatusOK, gin.H{
		"certificate": certificate,
		"message":     "Device certificate generated successfully",
	})
}

// RevokeDeviceCertificate revokes a device certificate
// DELETE /api/agent/device-cert/:cert_id
func (h *AgentHandler) RevokeDeviceCertificate(c *gin.Context) {
	userID := c.GetString("user_id")
	certID := c.Param("cert_id")

	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	result, err := h.PG.Exec(`
		UPDATE agent_device_certs
		SET revoked = true, revoked_at = NOW()
		WHERE id = $1 AND user_id = $2
	`, certID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke certificate"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Certificate not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Certificate revoked",
	})
}

// ListDeviceCertificates lists all active device certificates for a user
// GET /api/agent/device-certs
func (h *AgentHandler) ListDeviceCertificates(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	rows, err := h.PG.Query(`
		SELECT id, device_id, instance_id, permissions, issued_at, expires_at
		FROM agent_device_certs
		WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
		ORDER BY issued_at DESC
	`, userID)

	if err != nil {
		// Table might not exist
		c.JSON(http.StatusOK, gin.H{"certificates": []gin.H{}})
		return
	}
	defer rows.Close()

	certs := []gin.H{}
	for rows.Next() {
		var id, deviceID, instanceID, permissions string
		var issuedAt, expiresAt time.Time
		if err := rows.Scan(&id, &deviceID, &instanceID, &permissions, &issuedAt, &expiresAt); err != nil {
			continue
		}
		certs = append(certs, gin.H{
			"id":          id,
			"device_id":   deviceID,
			"instance_id": instanceID,
			"permissions": permissions,
			"issued_at":   issuedAt.Unix(),
			"expires_at":  expiresAt.Unix(),
		})
	}

	c.JSON(http.StatusOK, gin.H{"certificates": certs})
}

// GetAgentConfig returns AI agent configuration for mobile app
// GET /api/agent/config
func (h *AgentHandler) GetAgentConfig(c *gin.Context) {
	agentURL := os.Getenv("SLAR_AGENT_URL")
	instanceID := os.Getenv("SLAR_INSTANCE_ID")

	// Get instance public key for client-side verification (optional)
	publicKey, _ := h.IdentityService.GetPublicKey()

	c.JSON(http.StatusOK, gin.H{
		"agent_url":          agentURL,
		"instance_id":        instanceID,
		"instance_public_key": publicKey,
		"auth_method":        "zero_trust_per_message",
		"signature_algorithm": "ECDSA_P256_SHA256",
	})
}

// Helper function to generate certificate ID
func generateCertID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "cert_" + hex.EncodeToString(bytes), nil
}
