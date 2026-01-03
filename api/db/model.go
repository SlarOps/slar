package db

import "time"

// ===========================
// INTEGRATION MODELS
// ===========================

// Integration represents an external monitoring integration
type Integration struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Type        string                 `json:"type"` // prometheus, datadog, grafana, webhook, aws, custom
	Description string                 `json:"description"`
	Config      map[string]interface{} `json:"config"`      // Integration-specific configuration
	WebhookURL  string                 `json:"webhook_url"` // Auto-generated webhook URL

	// Security
	WebhookSecret string `json:"webhook_secret,omitempty"`

	// Health monitoring
	IsActive          bool       `json:"is_active"`
	LastHeartbeat     *time.Time `json:"last_heartbeat,omitempty"`
	HeartbeatInterval int        `json:"heartbeat_interval"`      // seconds
	HealthStatus      string     `json:"health_status,omitempty"` // healthy, warning, unhealthy, unknown

	// Tenant isolation (ReBAC)
	OrganizationID string `json:"organization_id,omitempty"` // MANDATORY for tenant isolation
	ProjectID      string `json:"project_id,omitempty"`      // OPTIONAL for project scoping

	// Metadata
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by,omitempty"`

	// For API responses
	ServicesCount int `json:"services_count,omitempty"` // Number of linked services
}

// ServiceIntegration represents the many-to-many relationship between services and integrations
type ServiceIntegration struct {
	ID                string                 `json:"id"`
	ServiceID         string                 `json:"service_id"`
	IntegrationID     string                 `json:"integration_id"`
	RoutingConditions map[string]interface{} `json:"routing_conditions"` // Conditions for routing alerts
	Priority          int                    `json:"priority"`           // Lower number = higher priority
	IsActive          bool                   `json:"is_active"`

	// Metadata
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by,omitempty"`

	// For API responses (populated via JOINs)
	ServiceName     string `json:"service_name,omitempty"`
	IntegrationName string `json:"integration_name,omitempty"`
	IntegrationType string `json:"integration_type,omitempty"`
}

// IntegrationTemplate represents a template for creating integrations
type IntegrationTemplate struct {
	ID               string                 `json:"id"`
	Type             string                 `json:"type"`
	Name             string                 `json:"name"`
	Description      string                 `json:"description"`
	DefaultConfig    map[string]interface{} `json:"default_config"`
	ConfigSchema     map[string]interface{} `json:"config_schema"`
	PayloadTransform map[string]interface{} `json:"payload_transform,omitempty"`
	IsActive         bool                   `json:"is_active"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
}

// Integration request/response models
type CreateIntegrationRequest struct {
	Name              string                 `json:"name" binding:"required"`
	Type              string                 `json:"type" binding:"required"`
	Description       string                 `json:"description"`
	Config            map[string]interface{} `json:"config"`
	WebhookSecret     string                 `json:"webhook_secret,omitempty"`
	HeartbeatInterval int                    `json:"heartbeat_interval,omitempty"`
	// ReBAC: Tenant isolation fields
	OrganizationID string `json:"organization_id,omitempty"` // MANDATORY for tenant isolation
	ProjectID      string `json:"project_id,omitempty"`      // OPTIONAL for project scoping
}

type UpdateIntegrationRequest struct {
	Name              *string                `json:"name,omitempty"`
	Description       *string                `json:"description,omitempty"`
	Config            map[string]interface{} `json:"config,omitempty"`
	WebhookSecret     *string                `json:"webhook_secret,omitempty"`
	IsActive          *bool                  `json:"is_active,omitempty"`
	HeartbeatInterval *int                   `json:"heartbeat_interval,omitempty"`
}

// ServiceIntegration request models
type CreateServiceIntegrationRequest struct {
	ServiceID         string                 `json:"service_id,omitempty"`
	IntegrationID     string                 `json:"integration_id" binding:"required"`
	RoutingConditions map[string]interface{} `json:"routing_conditions"`
	Priority          int                    `json:"priority,omitempty"`
}

type UpdateServiceIntegrationRequest struct {
	RoutingConditions map[string]interface{} `json:"routing_conditions,omitempty"`
	Priority          *int                   `json:"priority,omitempty"`
	IsActive          *bool                  `json:"is_active,omitempty"`
}

type User struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Phone      string    `json:"phone,omitempty"`
	Role       string    `json:"role"` // admin, engineer, manager
	Team       string    `json:"team"` // Platform Team, Backend Team, etc.
	FCMToken   string    `json:"fcm_token,omitempty"`
	IsActive   bool      `json:"is_active"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	Provider   string    `json:"provider"`
	ProviderID string    `json:"provider_id"`
}

type Alert struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Severity    string     `json:"severity"`
	Source      string     `json:"source"`
	AckedBy     string     `json:"acked_by,omitempty"`
	AckedAt     *time.Time `json:"acked_at,omitempty"`
	AssignedTo  string     `json:"assigned_to,omitempty"` // User ID
	AssignedAt  *time.Time `json:"assigned_at,omitempty"`
	APIKeyID    string     `json:"api_key_id,omitempty"` // Track which API key created this alert
	GroupID     string     `json:"group_id,omitempty"`   // Track which group this alert belongs to
	ServiceID   string     `json:"service_id,omitempty"` // Track which service this alert belongs to
	// Escalation fields
	EscalationRuleID       string     `json:"escalation_rule_id,omitempty"`
	CurrentEscalationLevel int        `json:"current_escalation_level"`
	LastEscalatedAt        *time.Time `json:"last_escalated_at,omitempty"`
	EscalationStatus       string     `json:"escalation_status"` // none, pending, escalating, completed, stopped
}

