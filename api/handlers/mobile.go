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

// MobileConnectQR represents the simplified QR code payload (V4)
// Only contains code + URL, mobile fetches full config via API
type MobileConnectQR struct {
	Code string `json:"c"` // Short connect code
	URL  string `json:"u"` // Backend URL
}

// MobileConnectConfig stores full config for a connect code
// Stored server-side, fetched by mobile after scanning QR
type MobileConnectConfig struct {
	Code         string    `json:"-"`                     // Not returned in response
	UserID       string    `json:"-"`                     // QR-generating user's ID (for signed_token)
	InstanceID   string    `json:"instance_id"`
	InstanceName string    `json:"instance_name"`
	BackendURL   string    `json:"backend_url"`
	GatewayURL   string    `json:"gateway_url,omitempty"`
	AuthConfig   AuthConfig `json:"auth_config"`
	CreatedAt    time.Time `json:"-"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// AuthConfig contains auth configuration for a self-hosted instance
// Returned separately from signed_token to avoid signature issues
// NOTE: Migrated from Supabase to OIDC standard authentication
type AuthConfig struct {
	// OIDC Configuration (standard authentication)
	OIDCIssuer   string `json:"oidc_issuer,omitempty"`   // OIDC IdP issuer URL (e.g., https://auth.example.com)
	OIDCClientID string `json:"oidc_client_id,omitempty"` // OIDC client ID for mobile app
	OIDCAudience string `json:"oidc_audience,omitempty"` // OIDC audience (required for Zitadel to return JWT tokens)

	// AI Agent URL (separate domain for WebSocket connection)
	AgentURL string `json:"agent_url,omitempty"`
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

// In-memory config store for V4 QR codes (in production, use Redis with TTL)
var connectConfigStore = make(map[string]*MobileConnectConfig)

// GenerateMobileConnectQR generates a QR code payload for mobile app connection
// POST /api/mobile/connect/generate
// V4: Ultra-simple QR - just code + URL, mobile fetches config via API
func (h *MobileHandler) GenerateMobileConnectQR(c *gin.Context) {
	// User authentication is still required to generate QR (prevents abuse)
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

	// Generate short connect code (12 chars hex = 48 bits entropy)
	codeBytes := make([]byte, 6)
	if _, err := rand.Read(codeBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate code"})
		return
	}
	code := hex.EncodeToString(codeBytes)

	// Config valid for 10 minutes
	expiresAt := time.Now().Add(10 * time.Minute)

	// Build auth config
	mobileClientID := os.Getenv("OIDC_MOBILE_CLIENT_ID")
	if mobileClientID == "" {
		mobileClientID = os.Getenv("OIDC_CLIENT_ID")
	}
	authConfig := AuthConfig{
		OIDCIssuer:   os.Getenv("OIDC_ISSUER"),
		OIDCClientID: mobileClientID,
		OIDCAudience: os.Getenv("OIDC_AUDIENCE"),
		AgentURL:     os.Getenv("AGENT_URL"),
	}

	// Store full config server-side (including userID for signed_token generation)
	config := &MobileConnectConfig{
		Code:         code,
		UserID:       userID,
		InstanceID:   instanceID,
		InstanceName: instanceName,
		BackendURL:   backendURL,
		GatewayURL:   gatewayURL,
		AuthConfig:   authConfig,
		CreatedAt:    time.Now(),
		ExpiresAt:    expiresAt,
	}
	connectConfigStore[code] = config

	// Clean up expired configs (simple cleanup, production should use Redis TTL)
	go cleanupExpiredConfigs()

	// Build minimal QR payload
	qrPayload := MobileConnectQR{
		Code: code,
		URL:  backendURL,
	}

	// Debug: Log payload size
	payloadJSON, _ := json.Marshal(qrPayload)
	fmt.Printf("QR payload size: %d bytes (code: %s)\n", len(payloadJSON), code)

	c.JSON(http.StatusOK, gin.H{
		"qr":          qrPayload,                    // This goes into QR code
		"auth_config": authConfig,                   // For web UI display only
		"expires_at":  expiresAt.Unix(),             // For countdown display
	})
}

// GetMobileConnectConfig returns config for a connect code
// GET /api/mobile/connect/:code
// Includes signed_token for direct device registration with noti-gw
func (h *MobileHandler) GetMobileConnectConfig(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Code is required"})
		return
	}

	// Look up config
	config, exists := connectConfigStore[code]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Invalid or expired code"})
		return
	}

	// Check expiration
	if time.Now().After(config.ExpiresAt) {
		delete(connectConfigStore, code)
		c.JSON(http.StatusGone, gin.H{"error": "Code has expired"})
		return
	}

	// Build response with config fields
	response := gin.H{
		"instance_id":   config.InstanceID,
		"instance_name": config.InstanceName,
		"backend_url":   config.BackendURL,
		"auth_config":   config.AuthConfig,
		"expires_at":    config.ExpiresAt,
	}
	if config.GatewayURL != "" {
		response["gateway_url"] = config.GatewayURL
	}

	// Generate signed_token for direct noti-gw device registration
	// Uses the QR-generating user's ID (the user who wants to connect their mobile)
	if h.IdentityService != nil && config.GatewayURL != "" && config.UserID != "" {
		nonce, err := generateNonce()
		if err == nil {
			payload := map[string]interface{}{
				"instance_id": config.InstanceID,
				"user_id":     config.UserID,
				"nonce":       nonce,
				"expires_at":  config.ExpiresAt.Unix(),
			}

			signature, err := h.IdentityService.SignMap(payload)
			if err == nil {
				response["signed_token"] = gin.H{
					"payload":   payload,
					"signature": signature,
				}
				fmt.Printf("V4: signed_token generated for code %s\n", code)
			} else {
				fmt.Printf("V4: Failed to sign token for code %s: %v\n", code, err)
			}
		}
	}

	c.JSON(http.StatusOK, response)
}

// cleanupExpiredConfigs removes expired configs from store
func cleanupExpiredConfigs() {
	now := time.Now()
	for code, config := range connectConfigStore {
		if now.After(config.ExpiresAt) {
			delete(connectConfigStore, code)
		}
	}
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
// This now fetches from noti-gw (cloud) where V2 devices are registered
func (h *MobileHandler) GetConnectedDevices(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Try to fetch from noti-gw first (V2 devices)
	gatewayURL := os.Getenv("SLAR_CLOUD_URL")
	gatewayToken := os.Getenv("SLAR_CLOUD_TOKEN")

	if gatewayURL != "" && gatewayToken != "" {
		// Fetch from noti-gw
		devices, err := h.fetchDevicesFromGateway(gatewayURL, gatewayToken, userID)
		if err != nil {
			fmt.Printf("Warning: Failed to fetch devices from gateway: %v\n", err)
			// Fall back to local DB
		} else {
			c.JSON(http.StatusOK, gin.H{"devices": devices})
			return
		}
	}

	// Fallback: Query local database (V1 devices)
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

// fetchDevicesFromGateway fetches connected devices from noti-gw
func (h *MobileHandler) fetchDevicesFromGateway(gatewayURL, gatewayToken, userID string) ([]gin.H, error) {
	url := fmt.Sprintf("%s/api/gateway/devices?user_id=%s", gatewayURL, userID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("gateway returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Devices []gin.H `json:"devices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Devices, nil
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

// GetAuthConfig returns auth configuration for mobile app after device registration
// GET /api/mobile/auth-config
// This is called by mobile app after QR scan to get OIDC credentials and AI agent URL
// (not included in QR to keep it small and scannable)
func (h *MobileHandler) GetAuthConfig(c *gin.Context) {
	// This endpoint can be public - it only returns public config
	// (OIDC issuer and client_id are safe to share)
	instanceID := os.Getenv("SLAR_INSTANCE_ID")

	// Use mobile-specific client ID if configured, otherwise fallback to default
	mobileClientID := os.Getenv("OIDC_MOBILE_CLIENT_ID")
	if mobileClientID == "" {
		mobileClientID = os.Getenv("OIDC_CLIENT_ID") // Fallback to default
	}

	authConfig := AuthConfig{
		OIDCIssuer:   os.Getenv("OIDC_ISSUER"),   // e.g., https://auth.example.com
		OIDCClientID: mobileClientID,             // e.g., slar-mobile (mobile-specific)
		OIDCAudience: os.Getenv("OIDC_AUDIENCE"), // Required for Zitadel to return JWT tokens (use Project ID)
		AgentURL:     os.Getenv("AGENT_URL"),     // AI Agent URL (separate domain)
	}

	c.JSON(http.StatusOK, gin.H{
		"instance_id": instanceID,
		"auth_config": authConfig,
	})
}
