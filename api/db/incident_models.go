package db

import "time"

// Incident represents a PagerDuty-style incident
type Incident struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`   // triggered, acknowledged, resolved
	Urgency     string    `json:"urgency"`  // low, high
	Priority    string    `json:"priority"` // P1, P2, P3, P4, P5
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	// Assignment & Acknowledgment
	AssignedTo     string     `json:"assigned_to,omitempty"`
	AssignedAt     *time.Time `json:"assigned_at,omitempty"`
	AcknowledgedBy string     `json:"acknowledged_by,omitempty"`
	AcknowledgedAt *time.Time `json:"acknowledged_at,omitempty"`
	ResolvedBy     string     `json:"resolved_by,omitempty"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`

	// Source & Integration
	Source        string `json:"source"`
	IntegrationID string `json:"integration_id,omitempty"`
	ServiceID     string `json:"service_id,omitempty"`

	// External references
	ExternalID  string `json:"external_id,omitempty"`
	ExternalURL string `json:"external_url,omitempty"`

	// Escalation
	EscalationPolicyID     string     `json:"escalation_policy_id,omitempty"`
	CurrentEscalationLevel int        `json:"current_escalation_level"`
	LastEscalatedAt        *time.Time `json:"last_escalated_at,omitempty"`
	EscalationStatus       string     `json:"escalation_status"`

	// Grouping & Organization
	GroupID  string `json:"group_id,omitempty"`
	APIKeyID string `json:"api_key_id,omitempty"`

	// Incident details
	Severity     string                 `json:"severity,omitempty"`
	IncidentKey  string                 `json:"incident_key,omitempty"`
	AlertCount   int                    `json:"alert_count"`
	Labels       map[string]interface{} `json:"labels,omitempty"`
	CustomFields map[string]interface{} `json:"custom_fields,omitempty"`
}

// IncidentResponse includes additional information for API responses
type IncidentResponse struct {
	Incident

	// User information
	AssignedToName      string `json:"assigned_to_name,omitempty"`
	AssignedToEmail     string `json:"assigned_to_email,omitempty"`
	AcknowledgedByName  string `json:"acknowledged_by_name,omitempty"`
	AcknowledgedByEmail string `json:"acknowledged_by_email,omitempty"`
	ResolvedByName      string `json:"resolved_by_name,omitempty"`
	ResolvedByEmail     string `json:"resolved_by_email,omitempty"`

	// Group information
	GroupName string `json:"group_name,omitempty"`

	// Service information
	ServiceName string `json:"service_name,omitempty"`

	// Escalation information
	EscalationPolicyName string `json:"escalation_policy_name,omitempty"`

	// Recent events
	RecentEvents []IncidentEvent `json:"recent_events,omitempty"`
}

// IncidentEvent represents an event in the incident timeline
type IncidentEvent struct {
	ID            string                 `json:"id"`
	IncidentID    string                 `json:"incident_id"`
	EventType     string                 `json:"event_type"`
	EventData     map[string]interface{} `json:"event_data,omitempty"`
	CreatedAt     time.Time              `json:"created_at"`
	CreatedBy     string                 `json:"created_by,omitempty"`
	CreatedByName string                 `json:"created_by_name,omitempty"`
}

// RawAlert represents raw alert data before processing into incidents
type RawAlert struct {
	ID            string                 `json:"id"`
	IncidentID    string                 `json:"incident_id,omitempty"`
	RawPayload    map[string]interface{} `json:"raw_payload"`
	ProcessedAt   *time.Time             `json:"processed_at,omitempty"`
	DedupKey      string                 `json:"dedup_key,omitempty"`
	Fingerprint   string                 `json:"fingerprint,omitempty"`
	Source        string                 `json:"source"`
	IntegrationID string                 `json:"integration_id,omitempty"`
	ReceivedAt    time.Time              `json:"received_at"`
}

// Request/Response DTOs

// CreateIncidentRequest for creating a new incident
type CreateIncidentRequest struct {
	Title              string                 `json:"title" binding:"required"`
	Description        string                 `json:"description"`
	Urgency            string                 `json:"urgency,omitempty" binding:"omitempty,oneof=low high"`
	Priority           string                 `json:"priority,omitempty"`
	ServiceID          string                 `json:"service_id,omitempty"`
	GroupID            string                 `json:"group_id,omitempty"`
	EscalationPolicyID string                 `json:"escalation_policy_id,omitempty"`
	IncidentKey        string                 `json:"incident_key,omitempty"` // For deduplication
	Severity           string                 `json:"severity,omitempty"`
	Labels             map[string]interface{} `json:"labels,omitempty"`
	CustomFields       map[string]interface{} `json:"custom_fields,omitempty"`
}

// UpdateIncidentRequest for updating an incident
type UpdateIncidentRequest struct {
	Title        *string                `json:"title,omitempty"`
	Description  *string                `json:"description,omitempty"`
	Status       *string                `json:"status,omitempty" binding:"omitempty,oneof=triggered acknowledged resolved"`
	Urgency      *string                `json:"urgency,omitempty" binding:"omitempty,oneof=low high"`
	Priority     *string                `json:"priority,omitempty"`
	Severity     *string                `json:"severity,omitempty"`
	Labels       map[string]interface{} `json:"labels,omitempty"`
	CustomFields map[string]interface{} `json:"custom_fields,omitempty"`
}

// AcknowledgeIncidentRequest for acknowledging an incident
type AcknowledgeIncidentRequest struct {
	Note string `json:"note,omitempty"`
}

// ResolveIncidentRequest for resolving an incident
type ResolveIncidentRequest struct {
	Note       string `json:"note,omitempty"`
	Resolution string `json:"resolution,omitempty"`
}

// AssignIncidentRequest for assigning an incident
type AssignIncidentRequest struct {
	AssignedTo string `json:"assigned_to" binding:"required"`
	Note       string `json:"note,omitempty"`
}

// AddIncidentNoteRequest for adding notes to an incident
type AddIncidentNoteRequest struct {
	Note string `json:"note" binding:"required"`
}

// WebhookIncidentRequest for creating incidents via webhook (PagerDuty Events API style)
type WebhookIncidentRequest struct {
	RoutingKey  string                 `json:"routing_key" binding:"required"`
	EventAction string                 `json:"event_action" binding:"required,oneof=trigger acknowledge resolve"`
	DedupKey    string                 `json:"dedup_key,omitempty"`
	Payload     WebhookIncidentPayload `json:"payload" binding:"required"`
}

// WebhookIncidentPayload represents the payload in webhook requests
type WebhookIncidentPayload struct {
	Summary       string                 `json:"summary" binding:"required"`
	Source        string                 `json:"source" binding:"required"`
	Severity      string                 `json:"severity" binding:"required,oneof=critical error warning info"`
	Timestamp     *time.Time             `json:"timestamp,omitempty"`
	Component     string                 `json:"component,omitempty"`
	Group         string                 `json:"group,omitempty"`
	Class         string                 `json:"class,omitempty"`
	CustomDetails map[string]interface{} `json:"custom_details,omitempty"`
}

// WebhookIncidentResponse for webhook responses
type WebhookIncidentResponse struct {
	Status      string `json:"status"`
	Message     string `json:"message"`
	DedupKey    string `json:"dedup_key,omitempty"`
	IncidentID  string `json:"incident_id,omitempty"`
	IncidentKey string `json:"incident_key,omitempty"`
}

// Constants

// Incident statuses (PagerDuty style)
const (
	IncidentStatusTriggered    = "triggered"
	IncidentStatusAcknowledged = "acknowledged"
	IncidentStatusResolved     = "resolved"
)

// Incident urgency levels
const (
	IncidentUrgencyLow  = "low"
	IncidentUrgencyHigh = "high"
)

// Incident event types
const (
	IncidentEventTriggered    = "triggered"
	IncidentEventAcknowledged = "acknowledged"
	IncidentEventResolved     = "resolved"
	IncidentEventAssigned     = "assigned"
	IncidentEventEscalated    = "escalated"
	IncidentEventNoteAdded    = "note_added"
	IncidentEventUpdated      = "updated"
)

// Webhook event actions
const (
	WebhookActionTrigger     = "trigger"
	WebhookActionAcknowledge = "acknowledge"
	WebhookActionResolve     = "resolve"
)