// AlertResponse includes user information for API responses
type AlertResponse struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Status          string     `json:"status"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	Severity        string     `json:"severity"`
	Source          string     `json:"source"`
	AckedBy         string     `json:"acked_by,omitempty"`
	AckedAt         *time.Time `json:"acked_at,omitempty"`
	AssignedTo      string     `json:"assigned_to,omitempty"`       // User ID
	AssignedToName  string     `json:"assigned_to_name,omitempty"`  // User Name
	AssignedToEmail string     `json:"assigned_to_email,omitempty"` // User Email
	AssignedAt      *time.Time `json:"assigned_at,omitempty"`
	GroupID         string     `json:"group_id,omitempty"`     // Group ID
	GroupName       string     `json:"group_name,omitempty"`   // Group Name for display
	ServiceID       string     `json:"service_id,omitempty"`   // Service ID
	ServiceName     string     `json:"service_name,omitempty"` // Service Name for display
	// Escalation fields
	EscalationRuleID       string            `json:"escalation_rule_id,omitempty"`
	EscalationRuleName     string            `json:"escalation_rule_name,omitempty"`
	CurrentEscalationLevel int               `json:"current_escalation_level"`
	LastEscalatedAt        *time.Time        `json:"last_escalated_at,omitempty"`
	EscalationStatus       string            `json:"escalation_status"`
	EscalationHistory      []AlertEscalation `json:"escalation_history,omitempty"`
}

// SERVICE MANAGEMENT MODELS (PagerDuty-style)

// Service represents a service within a group (like PagerDuty services)
type Service struct {
	ID                 string                 `json:"id"`
	GroupID            string                 `json:"group_id"` // Belongs to a group
	Name               string                 `json:"name"`
	Description        string                 `json:"description"`
	RoutingKey         string                 `json:"routing_key"`          // Unique webhook key for this service
	RoutingConditions  map[string]interface{} `json:"routing_conditions"`   // Datadog-style routing conditions
	EscalationPolicyID string                 `json:"escalation_policy_id"` // Datadog-style escalation policy
	IsActive           bool                   `json:"is_active"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
	CreatedBy          string                 `json:"created_by,omitempty"`

	// Tenant isolation
	OrganizationID string `json:"organization_id,omitempty"` // Tenant isolation
	ProjectID      string `json:"project_id,omitempty"`      // Project scoping

	// Integration settings
	Integrations         map[string]interface{} `json:"integrations,omitempty"` // Datadog, Prometheus configs
	NotificationSettings map[string]interface{} `json:"notification_settings,omitempty"`

	// Display info (for API responses)
	GroupName          string `json:"group_name,omitempty"`
	EscalationRuleName string `json:"escalation_rule_name,omitempty"`
	AlertCount         int    `json:"alert_count,omitempty"`    // Current active alerts
	IncidentCount      int    `json:"incident_count,omitempty"` // Current incidents

	// Generated URLs (populated by service layer)
	GenericWebhookURL    string `json:"generic_webhook_url,omitempty"`
	PrometheusWebhookURL string `json:"prometheus_webhook_url,omitempty"`
}

// Service request/response models (Datadog-style)
type CreateServiceRequest struct {
	Name                 string                 `json:"name" binding:"required"`
	Description          string                 `json:"description"`
	RoutingKey           string                 `json:"routing_key" binding:"required"`
	RoutingConditions    map[string]interface{} `json:"routing_conditions"`             // Datadog-style routing conditions
	EscalationPolicyID   *string                `json:"escalation_policy_id,omitempty"` // Datadog-style escalation policy
	Integrations         map[string]interface{} `json:"integrations,omitempty"`
	NotificationSettings map[string]interface{} `json:"notification_settings,omitempty"`

	// Tenant isolation (required for multi-tenant)
	OrganizationID string `json:"organization_id,omitempty"` // Tenant context
	ProjectID      string `json:"project_id,omitempty"`      // Project context
}

type UpdateServiceRequest struct {
	Name                 *string                `json:"name,omitempty"`
	Description          *string                `json:"description,omitempty"`
	RoutingKey           *string                `json:"routing_key,omitempty"`
	RoutingConditions    map[string]interface{} `json:"routing_conditions,omitempty"`   // Datadog-style routing conditions
	EscalationPolicyID   *string                `json:"escalation_policy_id,omitempty"` // Datadog-style escalation policy
	IsActive             *bool                  `json:"is_active,omitempty"`
	Integrations         map[string]interface{} `json:"integrations,omitempty"`
	NotificationSettings map[string]interface{} `json:"notification_settings,omitempty"`
}

// UptimeService represents uptime monitoring services (renamed from Service to avoid conflict)
type UptimeService struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Type      string    `json:"type"`     // http, https, tcp, ping
	Method    string    `json:"method"`   // GET, POST, HEAD
	Interval  int       `json:"interval"` // Check interval in seconds
	Timeout   int       `json:"timeout"`  // Timeout in seconds
	IsActive  bool      `json:"is_active"`
	IsEnabled bool      `json:"is_enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Expected response
	ExpectedStatus int    `json:"expected_status,omitempty"` // Expected HTTP status code
	ExpectedBody   string `json:"expected_body,omitempty"`   // Expected response body content

	// Headers for HTTP requests
	Headers map[string]string `json:"headers,omitempty"`
}

type ServiceCheck struct {
	ID           string    `json:"id"`
	ServiceID    string    `json:"service_id"`
	Status       string    `json:"status"`        // up, down, timeout, error
	ResponseTime int       `json:"response_time"` // Response time in milliseconds
	StatusCode   int       `json:"status_code,omitempty"`
	ResponseBody string    `json:"response_body,omitempty"`
	ErrorMessage string    `json:"error_message,omitempty"`
	CheckedAt    time.Time `json:"checked_at"`

	// SSL Certificate info (for HTTPS)
	SSLExpiry   *time.Time `json:"ssl_expiry,omitempty"`
	SSLIssuer   string     `json:"ssl_issuer,omitempty"`
	SSLDaysLeft int        `json:"ssl_days_left,omitempty"`
}

type UptimeStats struct {
	ServiceID        string    `json:"service_id"`
	Period           string    `json:"period"` // 1h, 24h, 7d, 30d
	UptimePercentage float64   `json:"uptime_percentage"`
	TotalChecks      int       `json:"total_checks"`
	SuccessfulChecks int       `json:"successful_checks"`
	FailedChecks     int       `json:"failed_checks"`
	AvgResponseTime  float64   `json:"avg_response_time"`
	MinResponseTime  int       `json:"min_response_time"`
	MaxResponseTime  int       `json:"max_response_time"`
	LastUpdated      time.Time `json:"last_updated"`
}

type ServiceIncident struct {
	ID          string     `json:"id"`
	ServiceID   string     `json:"service_id"`
	Type        string     `json:"type"`   // downtime, slow_response, ssl_expiry
	Status      string     `json:"status"` // ongoing, resolved
	StartedAt   time.Time  `json:"started_at"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
	Duration    int        `json:"duration,omitempty"` // Duration in seconds
	Description string     `json:"description"`
	AlertID     string     `json:"alert_id,omitempty"` // Related alert ID
}

