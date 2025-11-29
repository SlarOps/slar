package handlers

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

// MobileHandler handles mobile app connection endpoints
type MobileHandler struct {
	PG              *sql.DB
	IdentityService *services.IdentityService
}

// NewMobileHandler creates a new MobileHandler
func NewMobileHandler(pg *sql.DB, identityService *services.IdentityService) *MobileHandler {
	return &MobileHandler{
		PG:              pg,
		IdentityService: identityService,
	}
}

// MobileConnectQR represents the QR code payload for mobile app connection
type MobileConnectQR struct {
	Type         string `json:"type"`
	Version      int    `json:"version"`
	BackendURL   string `json:"backend_url"`
	GatewayURL   string `json:"gateway_url"`
	InstanceID   string `json:"instance_id"`
	InstanceName string `json:"instance_name"`
	UserID       string `json:"user_id"`
	ConnectToken string `json:"connect_token"`
	Nonce        string `json:"nonce"` // Unique nonce for replay attack prevention
	ExpiresAt    int64  `json:"expires_at"`
}

// VerifyConnectRequest represents the request to verify a connect token
type VerifyConnectRequest struct {
	ConnectToken string     `json:"connect_token" binding:"required"`
	DeviceInfo   DeviceInfo `json:"device_info"`
}

// DeviceInfo represents mobile device information
type DeviceInfo struct {
	Platform   string `json:"platform"`   // "ios" or "android"
	DeviceID   string `json:"device_id"`  // Unique device identifier
	DeviceName string `json:"device_name"` // e.g., "iPhone 15 Pro"
	AppVersion string `json:"app_version"`
	OSVersion  string `json:"os_version"`
}

