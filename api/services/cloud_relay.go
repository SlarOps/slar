package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// CloudRelayService handles communication with SLAR Cloud relay
type CloudRelayService struct {
	cloudURL        string
	cloudToken      string
	instanceID      string
	identityService *IdentityService
	httpClient      *http.Client
}

// NewCloudRelayService creates a new CloudRelayService
func NewCloudRelayService(identityService *IdentityService) *CloudRelayService {
	return &CloudRelayService{
		cloudURL:        os.Getenv("SLAR_CLOUD_URL"),
		cloudToken:      os.Getenv("SLAR_CLOUD_TOKEN"),
		instanceID:      os.Getenv("SLAR_INSTANCE_ID"),
		identityService: identityService,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// IsConfigured returns true if cloud relay is configured
func (s *CloudRelayService) IsConfigured() bool {
	return s.cloudURL != "" && s.instanceID != ""
}

// RegisterWithCloud registers this instance's public key with the cloud relay
// This should be called on startup if cloud relay is configured
// Uses SLAR_CLOUD_TOKEN (api_token issued by slar-saas) for authentication
func (s *CloudRelayService) RegisterWithCloud() error {
	if !s.IsConfigured() {
		return fmt.Errorf("cloud relay not configured")
	}

	if s.cloudToken == "" {
		return fmt.Errorf("SLAR_CLOUD_TOKEN not configured")
	}

	if s.identityService == nil {
		return fmt.Errorf("identity service not initialized")
	}

	// Get public key
	publicKey, err := s.identityService.GetPublicKey()
	if err != nil {
		return fmt.Errorf("failed to get public key: %w", err)
	}

	// Build registration payload - only need public_key
	// api_token authenticates which instance this is
	payload := map[string]interface{}{
		"public_key": publicKey,
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	// Send registration request with api_token in Authorization header
	req, err := http.NewRequest("POST", s.cloudURL+"/api/gateway/instances/register", bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cloudToken)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("registration failed: %s - %s", resp.Status, string(body))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	// Log success
	if instanceID, ok := result["instance_id"].(string); ok && instanceID != "" {
		fmt.Printf("✅ Public key registered with cloud relay. Instance ID: %s\n", instanceID)
	}

	status, _ := result["status"].(string)
	message, _ := result["message"].(string)
	fmt.Printf("✅ Cloud relay: %s - %s\n", status, message)

	return nil
}

// SendNotification sends a notification via cloud relay
func (s *CloudRelayService) SendNotification(instanceID, userID, title, body string, data map[string]string, priority string) error {
	if !s.IsConfigured() {
		return fmt.Errorf("cloud relay not configured")
	}

	payload := map[string]interface{}{
		"instance_id": instanceID,
		"user_id":     userID,
		"notification": map[string]interface{}{
			"title":    title,
			"body":     body,
			"data":     data,
			"priority": priority,
		},
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", s.cloudURL+"/api/gateway/notifications/send", bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cloudToken)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("send notification failed: %s - %s", resp.Status, string(body))
	}

	return nil
}
