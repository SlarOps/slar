package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/internal/config"
)

// IncidentAnalyticsService handles AI-powered incident analysis via PGMQ
type IncidentAnalyticsService struct {
	DB *sql.DB
}

// NewIncidentAnalyticsService creates a new incident analytics service
func NewIncidentAnalyticsService(database *sql.DB) *IncidentAnalyticsService {
	return &IncidentAnalyticsService{
		DB: database,
	}
}

// AnalysisRequest represents the data sent to the analytics worker
type AnalysisRequest struct {
	IncidentID   string         `json:"incident_id"`
	IncidentData map[string]any `json:"incident_data"`
}

// QueueIncidentForAnalysis publishes an incident to PGMQ for AI analysis
//
// This is called after an incident is created from a webhook.
// The Python worker will consume this message, analyze the incident with Claude,
// and update the incident description with actionable insights.
//
// Args:
//   - incident: The incident to analyze
//
// Returns:
//   - error: Any error that occurred
func (s *IncidentAnalyticsService) QueueIncidentForAnalysis(incident *db.Incident) error {
	// Check if AI Pilot is enabled
	if !config.App.AIIncidentAnalytics.Enabled {
		// Log only at debug level (or not at all?) - using Printf for now as info
		log.Printf("ℹ️  AI Pilot disabled, skipping analysis for incident %s", incident.ID)
		return nil
	}

	queueName := "incident_analysis_queue"

	// Build incident data for analysis
	incidentData := map[string]any{
		"id":              incident.ID,
		"title":           incident.Title,
		"description":     incident.Description,
		"source":          incident.Source,
		"urgency":         incident.Urgency,
		"priority":        incident.Priority,
		"status":          incident.Status,
		"created_at":      incident.CreatedAt,
		"organization_id": incident.OrganizationID, // Required for ReBAC tenant isolation
		"project_id":      incident.ProjectID,      // Optional project scoping
	}

	// Add labels if present
	if incident.Labels != nil {
		incidentData["labels"] = incident.Labels
	}

	// Build message payload
	messagePayload := AnalysisRequest{
		IncidentID:   incident.ID,
		IncidentData: incidentData,
	}

	messageJSON, err := json.Marshal(messagePayload)
	if err != nil {
		return fmt.Errorf("failed to marshal analysis request: %w", err)
	}

	// Publish to PGMQ
	ctx := context.Background()
	query := `SELECT pgmq.send($1, $2::jsonb);`

	var msgID int64
	err = s.DB.QueryRowContext(ctx, query, queueName, messageJSON).Scan(&msgID)
	if err != nil {
		return fmt.Errorf("failed to send message to PGMQ: %w", err)
	}

	log.Printf("🤖 Queued incident %s for AI analysis (PGMQ msg_id: %d)", incident.ID, msgID)
	return nil
}

// QueueIncidentForAnalysisAsync is a non-blocking version that logs errors
// instead of returning them. Use this when you don't want analysis failures
// to block incident creation.
func (s *IncidentAnalyticsService) QueueIncidentForAnalysisAsync(incident *db.Incident) {
	go func() {
		if err := s.QueueIncidentForAnalysis(incident); err != nil {
			log.Printf("⚠️  Failed to queue incident %s for analysis: %v", incident.ID, err)
		}
	}()
}

// CreateQueueIfNotExists ensures the PGMQ queue exists
// Call this during service initialization
func (s *IncidentAnalyticsService) CreateQueueIfNotExists() error {
	queueName := "incident_analysis_queue"

	ctx := context.Background()
	query := `SELECT pgmq.create($1);`

	_, err := s.DB.ExecContext(ctx, query, queueName)
	if err != nil {
		// Queue might already exist, which is fine
		// PGMQ create is idempotent, so we can ignore errors
		log.Printf("ℹ️  PGMQ queue '%s' setup (might already exist): %v", queueName, err)
		return nil
	}

	log.Printf("✅ PGMQ queue '%s' ready", queueName)
	return nil
}