// API Key Authentication Models
type APIKey struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	GroupID            string     `json:"group_id,omitempty"` // Group that owns this API key
	Name               string     `json:"name"`
	APIKey             string     `json:"api_key,omitempty"` // Only shown during creation
	APIKeyHash         string     `json:"-"`                 // Never expose hash
	Permissions        []string   `json:"permissions"`
	IsActive           bool       `json:"is_active"`
	LastUsedAt         *time.Time `json:"last_used_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	RateLimitPerHour   int        `json:"rate_limit_per_hour"`
	RateLimitPerDay    int        `json:"rate_limit_per_day"`
	TotalRequests      int        `json:"total_requests"`
	TotalAlertsCreated int        `json:"total_alerts_created"`
	Description        string     `json:"description"`
	Environment        string     `json:"environment"` // prod, dev, test
	CreatedBy          string     `json:"created_by,omitempty"`

	// Tenant isolation
	OrganizationID string `json:"organization_id,omitempty"` // Tenant isolation
}

type APIKeyUsageLog struct {
	ID             string    `json:"id"`
	APIKeyID       string    `json:"api_key_id"`
	Endpoint       string    `json:"endpoint"`
	Method         string    `json:"method"`
	IPAddress      string    `json:"ip_address,omitempty"`
	UserAgent      string    `json:"user_agent,omitempty"`
	RequestSize    int       `json:"request_size"`
	ResponseStatus int       `json:"response_status"`
	ResponseTimeMs int       `json:"response_time_ms"`
	CreatedAt      time.Time `json:"created_at"`
	AlertID        string    `json:"alert_id,omitempty"`
	AlertTitle     string    `json:"alert_title,omitempty"`
	AlertSeverity  string    `json:"alert_severity,omitempty"`
	RequestID      string    `json:"request_id,omitempty"`
	ErrorMessage   string    `json:"error_message,omitempty"`
}

type APIKeyRateLimit struct {
	ID           string    `json:"id"`
	APIKeyID     string    `json:"api_key_id"`
	WindowStart  time.Time `json:"window_start"`
	WindowType   string    `json:"window_type"` // hour, day
	RequestCount int       `json:"request_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// API Key Statistics (from view)
type APIKeyStats struct {
	ID                 string     `json:"id"`
	Name               string     `json:"name"`
	UserID             string     `json:"user_id"`
	UserName           string     `json:"user_name"`
	UserEmail          string     `json:"user_email"`
	GroupID            string     `json:"group_id,omitempty"`
	GroupName          string     `json:"group_name,omitempty"`
	Environment        string     `json:"environment"`
	IsActive           bool       `json:"is_active"`
	CreatedAt          time.Time  `json:"created_at"`
	LastUsedAt         *time.Time `json:"last_used_at,omitempty"`
	TotalRequests      int        `json:"total_requests"`
	TotalAlertsCreated int        `json:"total_alerts_created"`
	RateLimitPerHour   int        `json:"rate_limit_per_hour"`
	RateLimitPerDay    int        `json:"rate_limit_per_day"`
	RequestsLast24h    int        `json:"requests_last_24h"`
	AlertsLast24h      int        `json:"alerts_last_24h"`
	ErrorsLast24h      int        `json:"errors_last_24h"`
	AvgResponseTimeMs  float64    `json:"avg_response_time_ms"`
	Status             string     `json:"status"` // active, disabled, expired
}

// Request/Response DTOs
type CreateAPIKeyRequest struct {
	Name             string     `json:"name" binding:"required"`
	Description      string     `json:"description"`
	Environment      string     `json:"environment" binding:"required,oneof=prod dev test"`
	Permissions      []string   `json:"permissions" binding:"required"`
	GroupID          string     `json:"group_id,omitempty"` // Optional: assign API key to a group
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	RateLimitPerHour int        `json:"rate_limit_per_hour,omitempty"`
	RateLimitPerDay  int        `json:"rate_limit_per_day,omitempty"`
}

type CreateAPIKeyResponse struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	APIKey      string     `json:"api_key"` // Only shown once
	Environment string     `json:"environment"`
	Permissions []string   `json:"permissions"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	Message     string     `json:"message"`
}

type UpdateAPIKeyRequest struct {
	Name             *string    `json:"name,omitempty"`
	Description      *string    `json:"description,omitempty"`
	IsActive         *bool      `json:"is_active,omitempty"`
	Permissions      []string   `json:"permissions,omitempty"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	RateLimitPerHour *int       `json:"rate_limit_per_hour,omitempty"`
	RateLimitPerDay  *int       `json:"rate_limit_per_day,omitempty"`
}

