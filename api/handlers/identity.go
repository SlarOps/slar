package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/services"
)

type IdentityHandler struct {
	IdentityService *services.IdentityService
}

func NewIdentityHandler(identityService *services.IdentityService) *IdentityHandler {
	return &IdentityHandler{IdentityService: identityService}
}

// GetPublicKey returns the instance's public key
// GET /api/identity/public-key
func (h *IdentityHandler) GetPublicKey(c *gin.Context) {
	pubKey, err := h.IdentityService.GetPublicKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get public key"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"public_key": pubKey})
}

// ConnectRelay sends the public key to SLAR Cloud
// POST /api/identity/connect-relay
func (h *IdentityHandler) ConnectRelay(c *gin.Context) {
	// 1. Get Public Key
	pubKey, err := h.IdentityService.GetPublicKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get public key"})
		return
	}

	// 2. Get Cloud Config
	cloudURL := os.Getenv("SLAR_CLOUD_URL")
	cloudToken := os.Getenv("SLAR_CLOUD_TOKEN")

	if cloudURL == "" || cloudToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SLAR Cloud not configured (missing SLAR_CLOUD_URL or SLAR_CLOUD_TOKEN)"})
		return
	}

	// 3. Send to Cloud
	// Endpoint: POST /api/gateway/instances/register
	// api_token (in Authorization header) identifies the instance
	// Only need to send public_key in body
	payload := map[string]string{
		"public_key": pubKey,
	}
	
	jsonPayload, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", cloudURL+"/api/gateway/instances/register", bytes.NewBuffer(jsonPayload))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
		return
	}
	
	req.Header.Set("Authorization", "Bearer "+cloudToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to connect to cloud: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Cloud rejected request: status %d", resp.StatusCode)})
		return
	}

	// 4. Success
	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	c.JSON(http.StatusOK, gin.H{
		"message": "Successfully connected to Relay",
		"cloud_response": result,
	})
}
