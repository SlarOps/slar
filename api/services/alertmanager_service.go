package services

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/models"
)

type AlertManagerService struct {
	PG           *sql.DB
	AlertService *AlertService
}

func NewAlertManagerService(pg *sql.DB, alertService *AlertService) *AlertManagerService {
	return &AlertManagerService{
		PG:           pg,
		AlertService: alertService,
	}
}

// ProcessWebhook processes incoming AlertManager webhook and creates alerts
func (s *AlertManagerService) ProcessWebhook(webhook *models.AlertManagerWebhook) error {
	log.Printf("Processing AlertManager webhook with %d alerts", len(webhook.Alerts))

	for _, amAlert := range webhook.Alerts {
		log.Printf("Processing alert: %s (status: %s, severity: %s)",
			amAlert.Labels["alertname"], amAlert.Status, amAlert.Labels["severity"])

		// Convert AlertManager alert to internal alert
		alert, err := s.convertToInternalAlert(webhook, &amAlert)
		if err != nil {
			return fmt.Errorf("failed to convert alert: %w", err)
		}

		// Handle different alert statuses
		switch amAlert.Status {
		case "firing":
			log.Printf("Handling FIRING alert: %s", alert.Title)
			err = s.handleFiringAlert(alert, &amAlert)
		case "resolved":
			log.Printf("Handling RESOLVED alert: %s", alert.Title)
			err = s.handleResolvedAlert(alert, &amAlert)
		default:
			log.Printf("Skipping unknown alert status: %s", amAlert.Status)
			continue // Skip unknown statuses
		}

		if err != nil {
			log.Printf("Error handling alert %s: %v", alert.Title, err)
			return fmt.Errorf("failed to handle alert status %s: %w", amAlert.Status, err)
		}

		log.Printf("Successfully processed alert: %s", alert.Title)
	}

	log.Printf("Webhook processing completed successfully")
	return nil
}

// convertToInternalAlert converts AlertManager alert to internal alert format
func (s *AlertManagerService) convertToInternalAlert(_ *models.AlertManagerWebhook, amAlert *models.AlertManagerAlert) (*db.Alert, error) {
	// Generate alert ID based on fingerprint or labels
	alertID := amAlert.Fingerprint
	if alertID == "" {
		alertID = s.generateAlertID(amAlert.Labels)
	}

	// Extract severity from labels
	severity := s.extractSeverity(amAlert.Labels)

	// Create description from annotations
	description := s.createDescription(amAlert.Annotations, amAlert.Labels)

	alert := &db.Alert{
		ID:          alertID,
		Title:       amAlert.Labels["alertname"],
		Description: description,
		Severity:    severity,
		Status:      "new",
		Source:      "alertmanager",
		CreatedAt:   amAlert.StartsAt,
		UpdatedAt:   time.Now(),
	}

	return alert, nil
}

// handleFiringAlert handles firing alerts
func (s *AlertManagerService) handleFiringAlert(alert *db.Alert, _ *models.AlertManagerAlert) error {
	// Check if alert already exists
	log.Printf("Checking if alert exists with ID: %s", alert.ID)
	var existingAlert db.Alert
	err := s.PG.QueryRow("SELECT id, status FROM alerts WHERE id = $1", alert.ID).Scan(&existingAlert.ID, &existingAlert.Status)

	if err == sql.ErrNoRows {
		log.Printf("Alert not found, creating new alert: %s", alert.ID)
		// Create new alert using AlertService (this will trigger FCM notifications)
		alert.Status = "new"

		// Auto-assign to current on-call user
		userService := NewUserService(s.PG, nil)
		if onCallUser, userErr := userService.GetCurrentOnCallUser(); userErr == nil {
			alert.AssignedTo = onCallUser.ID
			now := time.Now()
			alert.AssignedAt = &now
		}

		// Use AlertService.CreateAlert to trigger FCM notifications
		_, err = s.AlertService.CreateAlert(alert)
		if err == nil {
			log.Printf("New alert created and FCM notification triggered for: %s", alert.Title)
		}
		return err
	} else if err != nil {
		return err
	}

	log.Printf("Alert exists with status: %s", existingAlert.Status)

	// Update existing alert if it was closed
	if existingAlert.Status == "closed" {
		log.Printf("Reopening closed alert: %s", alert.ID)
		now := time.Now()
		_, err = s.PG.Exec("UPDATE alerts SET status = 'new', updated_at = $1 WHERE id = $2", now, alert.ID)

		// If alert was re-opened, send FCM notification
		if err == nil && s.AlertService.FCMService != nil {
			// Get updated alert for FCM notification
			if updatedAlert, getErr := s.AlertService.GetAlert(alert.ID); getErr == nil {
				go func() {
					alertForFCM := &db.Alert{
						ID:          updatedAlert.ID,
						Title:       updatedAlert.Title,
						Description: updatedAlert.Description,
						Severity:    updatedAlert.Severity,
						Source:      updatedAlert.Source,
						AssignedTo:  updatedAlert.AssignedTo,
					}

					if alertForFCM.AssignedTo != "" {
						s.AlertService.FCMService.SendAlertNotification(alertForFCM)
					} else {
						s.AlertService.FCMService.SendNotificationToOnCallUsers(alertForFCM)
					}
				}()
			}
		}

		return err
	} else {
		log.Printf("⏭️ Alert already active (status: %s), skipping", existingAlert.Status)
	}

	return nil
}