type WebhookAlertRequest struct {
	Title       string                 `json:"title" binding:"required"`
	Description string                 `json:"description" binding:"required"`
	Severity    string                 `json:"severity" binding:"required,oneof=low medium high critical"`
	Source      string                 `json:"source" binding:"required"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type WebhookAlertResponse struct {
	AlertID    string `json:"alert_id"`
	Status     string `json:"status"`
	AssignedTo string `json:"assigned_to,omitempty"`
	Message    string `json:"message"`
}

// Permission constants
type Permission string

const (
	PermissionCreateAlerts   Permission = "create_alerts"
	PermissionReadAlerts     Permission = "read_alerts"
	PermissionManageOnCall   Permission = "manage_oncall"
	PermissionViewDashboard  Permission = "view_dashboard"
	PermissionManageServices Permission = "manage_services"
)

// Valid permissions list
var ValidPermissions = []Permission{
	PermissionCreateAlerts,
	PermissionReadAlerts,
	PermissionManageOnCall,
	PermissionViewDashboard,
	PermissionManageServices,
}

// Environment constants
const (
	EnvironmentProd = "prod"
	EnvironmentDev  = "dev"
	EnvironmentTest = "test"
)

// Rate limit window types
const (
	WindowTypeHour = "hour"
	WindowTypeDay  = "day"
)

// GROUP MANAGEMENT AND ESCALATION MODELS

// Group represents a group of users for escalation
type Group struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Description       string    `json:"description"`
	Type              string    `json:"type"`       // escalation, team, project, department
	Visibility        string    `json:"visibility"` // private, public, organization
	IsActive          bool      `json:"is_active"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
	CreatedBy         string    `json:"created_by,omitempty"`
	EscalationTimeout int       `json:"escalation_timeout"` // seconds
	EscalationMethod  string    `json:"escalation_method"`  // parallel, sequential, round_robin
	MemberCount       int       `json:"member_count"`       // Number of active members
	UserName          string    `json:"user_name,omitempty"`
	UserEmail         string    `json:"user_email,omitempty"`
	UserTeam          string    `json:"user_team,omitempty"`

	// Tenant isolation
	OrganizationID string `json:"organization_id,omitempty"` // Tenant isolation
	ProjectID      string `json:"project_id,omitempty"`      // Project scoping
}

// GroupWithMembers includes member information
type GroupWithMembers struct {
	Group
	Members []GroupMember `json:"members"`
}

// GroupMember represents a user's membership in a group
type GroupMember struct {
	ID                      string                 `json:"id"`
	GroupID                 string                 `json:"group_id"`
	UserID                  string                 `json:"user_id"`
	Role                    string                 `json:"role"`             // member, leader, backup
	EscalationOrder         int                    `json:"escalation_order"` // For sequential escalation
	IsActive                bool                   `json:"is_active"`
	NotificationPreferences map[string]interface{} `json:"notification_preferences,omitempty"`
	AddedAt                 time.Time              `json:"added_at"`
	AddedBy                 string                 `json:"added_by,omitempty"`
	// User info (for display)
	UserName  string `json:"user_name,omitempty"`
	UserEmail string `json:"user_email,omitempty"`
	UserTeam  string `json:"user_team,omitempty"`
}

// DATADOG-STYLE ESCALATION MODELS

// EscalationPolicy defines a Datadog-style escalation policy with multiple levels
type EscalationPolicy struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Description          string    `json:"description,omitempty"`
	IsActive             bool      `json:"is_active"`
	RepeatMaxTimes       int       `json:"repeat_max_times"`       // "Repeat all rules up to X times"
	EscalateAfterMinutes int       `json:"escalate_after_minutes"` // Default timeout (can be overridden per level)
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
	GroupID              string    `json:"group_id"`
	CreatedBy            string    `json:"created_by,omitempty"`

	// Tenant isolation
	OrganizationID string `json:"organization_id,omitempty"` // Tenant isolation

	// Nested levels (populated when needed)
	Levels []EscalationLevel `json:"levels,omitempty"`
}

// EscalationLevel defines a single step in the escalation chain (Datadog-style)
type EscalationLevel struct {
	ID                  string    `json:"id"`
	PolicyID            string    `json:"policy_id"`
	LevelNumber         int       `json:"level_number"`
	TargetType          string    `json:"target_type"`          // 'current_schedule', 'user', 'group', 'external'
	TargetID            string    `json:"target_id,omitempty"`  // user_id, schedule_id, group_id, webhook_url
	TimeoutMinutes      int       `json:"timeout_minutes"`      // Override policy default (0 = use policy default)
	NotificationMethods []string  `json:"notification_methods"` // ["email", "sms", "phone", "push"]
	MessageTemplate     string    `json:"message_template"`
	CreatedAt           time.Time `json:"created_at"`

	// Display info (populated when needed)
	TargetName        string `json:"target_name,omitempty"`
	TargetDescription string `json:"target_description,omitempty"`
}

// GetEffectiveTimeout returns the effective timeout for this level
// Uses level-specific timeout if set, otherwise falls back to policy default
func (el *EscalationLevel) GetEffectiveTimeout(policyDefault int) int {
	if el.TimeoutMinutes > 0 {
		return el.TimeoutMinutes
	}
	return policyDefault
}

// EscalationPolicyWithLevels includes all escalation levels for a policy
type EscalationPolicyWithLevels struct {
	EscalationPolicy
	Levels []EscalationLevel `json:"levels"`
}