// VerifyConnectResponse represents the response after verifying connect token
type VerifyConnectResponse struct {
	UserID       string `json:"user_id"`
	UserEmail    string `json:"user_email"`
	UserName     string `json:"user_name"`
	InstanceID   string `json:"instance_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

// MobileConnectToken stores temporary connect tokens
type MobileConnectToken struct {
	Token     string
	UserID    string
	ExpiresAt time.Time
}

// In-memory token store (in production, use Redis)
var connectTokenStore = make(map[string]*MobileConnectToken)

// GenerateMobileConnectQR generates a QR code payload for mobile app connection
// POST /api/mobile/connect/generate
func (h *MobileHandler) GenerateMobileConnectQR(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Get environment variables
	backendURL := os.Getenv("SLAR_PUBLIC_URL")
	if backendURL == "" {
		backendURL = os.Getenv("SLAR_API_URL")
	}
	if backendURL == "" {
		// Fallback to request host
		scheme := "https"
		if c.Request.TLS == nil {
			scheme = "http"
		}
		backendURL = fmt.Sprintf("%s://%s", scheme, c.Request.Host)
	}

	gatewayURL := os.Getenv("SLAR_CLOUD_URL")
	instanceID := os.Getenv("SLAR_INSTANCE_ID")
	instanceName := os.Getenv("SLAR_INSTANCE_NAME")
	if instanceName == "" {
		instanceName = "SLAR Instance"
	}

	// Generate connect token (expires in 5 minutes)
	connectToken, err := generateConnectToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	// Generate unique nonce for replay attack prevention
	nonce, err := generateNonce()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate nonce"})
		return
	}

	expiresAt := time.Now().Add(5 * time.Minute)

	// Store token in memory (in production, use Redis with TTL)
	connectTokenStore[connectToken] = &MobileConnectToken{
		Token:     connectToken,
		UserID:    userID,
		ExpiresAt: expiresAt,
	}

	// Build QR payload
	qrPayload := MobileConnectQR{
		Type:         "slar_mobile_connect",
		Version:      2, // Bump version for nonce support
		BackendURL:   backendURL,
		GatewayURL:   gatewayURL,
		InstanceID:   instanceID,
		InstanceName: instanceName,
		UserID:       userID,
		ConnectToken: connectToken,
		Nonce:        nonce,
		ExpiresAt:    expiresAt.Unix(),
	}

	// Sign the payload
	payloadBytes, err := json.Marshal(qrPayload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal payload"})
		return
	}

	// Debug: Log what we're signing
	fmt.Printf("Signing payload JSON: %s\n", string(payloadBytes))

	signature, err := h.IdentityService.Sign(payloadBytes)
	if err != nil {
		// Log error but maybe proceed without signature if identity service fails?
		// No, security requirement is strict.
		fmt.Printf("Failed to sign QR payload: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sign payload"})
		return
	}

	// Return signed token structure
	c.JSON(http.StatusOK, gin.H{
		"signed_token": gin.H{
			"payload":   qrPayload,
			"signature": signature,
		},
		// Keep legacy fields for backward compatibility if needed, or just return the signed object
		// The frontend expects the QR content. Let's return the object that should be encoded in the QR.
		// If the frontend generates QR from the whole JSON response, then we should structure it as the QR content.
		// However, usually the API returns data and the Frontend picks what to put in the QR.
		// Let's assume the Frontend will put the "signed_token" object into the QR.
	})
}

// VerifyMobileConnect verifies the connect token and returns session credentials
// POST /api/mobile/connect/verify
func (h *MobileHandler) VerifyMobileConnect(c *gin.Context) {
	var req VerifyConnectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Look up token
	tokenData, exists := connectTokenStore[req.ConnectToken]
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid connect token"})
		return
	}

	// Check expiration
	if time.Now().After(tokenData.ExpiresAt) {
		delete(connectTokenStore, req.ConnectToken)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Connect token expired"})
		return
	}

	// Delete token after use (one-time use)
	delete(connectTokenStore, req.ConnectToken)

	// Get user info
	var userEmail, userName string
	err := h.PG.QueryRow(
		"SELECT email, name FROM users WHERE id = $1",
		tokenData.UserID,
	).Scan(&userEmail, &userName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get user info"})
		return
	}

	// Generate mobile session tokens
	accessToken, err := generateMobileSessionToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate session token"})
		return
	}

	refreshToken, err := generateMobileSessionToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	// Store mobile session in database
	sessionExpiresAt := time.Now().Add(30 * 24 * time.Hour) // 30 days
	deviceInfo := fmt.Sprintf(`{"platform":"%s","device_id":"%s","device_name":"%s"}`,
		req.DeviceInfo.Platform, req.DeviceInfo.DeviceID, req.DeviceInfo.DeviceName)
	deviceID := req.DeviceInfo.DeviceID
	if deviceID == "" {
		deviceID = generateSessionID() // Generate a device ID if not provided
	}

	_, err = h.PG.Exec(`
		INSERT INTO mobile_sessions (id, user_id, device_id, access_token_hash, refresh_token_hash, device_info, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (user_id, device_id) DO UPDATE SET
			access_token_hash = EXCLUDED.access_token_hash,
			refresh_token_hash = EXCLUDED.refresh_token_hash,
			device_info = EXCLUDED.device_info,
			expires_at = EXCLUDED.expires_at,
			updated_at = NOW()
	`,
		generateSessionID(),
		tokenData.UserID,
		deviceID,
		hashToken(accessToken),
		hashToken(refreshToken),
		deviceInfo,
		sessionExpiresAt,
	)
	if err != nil {
		// Table might not exist, continue anyway for now
		fmt.Printf("Warning: Could not store mobile session: %v\n", err)
	}

	// Register device with notification gateway if configured
	gatewayURL := os.Getenv("SLAR_CLOUD_URL")
	instanceID := os.Getenv("SLAR_INSTANCE_ID")

	response := VerifyConnectResponse{
		UserID:       tokenData.UserID,
		UserEmail:    userEmail,
		UserName:     userName,
		InstanceID:   instanceID,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    sessionExpiresAt.Unix(),
	}

	// Include gateway info for device registration
	c.JSON(http.StatusOK, gin.H{
		"user":         response,
		"gateway_url":  gatewayURL,
		"instance_id":  instanceID,
		"gateway_token": os.Getenv("SLAR_CLOUD_TOKEN"), // Mobile app needs this to register device
	})
}

// GetConnectedDevices returns list of devices connected to user's account
// GET /api/mobile/devices
func (h *MobileHandler) GetConnectedDevices(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	rows, err := h.PG.Query(`
		SELECT id, device_info, created_at, COALESCE(last_active_at, created_at) as last_active_at
		FROM mobile_sessions
		WHERE user_id = $1 AND expires_at > NOW()
		ORDER BY last_active_at DESC
	`, userID)
	if err != nil {
		// Check if table doesn't exist
		if isTableNotExistError(err) {
			// Return empty list - table will be created by migration
			c.JSON(http.StatusOK, gin.H{"devices": []gin.H{}})
			return
		}
		fmt.Printf("Error getting devices: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get devices"})
		return
	}
	defer rows.Close()

	devices := []gin.H{}
	for rows.Next() {
		var id, deviceInfo string
		var createdAt, lastActiveAt time.Time
		if err := rows.Scan(&id, &deviceInfo, &createdAt, &lastActiveAt); err != nil {
			continue
		}
		devices = append(devices, gin.H{
			"id":             id,
			"device_info":    deviceInfo,
			"created_at":     createdAt,
			"last_active_at": lastActiveAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"devices": devices})
}

// isTableNotExistError checks if the error is due to table not existing
func isTableNotExistError(err error) bool {
	if err == nil {
		return false
	}
	errMsg := err.Error()
	return strings.Contains(errMsg, "does not exist") ||
		strings.Contains(errMsg, "relation") ||
		strings.Contains(errMsg, "42P01") // PostgreSQL error code for undefined_table
}

// RegisterDeviceForPush registers a device's FCM token with the notification gateway
// POST /mobile/devices/register-push (public endpoint - verifies mobile token internally)
func (h *MobileHandler) RegisterDeviceForPush(c *gin.Context) {
	// Verify mobile session token
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing authorization token"})
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")

	// Verify it's a mobile session token
	if !strings.HasPrefix(token, "slar_mob_") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid mobile token format"})
		return
	}

	// Look up the session by token hash
	tokenHash := hashToken(token)
	var userID string
	err := h.PG.QueryRow(`
		SELECT user_id FROM mobile_sessions
		WHERE access_token_hash = $1 AND expires_at > NOW()
	`, tokenHash).Scan(&userID)

	if err != nil {
		if err == sql.ErrNoRows || isTableNotExistError(err) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}
		fmt.Printf("Error verifying mobile token: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify token"})
		return
	}

	var req struct {
		FCMToken   string `json:"fcm_token" binding:"required"`
		Platform   string `json:"platform"`
		AppVersion string `json:"app_version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Get gateway configuration
	gatewayURL := os.Getenv("SLAR_CLOUD_URL")
	gatewayToken := os.Getenv("SLAR_CLOUD_TOKEN")
	instanceID := os.Getenv("SLAR_INSTANCE_ID")

	if gatewayURL == "" || gatewayToken == "" || instanceID == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Push notifications not configured"})
		return
	}

	// Forward registration to noti-gw
	payload := map[string]interface{}{
		"instance_id": instanceID,
		"user_id":     userID,
		"fcm_token":   req.FCMToken,
		"platform":    req.Platform,
		"app_version": req.AppVersion,
	}

	jsonPayload, _ := json.Marshal(payload)
	httpReq, _ := http.NewRequest("POST", gatewayURL+"/api/gateway/devices/register", bytes.NewBuffer(jsonPayload))
	httpReq.Header.Set("Authorization", "Bearer "+gatewayToken)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		fmt.Printf("Failed to register with gateway: %v\n", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to register with notification gateway"})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Gateway registration failed: %s\n", string(body))
		c.JSON(resp.StatusCode, gin.H{"error": "Gateway registration failed", "details": string(body)})
		return
	}

	var result map[string]interface{}
	json.Unmarshal(body, &result)

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"device_id": result["device_id"],
		"message":   "Device registered for push notifications",
	})
}

// DisconnectDevice removes a device from user's account
// DELETE /api/mobile/devices/:device_id
func (h *MobileHandler) DisconnectDevice(c *gin.Context) {
	userID := c.GetString("user_id")
	deviceID := c.Param("device_id")

	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	result, err := h.PG.Exec(`
		DELETE FROM mobile_sessions
		WHERE id = $1 AND user_id = $2
	`, deviceID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to disconnect device"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Helper functions

func generateConnectToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "slar_conn_" + hex.EncodeToString(bytes), nil
}

func generateMobileSessionToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "slar_mob_" + hex.EncodeToString(bytes), nil
}

func generateSessionID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return "sess_" + hex.EncodeToString(bytes)
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func generateNonce() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	// Include timestamp for additional uniqueness
	return fmt.Sprintf("%d_%s", time.Now().UnixNano(), hex.EncodeToString(bytes)), nil
}