// handleResolvedAlert handles resolved alerts
func (s *AlertManagerService) handleResolvedAlert(alert *db.Alert, _ *models.AlertManagerAlert) error {
	log.Printf("Checking resolved alert with ID: %s", alert.ID)
	var existingAlert db.Alert
	err := s.PG.QueryRow("SELECT id, status FROM alerts WHERE id = $1", alert.ID).Scan(&existingAlert.ID, &existingAlert.Status)

	if err == sql.ErrNoRows {
		// Alert doesn't exist - this means we received a resolved alert
		// without ever receiving the firing alert first
		//
		// Business Logic Decision:
		// If an alert resolves before we even know it fired, it means:
		// 1. The issue was very brief (self-healing)
		// 2. No human intervention was needed
		// 3. No assignment/notification was necessary
		//
		// Options:
		// A) Skip it entirely (clean approach)
		// B) Create it for audit trail (comprehensive approach)

		// Option A: Skip resolved alerts that never fired (recommended)
		log.Printf("⚠️ Skipping resolved alert that was never fired: %s (duration was too brief to require attention)", alert.Title)
		return nil

		// Option B: Create for audit trail (uncomment if needed)
		// alert.Status = "closed"
		// alert.AssignedTo = ""  // No assignment - nobody needed to handle it
		// alert.AssignedAt = nil
		// _, err = s.AlertService.CreateAlert(alert)
		// return err
	} else if err != nil {
		return err
	}

	// Update existing alert to closed
	if existingAlert.Status != "closed" {
		log.Printf("🔄 Updating existing alert to closed: %s", alert.ID)
		// Use AlertService method to close alert properly
		err = s.AlertService.CloseAlert(alert.ID)
		return err
	} else {
		log.Printf("⏭️ Alert already closed, skipping: %s", alert.ID)
	}

	return nil
}

// Helper functions

func (s *AlertManagerService) generateAlertID(labels map[string]string) string {
	// Create a consistent ID from labels with deterministic ordering
	var parts []string

	// Sort keys to ensure consistent ordering
	keys := make([]string, 0, len(labels))
	for key := range labels {
		keys = append(keys, key)
	}

	// Use stable sort to ensure deterministic results
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[i] > keys[j] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}

	// Build parts in sorted order
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, labels[key]))
	}

	// Use hash for consistent short ID
	hash := sha256.Sum256([]byte(strings.Join(parts, ",")))
	return fmt.Sprintf("am-%x", hash[:8]) // Use first 8 bytes of hash
}

func (s *AlertManagerService) extractSeverity(labels map[string]string) string {
	if severity, exists := labels["severity"]; exists {
		switch strings.ToLower(severity) {
		case "critical":
			return "critical"
		case "warning":
			return "warning"
		case "info":
			return "info"
		default:
			return "warning"
		}
	}
	return "warning"
}

func (s *AlertManagerService) createDescription(annotations, labels map[string]string) string {
	// Try to get description from annotations
	if summary, exists := annotations["summary"]; exists {
		return summary
	}
	if description, exists := annotations["description"]; exists {
		return description
	}

	// Fallback to creating description from labels
	if alertname, exists := labels["alertname"]; exists {
		if instance, exists := labels["instance"]; exists {
			return fmt.Sprintf("%s on %s", alertname, instance)
		}
		return alertname
	}

	return "Alert from AlertManager"
}