// AlertEscalation tracks escalation history for an alert (Datadog-style)
type AlertEscalation struct {
	ID                  string     `json:"id"`
	AlertID             string     `json:"alert_id"`
	EscalationPolicyID  string     `json:"escalation_policy_id"`
	EscalationLevel     int        `json:"escalation_level"`
	TargetType          string     `json:"target_type"`
	TargetID            string     `json:"target_id"`
	Status              string     `json:"status"` // executing, completed, failed, acknowledged, timeout
	ErrorMessage        string     `json:"error_message,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	AcknowledgedAt      *time.Time `json:"acknowledged_at,omitempty"`
	AcknowledgedBy      string     `json:"acknowledged_by,omitempty"`
	ResponseTimeSeconds int        `json:"response_time_seconds,omitempty"`
	NotificationMethods []string   `json:"notification_methods"`
	// Target info (for display)
	TargetName string `json:"target_name,omitempty"`
	RuleName   string `json:"rule_name,omitempty"`
}

// RotationCycle represents automatic rotation configurations
type RotationCycle struct {
	ID           string    `json:"id"`
	GroupID      string    `json:"group_id"`
	RotationType string    `json:"rotation_type"` // daily, weekly, custom
	RotationDays int       `json:"rotation_days"` // 1=daily, 7=weekly, etc.
	StartDate    time.Time `json:"start_date"`
	StartTime    string    `json:"start_time"`   // "09:00"
	EndTime      string    `json:"end_time"`     // "17:00"
	MemberOrder  []string  `json:"member_order"` // ['user-id-1', 'user-id-2']
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	CreatedBy    string    `json:"created_by,omitempty"`
	// Member info for display
	Members []RotationMember `json:"members,omitempty"`
}

type RotationMember struct {
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
	UserEmail string `json:"user_email"`
	UserTeam  string `json:"user_team,omitempty"`
	Order     int    `json:"order"` // Position in rotation
}

// Scheduler represents a team/group that handles on-call duties
type Scheduler struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`         // "devops", "backend", "frontend"
	DisplayName  string    `json:"display_name"` // "DevOps Team", "Backend Team"
	GroupID      string    `json:"group_id"`
	Description  string    `json:"description,omitempty"`
	IsActive     bool      `json:"is_active"`
	RotationType string    `json:"rotation_type"` // 'manual', 'round_robin', 'weekly'
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	CreatedBy    string    `json:"created_by,omitempty"`

	// Tenant isolation
	OrganizationID string `json:"organization_id,omitempty"` // Tenant isolation

	// Nested shifts (populated when needed)
	Shifts []Shift `json:"shifts,omitempty"`
}

// Shift represents individual time slots within a scheduler (formerly OnCallSchedule)
type Shift struct {
	ID              string    `json:"id"`
	SchedulerID     string    `json:"scheduler_id"`                // FK to schedulers
	RotationCycleID *string   `json:"rotation_cycle_id,omitempty"` // Links to rotation cycle
	GroupID         string    `json:"group_id"`
	UserID          string    `json:"user_id"`
	ShiftType       string    `json:"shift_type"` // daily, weekly, custom (renamed from schedule_type)
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	IsActive        bool      `json:"is_active"`
	IsRecurring     bool      `json:"is_recurring"`
	RotationDays    int       `json:"rotation_days"` // For recurring shifts
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	CreatedBy       string    `json:"created_by,omitempty"`

	// Tenant isolation
	OrganizationID string `json:"organization_id,omitempty"` // Tenant isolation

	// Service-specific scheduling
	ServiceID     *string `json:"service_id,omitempty"` // For service-specific shifts
	ScheduleScope string  `json:"schedule_scope"`       // 'group' or 'service'

	// Override information (from schedule_overrides join)
	IsOverridden    bool    `json:"is_overridden"`             // Has active override
	IsFullOverride  bool    `json:"is_full_override"`          // True if override covers exact same time as original
	OverrideID      *string `json:"override_id,omitempty"`     // Override record ID
	OverrideReason  *string `json:"override_reason,omitempty"` // Why override
	OverrideType    *string `json:"override_type,omitempty"`   // temporary/permanent/emergency
	EffectiveUserID string  `json:"effective_user_id"`         // Actual user (with override applied)

	// User info (for effective user - the one actually on call)
	UserName  string `json:"user_name,omitempty"`
	UserEmail string `json:"user_email,omitempty"`
	UserTeam  string `json:"user_team,omitempty"`

	// Original user info (if overridden)
	OriginalUserID    *string `json:"original_user_id,omitempty"`
	OriginalUserName  *string `json:"original_user_name,omitempty"`
	OriginalUserEmail *string `json:"original_user_email,omitempty"`
	OriginalUserTeam  *string `json:"original_user_team,omitempty"`

	// Override user info (when applicable)
	OverrideUserName  *string    `json:"override_user_name,omitempty"`
	OverrideUserEmail *string    `json:"override_user_email,omitempty"`
	OverrideUserTeam  *string    `json:"override_user_team,omitempty"`
	OverrideStartTime *time.Time `json:"override_start_time,omitempty"`
	OverrideEndTime   *time.Time `json:"override_end_time,omitempty"`

	// Scheduler info (populated when needed)
	SchedulerName        string `json:"scheduler_name,omitempty"`
	SchedulerDisplayName string `json:"scheduler_display_name,omitempty"`
}

// ScheduleOverride represents override records for changing on-call assignments
type ScheduleOverride struct {
	ID                 string    `json:"id"`
	OriginalScheduleID string    `json:"original_schedule_id"`
	GroupID            string    `json:"group_id"`
	NewUserID          string    `json:"new_user_id"`
	OverrideReason     *string   `json:"override_reason,omitempty"`
	OverrideType       string    `json:"override_type"` // temporary, permanent, emergency
	OverrideStartTime  time.Time `json:"override_start_time"`
	OverrideEndTime    time.Time `json:"override_end_time"`
	IsActive           bool      `json:"is_active"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	CreatedBy          string    `json:"created_by"`

	// User info for display
	NewUserName  string `json:"new_user_name,omitempty"`
	NewUserEmail string `json:"new_user_email,omitempty"`
}

// CreateSchedulerRequest represents the request body for creating a scheduler (team)
type CreateSchedulerRequest struct {
	Name         string `json:"name" binding:"required"` // "devops", "backend"
	DisplayName  string `json:"display_name"`            // "DevOps Team"
	Description  string `json:"description"`
	RotationType string `json:"rotation_type"` // 'manual', 'round_robin', 'weekly'

	// Tenant isolation (required for multi-tenant)
	OrganizationID string `json:"organization_id,omitempty"` // Tenant context
}

// CreateShiftRequest represents the request body for creating a shift (formerly schedule)
type CreateShiftRequest struct {
	SchedulerID  string    `json:"scheduler_id"` // FK to schedulers (optional for backward compatibility)
	UserID       string    `json:"user_id" binding:"required"`
	ShiftType    string    `json:"shift_type"` // daily, weekly, custom (optional, defaults to 'custom')
	StartTime    time.Time `json:"start_time" binding:"required"`
	EndTime      time.Time `json:"end_time" binding:"required"`
	IsRecurring  bool      `json:"is_recurring"`
	RotationDays int       `json:"rotation_days"`
	// Service scheduling support
	ServiceID     *string `json:"service_id,omitempty"` // For service-specific shifts
	ScheduleScope string  `json:"schedule_scope"`       // 'group' or 'service'
}

// CreateScheduleOverrideRequest represents the request body for creating an override
type CreateScheduleOverrideRequest struct {
	OriginalScheduleID string    `json:"original_schedule_id" binding:"required"`
	NewUserID          string    `json:"new_user_id" binding:"required"`
	OverrideReason     *string   `json:"override_reason,omitempty"`
	OverrideType       string    `json:"override_type"` // temporary, permanent, emergency
	OverrideStartTime  time.Time `json:"override_start_time" binding:"required"`
	OverrideEndTime    time.Time `json:"override_end_time" binding:"required"`
}

// UpdateOnCallScheduleRequest represents the request body for updating schedule
type UpdateOnCallScheduleRequest struct {
	UserID       *string    `json:"user_id"`
	ScheduleType *string    `json:"schedule_type"`
	StartTime    *time.Time `json:"start_time"`
	EndTime      *time.Time `json:"end_time"`
	IsActive     *bool      `json:"is_active"`
	IsRecurring  *bool      `json:"is_recurring"`
	RotationDays *int       `json:"rotation_days"`
	// Note: ServiceID and ScheduleScope are intentionally NOT included
	// Option 1: Service assignment cannot be changed after schedule creation
	// This enforces 1 service = 1 schedule constraint
}

// CreateRotationCycleRequest represents request to create automatic rotation
type CreateRotationCycleRequest struct {
	RotationType string   `json:"rotation_type" binding:"required"` // daily, weekly, custom
	RotationDays int      `json:"rotation_days"`                    // defaults based on type
	StartDate    string   `json:"start_date" binding:"required"`    // "2024-01-15"
	StartTime    string   `json:"start_time"`                       // "09:00" default "00:00"
	EndTime      string   `json:"end_time"`                         // "17:00" default "23:59"
	MemberOrder  []string `json:"member_order" binding:"required"`  // ['user-id-1', 'user-id-2']
	WeeksAhead   int      `json:"weeks_ahead"`                      // How many weeks to generate, default 52
}

// Removed duplicate CreateScheduleOverrideRequest - using the one defined earlier

// RotationPreview represents preview of rotation schedule
type RotationPreview struct {
	WeekNumber int       `json:"week_number"`
	StartDate  time.Time `json:"start_date"`
	EndDate    time.Time `json:"end_date"`
	UserID     string    `json:"user_id"`
	UserName   string    `json:"user_name"`
	UserEmail  string    `json:"user_email"`
}

// RotationCycleResponse includes rotation cycle with preview
type RotationCycleResponse struct {
	RotationCycle    RotationCycle     `json:"rotation_cycle"`
	PreviewWeeks     []RotationPreview `json:"preview_weeks"`
	SchedulesCreated int               `json:"schedules_created"`
}

// Request/Response DTOs for Group Management

// CreateGroupRequest for creating a new group
type CreateGroupRequest struct {
	Name              string `json:"name" binding:"required"`
	Description       string `json:"description"`
	Type              string `json:"type" binding:"required,oneof=escalation notification approval"`
	Visibility        string `json:"visibility,omitempty" binding:"omitempty,oneof=private public organization"`
	EscalationTimeout int    `json:"escalation_timeout,omitempty"`
	EscalationMethod  string `json:"escalation_method,omitempty"`

	// Tenant isolation (required for multi-tenant)
	OrganizationID string `json:"organization_id,omitempty"` // Tenant context
	ProjectID      string `json:"project_id,omitempty"`      // Project context
}

// UpdateGroupRequest for updating a group
type UpdateGroupRequest struct {
	Name              *string `json:"name,omitempty"`
	Description       *string `json:"description,omitempty"`
	Type              *string `json:"type,omitempty"`
	Visibility        *string `json:"visibility,omitempty"`
	IsActive          *bool   `json:"is_active,omitempty"`
	EscalationTimeout *int    `json:"escalation_timeout,omitempty"`
	EscalationMethod  *string `json:"escalation_method,omitempty"`
}

// AddGroupMemberRequest for adding a user to a group
type AddGroupMemberRequest struct {
	UserID                  string                 `json:"user_id" binding:"required"`
	Role                    string                 `json:"role,omitempty"`
	EscalationOrder         int                    `json:"escalation_order,omitempty"`
	NotificationPreferences map[string]interface{} `json:"notification_preferences,omitempty"`
}

// UpdateGroupMemberRequest for updating a group member
type UpdateGroupMemberRequest struct {
	Role                    *string                `json:"role,omitempty"`
	EscalationOrder         *int                   `json:"escalation_order,omitempty"`
	IsActive                *bool                  `json:"is_active,omitempty"`
	NotificationPreferences map[string]interface{} `json:"notification_preferences,omitempty"`
}

// DATADOG-STYLE REQUEST/RESPONSE MODELS

// CreateEscalationPolicyRequest for creating Datadog-style escalation policies
type CreateEscalationPolicyRequest struct {
	Name                 string                         `json:"name" binding:"required"`
	Description          string                         `json:"description"`
	RepeatMaxTimes       int                            `json:"repeat_max_times"`
	EscalateAfterMinutes int                            `json:"escalate_after_minutes" binding:"min=1,max=1440"`
	Levels               []CreateEscalationLevelRequest `json:"levels" binding:"required,min=1,dive"`
}

// UpdateEscalationPolicyRequest for updating escalation policies
type UpdateEscalationPolicyRequest struct {
	Name                 *string                        `json:"name,omitempty"`
	Description          *string                        `json:"description,omitempty"`
	IsActive             *bool                          `json:"is_active,omitempty"`
	RepeatMaxTimes       *int                           `json:"repeat_max_times,omitempty"`
	EscalateAfterMinutes *int                           `json:"escalate_after_minutes,omitempty"`
	Levels               []UpdateEscalationLevelRequest `json:"levels,omitempty"`
}

// CreateEscalationLevelRequest for creating escalation levels
type CreateEscalationLevelRequest struct {
	LevelNumber         int      `json:"level_number" binding:"required,min=1"`
	TargetType          string   `json:"target_type" binding:"required,oneof=scheduler user group external current_schedule"`
	TargetID            string   `json:"target_id,omitempty"`
	TimeoutMinutes      int      `json:"timeout_minutes" binding:"required,min=1,max=1440"`
	NotificationMethods []string `json:"notification_methods"`
	MessageTemplate     string   `json:"message_template"`
}

// UpdateEscalationLevelRequest for updating escalation levels
type UpdateEscalationLevelRequest struct {
	ID                  string   `json:"id,omitempty"`
	LevelNumber         *int     `json:"level_number,omitempty"`
	TargetType          *string  `json:"target_type,omitempty"`
	TargetID            *string  `json:"target_id,omitempty"`
	TimeoutMinutes      *int     `json:"timeout_minutes,omitempty"`
	NotificationMethods []string `json:"notification_methods,omitempty"`
	MessageTemplate     *string  `json:"message_template,omitempty"`
}

// Group and escalation constants
const (
	GroupTypeEscalation   = "escalation"
	GroupTypeNotification = "notification"
	GroupTypeApproval     = "approval"
)

const (
	GroupVisibilityPrivate      = "private"
	GroupVisibilityPublic       = "public"
	GroupVisibilityOrganization = "organization"
)

const (
	EscalationMethodParallel   = "parallel"
	EscalationMethodSequential = "sequential"
	EscalationMethodRoundRobin = "round_robin"
)

// Group member role constants
const (
	GroupMemberRoleMember = "member"
	GroupMemberRoleLeader = "leader"
	GroupMemberRoleBackup = "backup"
)

const (
	EscalationStatusNone       = "none"
	EscalationStatusPending    = "pending"
	EscalationStatusEscalating = "escalating"
	EscalationStatusCompleted  = "completed"
	EscalationStatusStopped    = "stopped"
)

// OnCall Schedule types
const (
	ScheduleTypeDaily  = "daily"
	ScheduleTypeWeekly = "weekly"
	ScheduleTypeCustom = "custom"
)

const (
	EscalationTargetUser     = "user"
	EscalationTargetGroup    = "group"
	EscalationTargetExternal = "external"
)

const (
	AlertEscalationStatusPending      = "pending"
	AlertEscalationStatusSent         = "sent"
	AlertEscalationStatusFailed       = "failed"
	AlertEscalationStatusAcknowledged = "acknowledged"
	AlertEscalationStatusTimeout      = "timeout"
)

const (
	NotificationMethodFCM     = "fcm"
	NotificationMethodEmail   = "email"
	NotificationMethodSMS     = "sms"
	NotificationMethodWebhook = "webhook"
)

// SHIFT SWAP MODELS

// ShiftSwapRequest represents a request to swap two schedules
type ShiftSwapRequest struct {
	CurrentScheduleID string `json:"current_schedule_id" binding:"required"`
	TargetScheduleID  string `json:"target_schedule_id" binding:"required"`
	SwapMessage       string `json:"swap_message,omitempty"`
	SwapType          string `json:"swap_type"` // "instant" or "request"
	CurrentUserID     string `json:"current_user_id,omitempty"`
	TargetUserID      string `json:"target_user_id,omitempty"`
}

// ShiftSwapResponse represents the response after a shift swap operation
type ShiftSwapResponse struct {
	Success         bool      `json:"success"`
	Message         string    `json:"message"`
	SwappedAt       time.Time `json:"swapped_at"`
	CurrentSchedule Shift     `json:"current_schedule"`
	TargetSchedule  Shift     `json:"target_schedule"`
}

// Swap type constants
const (
	SwapTypeInstant = "instant"
	SwapTypeRequest = "request"
)

// SERVICE MANAGEMENT DTOs

// CreateServiceResponse for service creation response
type CreateServiceResponse struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	RoutingKey  string    `json:"routing_key"` // Generated webhook key
	GroupID     string    `json:"group_id"`
	CreatedAt   time.Time `json:"created_at"`
	WebhookURL  string    `json:"webhook_url"` // Full webhook URL
	Message     string    `json:"message"`
}

// ServiceResponse for API responses with aggregated data
type ServiceResponse struct {
	Service
	RecentAlerts []AlertResponse `json:"recent_alerts,omitempty"`
	OnCallUser   *User           `json:"on_call_user,omitempty"`
	UptimeStats  *ServiceStats   `json:"uptime_stats,omitempty"`
}

// ServiceStats for service statistics
type ServiceStats struct {
	TotalAlerts     int     `json:"total_alerts"`
	ActiveAlerts    int     `json:"active_alerts"`
	ResolvedToday   int     `json:"resolved_today"`
	AvgResponseTime float64 `json:"avg_response_time_minutes"`
	UptimePercent   float64 `json:"uptime_percent"`
}

// ALERT ROUTING TABLE MODELS (VPC-style routing)

// AlertRoutingTable represents a routing table for alerts (similar to VPC routing)
type AlertRoutingTable struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	IsActive    bool      `json:"is_active"`
	Priority    int       `json:"priority"` // Higher number = higher priority
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	CreatedBy   string    `json:"created_by,omitempty"`

	// For API responses
	RuleCount int `json:"rule_count,omitempty"`
}

// AlertRoutingRule represents a rule within a routing table
type AlertRoutingRule struct {
	ID             string `json:"id"`
	RoutingTableID string `json:"routing_table_id"`
	Name           string `json:"name"`
	Priority       int    `json:"priority"` // Rule priority within table
	IsActive       bool   `json:"is_active"`

	// Matching Conditions (JSON for flexibility)
	MatchConditions map[string]interface{} `json:"match_conditions"`

	// Target routing
	TargetGroupID    string `json:"target_group_id"`
	EscalationRuleID string `json:"escalation_rule_id,omitempty"`

	// Time-based routing conditions
	TimeConditions map[string]interface{} `json:"time_conditions,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by,omitempty"`

	// For API responses
	TargetGroupName    string `json:"target_group_name,omitempty"`
	EscalationRuleName string `json:"escalation_rule_name,omitempty"`
}

// AlertRouteLog represents a log entry for alert routing decisions
type AlertRouteLog struct {
	ID               string                 `json:"id"`
	AlertID          string                 `json:"alert_id"`
	RoutingTableID   string                 `json:"routing_table_id,omitempty"`
	RoutingRuleID    string                 `json:"routing_rule_id,omitempty"`
	TargetGroupID    string                 `json:"target_group_id,omitempty"`
	MatchedAt        time.Time              `json:"matched_at"`
	MatchedReason    string                 `json:"matched_reason"`
	MatchConditions  map[string]interface{} `json:"match_conditions,omitempty"`
	AlertAttributes  map[string]interface{} `json:"alert_attributes,omitempty"`
	EvaluationTimeMs int                    `json:"evaluation_time_ms"`

	// For API responses
	RoutingTableName string `json:"routing_table_name,omitempty"`
	RoutingRuleName  string `json:"routing_rule_name,omitempty"`
	TargetGroupName  string `json:"target_group_name,omitempty"`
}

// RoutingResult represents the result of routing evaluation
type RoutingResult struct {
	TargetGroupID    string             `json:"target_group_id"`
	EscalationRuleID string             `json:"escalation_rule_id,omitempty"`
	MatchedRule      *AlertRoutingRule  `json:"matched_rule,omitempty"`
	MatchedTable     *AlertRoutingTable `json:"matched_table,omitempty"`
	MatchedReason    string             `json:"matched_reason"`
	EvaluationTimeMs int                `json:"evaluation_time_ms"`
}

// Request/Response DTOs for Routing Tables

// CreateRoutingTableRequest for creating a new routing table
type CreateRoutingTableRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Priority    int    `json:"priority,omitempty"`
}

// UpdateRoutingTableRequest for updating a routing table
type UpdateRoutingTableRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	IsActive    *bool   `json:"is_active,omitempty"`
	Priority    *int    `json:"priority,omitempty"`
}

// CreateRoutingRuleRequest for creating a new routing rule
type CreateRoutingRuleRequest struct {
	Name             string                 `json:"name" binding:"required"`
	Priority         int                    `json:"priority,omitempty"`
	MatchConditions  map[string]interface{} `json:"match_conditions" binding:"required"`
	TargetGroupID    string                 `json:"target_group_id" binding:"required"`
	EscalationRuleID string                 `json:"escalation_rule_id,omitempty"`
	TimeConditions   map[string]interface{} `json:"time_conditions,omitempty"`
}

// UpdateRoutingRuleRequest for updating a routing rule
type UpdateRoutingRuleRequest struct {
	Name             *string                `json:"name,omitempty"`
	Priority         *int                   `json:"priority,omitempty"`
	IsActive         *bool                  `json:"is_active,omitempty"`
	MatchConditions  map[string]interface{} `json:"match_conditions,omitempty"`
	TargetGroupID    *string                `json:"target_group_id,omitempty"`
	EscalationRuleID *string                `json:"escalation_rule_id,omitempty"`
	TimeConditions   map[string]interface{} `json:"time_conditions,omitempty"`
}

// TestRoutingRequest for testing routing rules
type TestRoutingRequest struct {
	Alert AlertAttributes `json:"alert" binding:"required"`
}

// AlertAttributes represents alert attributes for routing testing
type AlertAttributes struct {
	Severity    string                 `json:"severity"`
	Source      string                 `json:"source"`
	Labels      map[string]interface{} `json:"labels,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt   *time.Time             `json:"created_at,omitempty"`
	Environment string                 `json:"environment,omitempty"`
}

// RoutingTableWithRules includes routing table with its rules
type RoutingTableWithRules struct {
	AlertRoutingTable
	Rules []AlertRoutingRule `json:"rules"`
}

// Routing constants
const (
	RoutingOperatorEquals      = "equals"
	RoutingOperatorNotEquals   = "not_equals"
	RoutingOperatorIn          = "in"
	RoutingOperatorNotIn       = "not_in"
	RoutingOperatorContains    = "contains"
	RoutingOperatorNotContains = "not_contains"
	RoutingOperatorRegex       = "regex"
	RoutingOperatorGreaterThan = "greater_than"
	RoutingOperatorLessThan    = "less_than"
	RoutingOperatorDefault     = "default"
)

// Routing logical operators
const (
	RoutingLogicalAnd = "and"
	RoutingLogicalOr  = "or"
	RoutingLogicalNot = "not"
)

// Time condition constants
const (
	TimeConditionBusinessHours = "business_hours"
	TimeConditionWeekdays      = "weekdays"
	TimeConditionWeekends      = "weekends"
	TimeConditionHours         = "hours"
	TimeConditionDays          = "days"
	TimeConditionTimezone      = "timezone"
)
