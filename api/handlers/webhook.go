package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type WebhookHandler struct {
	integrationService *services.IntegrationService
	alertService       *services.AlertService
	incidentService    *services.IncidentService
	serviceService     *services.ServiceService
}

func NewWebhookHandler(integrationService *services.IntegrationService, alertService *services.AlertService, incidentService *services.IncidentService, serviceService *services.ServiceService) *WebhookHandler {
	return &WebhookHandler{
		integrationService: integrationService,
		alertService:       alertService,
		incidentService:    incidentService,
		serviceService:     serviceService,
	}
}

// Generic webhook payload structure
type WebhookPayload struct {
	IntegrationType string                 `json:"integration_type"`
	IntegrationID   string                 `json:"integration_id"`
	Timestamp       time.Time              `json:"timestamp"`
	RawPayload      map[string]interface{} `json:"raw_payload"`
	ProcessedAlerts []ProcessedAlert       `json:"processed_alerts"`
}

type ProcessedAlert struct {
	AlertName   string                 `json:"alert_name"`
	Severity    string                 `json:"severity"`
	Status      string                 `json:"status"` // firing, resolved
	Summary     string                 `json:"summary"`
	Description string                 `json:"description"`
	Labels      map[string]interface{} `json:"labels"`
	Annotations map[string]interface{} `json:"annotations"`
	StartsAt    time.Time              `json:"starts_at"`
	EndsAt      *time.Time             `json:"ends_at,omitempty"`
	Fingerprint string                 `json:"fingerprint"` // For deduplication
}

// ResolvedServiceInfo holds service resolution results
type ResolvedServiceInfo struct {
	Service            *db.Service
	ServiceIntegration *db.ServiceIntegration
	Found              bool
}

// ResolvedAssigneeInfo holds assignee resolution results
type ResolvedAssigneeInfo struct {
	UserID string
	Found  bool
	Method string // "escalation_policy", "default", etc.
}

// POST /webhook/:type/:integration_id
func (h *WebhookHandler) ReceiveWebhook(c *gin.Context) {
	integrationType := c.Param("type")
	integrationID := c.Param("integration_id")

	log.Printf("Received webhook: type=%s, integration_id=%s", integrationType, integrationID)

	// Verify integration exists and is active
	integration, err := h.integrationService.GetIntegration(integrationID)
	if err != nil {
		log.Printf("Integration not found: %s, error: %v", integrationID, err)
		c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
		return
	}

	if !integration.IsActive {
		log.Printf("Integration is inactive: %s", integrationID)
		c.JSON(http.StatusForbidden, gin.H{"error": "Integration is inactive"})
		return
	}

	// Verify integration type matches
	if integration.Type != integrationType {
		log.Printf("Integration type mismatch: expected %s, got %s", integration.Type, integrationType)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Integration type mismatch"})
		return
	}

	// Get raw body
	var rawPayload map[string]interface{}
	if err := c.ShouldBindJSON(&rawPayload); err != nil {
		log.Printf("Invalid JSON payload: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	// Update integration heartbeat
	if err := h.integrationService.UpdateHeartbeat(integrationID); err != nil {
		log.Printf("Failed to update heartbeat for integration %s: %v", integrationID, err)
		// Don't fail the webhook for this
	}

	// Process webhook based on type
	var processedAlerts []ProcessedAlert
	switch integrationType {
	case "prometheus":
		processedAlerts = h.processPrometheusWebhook(rawPayload)
	case "datadog":
		processedAlerts = h.processDatadogWebhook(rawPayload)
	case "grafana":
		processedAlerts = h.processGrafanaWebhook(rawPayload)
	case "webhook":
		processedAlerts = h.processGenericWebhook(rawPayload)
	case "aws":
		processedAlerts = h.processAWSWebhook(rawPayload)
	default:
		processedAlerts = h.processGenericWebhook(rawPayload)
	}

	// Log webhook payload for debugging/audit
	webhookPayload := WebhookPayload{
		IntegrationType: integrationType,
		IntegrationID:   integrationID,
		Timestamp:       time.Now(),
		RawPayload:      rawPayload,
		ProcessedAlerts: processedAlerts,
	}
	log.Printf("Webhook payload processed: type=%s, integration=%s, alerts=%d",
		webhookPayload.IntegrationType, webhookPayload.IntegrationID, len(webhookPayload.ProcessedAlerts))

	// Process each alert: handle based on status (firing vs resolved)
	for _, alert := range processedAlerts {
		if err := h.routeAlert(integration, alert); err != nil {
			log.Printf("Failed to process alert %s: %v", alert.AlertName, err)
			// Continue processing other alerts
		}
	}

	// Log webhook for debugging/audit
	log.Printf("Processed webhook: integration=%s, alerts_count=%d", integrationID, len(processedAlerts))

	c.JSON(http.StatusOK, gin.H{
		"message":        "Webhook processed successfully",
		"alerts_count":   len(processedAlerts),
		"integration_id": integrationID,
		"timestamp":      time.Now(),
	})
}

// Process Prometheus AlertManager webhook
func (h *WebhookHandler) processPrometheusWebhook(payload map[string]interface{}) []ProcessedAlert {
	var alerts []ProcessedAlert

	// Prometheus AlertManager sends alerts in "alerts" array
	if alertsData, ok := payload["alerts"].([]interface{}); ok {
		for _, alertData := range alertsData {
			if alertMap, ok := alertData.(map[string]interface{}); ok {
				labels := getMapFromMap(alertMap, "labels")

				// Extract fingerprint for deduplication (fingerprint is a top-level field, not in labels)
				fingerprint := ""
				if fp, ok := alertMap["fingerprint"].(string); ok && fp != "" {
					fingerprint = fp
				} else {
					// Generate fingerprint from key labels if not provided by Prometheus
					alertname := getStringFromMap(alertMap, "labels.alertname", "unknown")
					instance := getStringFromMap(alertMap, "labels.instance", "")
					job := getStringFromMap(alertMap, "labels.job", "")
					fingerprint = fmt.Sprintf("%s-%s-%s", alertname, instance, job)
				}

				alert := ProcessedAlert{
					AlertName:   getStringFromMap(alertMap, "labels.alertname", "unknown"),
					Severity:    getStringFromMap(alertMap, "labels.severity", "warning"),
					Status:      getStringFromMap(alertMap, "status", "firing"),
					Summary:     getStringFromMap(alertMap, "annotations.summary", ""),
					Description: getStringFromMap(alertMap, "annotations.description", ""),
					Labels:      labels,
					Annotations: getMapFromMap(alertMap, "annotations"),
					Fingerprint: fingerprint,
				}

				// Parse timestamps
				if startsAt := getStringFromMap(alertMap, "startsAt", ""); startsAt != "" {
					if t, err := time.Parse(time.RFC3339, startsAt); err == nil {
						alert.StartsAt = t
					}
				}

				if endsAt := getStringFromMap(alertMap, "endsAt", ""); endsAt != "" {
					if t, err := time.Parse(time.RFC3339, endsAt); err == nil {
						alert.EndsAt = &t
					}
				}

				alerts = append(alerts, alert)
			}
		}
	}

	return alerts
}

// Process Datadog webhook
func (h *WebhookHandler) processDatadogWebhook(payload map[string]interface{}) []ProcessedAlert {
	var alerts []ProcessedAlert

	// Datadog webhook structure
	alert := ProcessedAlert{
		AlertName:   getStringFromMap(payload, "alert_name", "datadog-alert"),
		Severity:    mapDatadogSeverity(getStringFromMap(payload, "priority", "normal")),
		Status:      mapDatadogStatus(getStringFromMap(payload, "alert_transition", "triggered")),
		Summary:     getStringFromMap(payload, "body", ""),
		Description: getStringFromMap(payload, "title", ""),
		Labels: map[string]interface{}{
			"source":   "datadog",
			"monitor":  getStringFromMap(payload, "alert_name", ""),
			"priority": getStringFromMap(payload, "priority", ""),
		},
		Annotations: map[string]interface{}{
			"datadog_url": getStringFromMap(payload, "link", ""),
			"org_name":    getStringFromMap(payload, "org_name", ""),
		},
		StartsAt: time.Now(),
	}

	alerts = append(alerts, alert)
	return alerts
}

// Process Grafana webhook
func (h *WebhookHandler) processGrafanaWebhook(payload map[string]interface{}) []ProcessedAlert {
	var alerts []ProcessedAlert

	alert := ProcessedAlert{
		AlertName:   getStringFromMap(payload, "ruleName", "grafana-alert"),
		Severity:    mapGrafanaSeverity(getStringFromMap(payload, "state", "alerting")),
		Status:      mapGrafanaStatus(getStringFromMap(payload, "state", "alerting")),
		Summary:     getStringFromMap(payload, "message", ""),
		Description: getStringFromMap(payload, "title", ""),
		Labels: map[string]interface{}{
			"source":    "grafana",
			"dashboard": getStringFromMap(payload, "dashboardId", ""),
			"panel":     getStringFromMap(payload, "panelId", ""),
		},
		Annotations: map[string]interface{}{
			"grafana_url": getStringFromMap(payload, "ruleUrl", ""),
			"image_url":   getStringFromMap(payload, "imageUrl", ""),
		},
		StartsAt: time.Now(),
	}

	alerts = append(alerts, alert)
	return alerts
}

// Process AWS CloudWatch webhook
func (h *WebhookHandler) processAWSWebhook(payload map[string]interface{}) []ProcessedAlert {
	var alerts []ProcessedAlert

	// AWS SNS message structure
	message := getStringFromMap(payload, "Message", "")
	if message != "" {
		var awsMessage map[string]interface{}
		if err := json.Unmarshal([]byte(message), &awsMessage); err == nil {
			payload = awsMessage
		}
	}

	alert := ProcessedAlert{
		AlertName:   getStringFromMap(payload, "AlarmName", "aws-alarm"),
		Severity:    mapAWSSeverity(getStringFromMap(payload, "NewStateValue", "ALARM")),
		Status:      mapAWSStatus(getStringFromMap(payload, "NewStateValue", "ALARM")),
		Summary:     getStringFromMap(payload, "AlarmDescription", ""),
		Description: getStringFromMap(payload, "NewStateReason", ""),
		Labels: map[string]interface{}{
			"source":    "aws",
			"region":    getStringFromMap(payload, "Region", ""),
			"namespace": getStringFromMap(payload, "Trigger.Namespace", ""),
		},
		Annotations: map[string]interface{}{
			"account_id": getStringFromMap(payload, "AWSAccountId", ""),
			"timestamp":  getStringFromMap(payload, "StateChangeTime", ""),
		},
		StartsAt: time.Now(),
	}

	alerts = append(alerts, alert)
	return alerts
}

// Process generic webhook
func (h *WebhookHandler) processGenericWebhook(payload map[string]interface{}) []ProcessedAlert {
	var alerts []ProcessedAlert

	alert := ProcessedAlert{
		AlertName:   getStringFromMap(payload, "alert_name", "generic-alert"),
		Severity:    getStringFromMap(payload, "severity", "warning"),
		Status:      getStringFromMap(payload, "status", "firing"),
		Summary:     getStringFromMap(payload, "summary", ""),
		Description: getStringFromMap(payload, "description", ""),
		Labels:      getMapFromMap(payload, "labels"),
		Annotations: getMapFromMap(payload, "annotations"),
		StartsAt:    time.Now(),
	}

	alerts = append(alerts, alert)
	return alerts
}

// Route alert: handle based on status (firing vs resolved)
func (h *WebhookHandler) routeAlert(integration db.Integration, alert ProcessedAlert) error {
	log.Printf("DEBUG: Routing alert %s with status %s", alert.AlertName, alert.Status)

	switch alert.Status {
	case "firing":
		return h.routeAlertToCreateIncident(integration, alert)
	case "resolved":
		return h.routeAlertToResolveIncident(integration, alert)
	default:
		log.Printf("WARNING: Unknown alert status %s, treating as firing", alert.Status)
		return h.routeAlertToCreateIncident(integration, alert)
	}
}

// Route alert: atomic incident creation with full service resolution
func (h *WebhookHandler) routeAlertToCreateIncident(integration db.Integration, alert ProcessedAlert) error {
	log.Printf("DEBUG: Starting atomic incident creation for integration %s", integration.ID)

	// Step 1: Resolve service and assignment BEFORE creating incident
	serviceInfo, assigneeInfo, err := h.resolveServiceAndAssignee(integration, alert)
	if err != nil {
		log.Printf("DEBUG: Failed to resolve service/assignee: %v", err)
		// Continue with incident creation even if service resolution fails
	}

	// Step 2: Create incident atomically with all resolved information
	incident, err := h.createIncidentAtomic(integration, alert, serviceInfo, assigneeInfo)
	if err != nil {
		log.Printf("ERROR: Failed to create incident atomically: %v", err)
		return fmt.Errorf("failed to create incident: %w", err)
	}

	log.Printf("SUCCESS: Created incident %s with ServiceID=%s, AssignedTo=%s",
		incident.ID, incident.ServiceID, incident.AssignedTo)

	return nil
}

// Route alert: resolve existing incident based on alert fingerprint/labels
func (h *WebhookHandler) routeAlertToResolveIncident(integration db.Integration, alert ProcessedAlert) error {
	log.Printf("DEBUG: Attempting to resolve incident for alert %s", alert.AlertName)

	// Find existing incident based on alert fingerprint or labels
	incident, err := h.findIncidentByAlert(integration, alert)
	if err != nil {
		log.Printf("ERROR: Failed to find incident for resolved alert %s: %v", alert.AlertName, err)
		return fmt.Errorf("failed to find incident: %w", err)
	}

	if incident == nil {
		log.Printf("WARNING: No incident found for resolved alert %s, skipping resolution", alert.AlertName)
		return nil
	}

	// Resolve the incident using IncidentService (triggers notifications)
	note := "Alert resolved automatically"
	resolution := fmt.Sprintf("Automatically resolved by %s alert resolution", alert.AlertName)
	if alert.Description != "" {
		resolution = fmt.Sprintf("%s: %s", resolution, alert.Description)
	}

	// Use appropriate system user based on integration type
	systemUserID := db.GetSystemUserBySource(integration.Type)
	err = h.incidentService.ResolveIncident(incident.ID, systemUserID, note, resolution)
	if err != nil {
		log.Printf("ERROR: Failed to resolve incident %s: %v", incident.ID, err)
		return fmt.Errorf("failed to resolve incident: %w", err)
	}

	log.Printf("SUCCESS: Resolved incident %s for alert %s", incident.ID, alert.AlertName)
	return nil
}

// Find existing incident based on alert labels/fingerprint
func (h *WebhookHandler) findIncidentByAlert(integration db.Integration, alert ProcessedAlert) (*db.Incident, error) {
	log.Printf("DEBUG: Finding incident for alert %s", alert.AlertName)

	// Strategy 1: Find by alert fingerprint (if available)
	if alert.Fingerprint != "" {
		incident, err := h.findIncidentByFingerprint(alert.Fingerprint)
		if err == nil && incident != nil {
			log.Printf("DEBUG: Found incident %s by fingerprint %s", incident.ID, alert.Fingerprint)
			return incident, nil
		}
	}

	// Strategy 2: Find by alert labels (alertname + instance + job)
	alertname := alert.AlertName
	instance, _ := alert.Labels["instance"].(string)
	job, _ := alert.Labels["job"].(string)

	if alertname != "" && instance != "" {
		incident, err := h.findIncidentByLabels(alertname, instance, job)
		if err == nil && incident != nil {
			log.Printf("DEBUG: Found incident %s by labels (alertname=%s, instance=%s, job=%s)",
				incident.ID, alertname, instance, job)
			return incident, nil
		}
	}

	// Strategy 3: Find by title match (last resort)
	if alertname != "" {
		incident, err := h.findIncidentByTitle(alertname)
		if err == nil && incident != nil {
			log.Printf("DEBUG: Found incident %s by title match %s", incident.ID, alertname)
			return incident, nil
		}
	}

	log.Printf("DEBUG: No incident found for alert %s", alert.AlertName)
	return nil, nil
}

// Find incident by fingerprint
func (h *WebhookHandler) findIncidentByFingerprint(fingerprint string) (*db.Incident, error) {
	log.Printf("DEBUG: Searching for incident with fingerprint: %s", fingerprint)

	// Use direct database query for fingerprint search (more efficient)
	incident, err := h.findIncidentByFingerprintDirect(fingerprint)
	if err != nil {
		log.Printf("ERROR: Failed to search incident by fingerprint: %v", err)
		return nil, err
	}

	if incident != nil {
		log.Printf("DEBUG: Found incident %s with fingerprint %s", incident.ID, fingerprint)
		return incident, nil
	}

	log.Printf("DEBUG: No incident found with fingerprint %s", fingerprint)
	return nil, nil
}

// Direct database query for fingerprint search
func (h *WebhookHandler) findIncidentByFingerprintDirect(fingerprint string) (*db.Incident, error) {
	// Get database connection from incident service
	// We'll need to add a method to access the database
	return h.incidentService.FindIncidentByFingerprint(fingerprint)
}

// Find incident by alert labels
func (h *WebhookHandler) findIncidentByLabels(alertname, instance, job string) (*db.Incident, error) {
	// Search for incidents with matching alert labels
	filters := map[string]interface{}{
		"status": "triggered,acknowledged",
		"limit":  50,
	}

	incidents, err := h.incidentService.ListIncidents(filters)
	if err != nil {
		return nil, err
	}

	// Filter by alert labels
	for _, incident := range incidents {
		if incident.Labels != nil {
			alertnameMatch := false
			instanceMatch := false
			jobMatch := job == "" // If job is empty, consider it a match

			if an, ok := incident.Labels["alertname"].(string); ok && an == alertname {
				alertnameMatch = true
			}
			if inst, ok := incident.Labels["instance"].(string); ok && inst == instance {
				instanceMatch = true
			}
			if job != "" {
				if j, ok := incident.Labels["job"].(string); ok && j == job {
					jobMatch = true
				}
			}

			if alertnameMatch && instanceMatch && jobMatch {
				return h.convertToIncident(&incident), nil
			}
		}
	}

	return nil, nil
}

// Find incident by title (last resort)
func (h *WebhookHandler) findIncidentByTitle(alertname string) (*db.Incident, error) {
	// Search for incidents with matching title
	filters := map[string]interface{}{
		"search": alertname,
		"status": "triggered,acknowledged",
		"limit":  10,
	}

	incidents, err := h.incidentService.ListIncidents(filters)
	if err != nil {
		return nil, err
	}

	// Find exact title match
	for _, incident := range incidents {
		if incident.Title == alertname {
			return h.convertToIncident(&incident), nil
		}
	}

	return nil, nil
}

// Convert IncidentResponse to Incident
func (h *WebhookHandler) convertToIncident(resp *db.IncidentResponse) *db.Incident {
	incident := &db.Incident{
		ID:                     resp.ID,
		Title:                  resp.Title,
		Description:            resp.Description,
		Status:                 resp.Status,
		Urgency:                resp.Urgency,
		Priority:               resp.Priority,
		CreatedAt:              resp.CreatedAt,
		UpdatedAt:              resp.UpdatedAt,
		AssignedTo:             resp.AssignedTo,
		AssignedAt:             resp.AssignedAt,
		AcknowledgedBy:         resp.AcknowledgedBy,
		AcknowledgedAt:         resp.AcknowledgedAt,
		ResolvedBy:             resp.ResolvedBy,
		ResolvedAt:             resp.ResolvedAt,
		Source:                 resp.Source,
		IntegrationID:          resp.IntegrationID,
		ServiceID:              resp.ServiceID,
		ExternalID:             resp.ExternalID,
		ExternalURL:            resp.ExternalURL,
		EscalationPolicyID:     resp.EscalationPolicyID,
		CurrentEscalationLevel: resp.CurrentEscalationLevel,
		LastEscalatedAt:        resp.LastEscalatedAt,
		EscalationStatus:       resp.EscalationStatus,
		GroupID:                resp.GroupID,
		APIKeyID:               resp.APIKeyID,
		Severity:               resp.Severity,
		IncidentKey:            resp.IncidentKey,
		AlertCount:             resp.AlertCount,
		Labels:                 resp.Labels,
		CustomFields:           resp.CustomFields,
	}

	return incident
}

// resolveServiceAndAssignee resolves service and assignee information before incident creation
func (h *WebhookHandler) resolveServiceAndAssignee(integration db.Integration, alert ProcessedAlert) (*ResolvedServiceInfo, *ResolvedAssigneeInfo, error) {
	log.Printf("DEBUG: Resolving service and assignee for integration %s", integration.ID)

	serviceInfo := &ResolvedServiceInfo{Found: false}
	assigneeInfo := &ResolvedAssigneeInfo{Found: false}

	// Step 1: Get services connected to this integration
	serviceIntegrations, err := h.integrationService.GetIntegrationServices(integration.ID)
	if err != nil {
		log.Printf("DEBUG: Error getting services for integration %s: %v", integration.ID, err)
		return serviceInfo, assigneeInfo, fmt.Errorf("failed to get services: %w", err)
	}

	log.Printf("DEBUG: Found %d service integrations for integration %s", len(serviceIntegrations), integration.ID)

	if len(serviceIntegrations) == 0 {
		log.Printf("DEBUG: No services configured for integration %s", integration.ID)
		return serviceInfo, assigneeInfo, nil
	}

	// Step 2: Find matching service based on routing conditions
	for i, serviceIntegration := range serviceIntegrations {
		log.Printf("DEBUG: Checking service integration %d: ServiceID=%s", i+1, serviceIntegration.ServiceID)

		matches := h.matchesRoutingConditions(alert, serviceIntegration.RoutingConditions)
		log.Printf("DEBUG: Routing conditions match result: %t", matches)

		if matches {
			log.Printf("DEBUG: Found matching service %s", serviceIntegration.ServiceID)

			// Get service details
			service, err := h.serviceService.GetService(serviceIntegration.ServiceID)
			if err != nil {
				log.Printf("DEBUG: Failed to get service details for %s: %v", serviceIntegration.ServiceID, err)
				continue
			}

			serviceInfo.Service = &service
			serviceInfo.ServiceIntegration = &serviceIntegration
			serviceInfo.Found = true

			log.Printf("DEBUG: Service details - ID: %s, Name: %s, EscalationPolicyID: %s, GroupID: %s",
				service.ID, service.Name, service.EscalationPolicyID, service.GroupID)

			// Step 3: Resolve assignee if service has escalation policy
			if service.EscalationPolicyID != "" && service.GroupID != "" {
				log.Printf("DEBUG: Resolving assignee with escalation policy %s and group %s",
					service.EscalationPolicyID, service.GroupID)

				assigneeID, err := h.incidentService.GetAssigneeFromEscalationPolicy(service.EscalationPolicyID, service.GroupID)
				if err != nil {
					log.Printf("DEBUG: Failed to resolve assignee: %v", err)
				} else if assigneeID != "" {
					assigneeInfo.UserID = assigneeID
					assigneeInfo.Found = true
					assigneeInfo.Method = "escalation_policy"
					log.Printf("DEBUG: Resolved assignee: %s via escalation policy", assigneeID)
				} else {
					log.Printf("DEBUG: No assignee found via escalation policy")
				}
			} else {
				log.Printf("DEBUG: Cannot resolve assignee - missing escalation policy or group")
			}

			// Use first matching service
			break
		}
	}

	if !serviceInfo.Found {
		log.Printf("DEBUG: No matching service found for alert")
	}

	return serviceInfo, assigneeInfo, nil
}

// createIncidentAtomic creates incident with all resolved information in a single transaction
func (h *WebhookHandler) createIncidentAtomic(integration db.Integration, alert ProcessedAlert, serviceInfo *ResolvedServiceInfo, assigneeInfo *ResolvedAssigneeInfo) (*db.Incident, error) {
	log.Printf("DEBUG: Creating incident atomically")

	// Build incident with all resolved information
	incident := &db.Incident{
		Title:       alert.AlertName,
		Description: alert.Description,
		Severity:    alert.Severity,
		Status:      db.IncidentStatusTriggered,
		Source:      "webhook",
		Urgency:     db.IncidentUrgencyHigh, // Default to high for webhook incidents
	}

	// Add alert metadata
	if alert.Summary != "" && alert.Summary != alert.Description {
		incident.Title = alert.Summary
		if incident.Description == "" {
			incident.Description = alert.AlertName
		}
	}

	// Set urgency based on severity
	if alert.Severity == "info" || alert.Severity == "warning" {
		incident.Urgency = db.IncidentUrgencyLow
	}

	// Add labels from alert
	if alert.Labels != nil {
		incident.Labels = alert.Labels
	} else {
		incident.Labels = make(map[string]interface{})
	}

	// Always add fingerprint to labels for deduplication
	if alert.Fingerprint != "" {
		incident.Labels["fingerprint"] = alert.Fingerprint
		log.Printf("DEBUG: Added fingerprint to incident labels: %s", alert.Fingerprint)
	}

	// Add service information if resolved
	if serviceInfo.Found && serviceInfo.Service != nil {
		incident.ServiceID = serviceInfo.Service.ID
		incident.EscalationPolicyID = serviceInfo.Service.EscalationPolicyID
		incident.GroupID = serviceInfo.Service.GroupID
		log.Printf("DEBUG: Adding service info - ServiceID: %s, EscalationPolicyID: %s, GroupID: %s",
			incident.ServiceID, incident.EscalationPolicyID, incident.GroupID)
	}

	// Add assignment information if resolved
	if assigneeInfo.Found && assigneeInfo.UserID != "" {
		incident.AssignedTo = assigneeInfo.UserID
		now := time.Now().UTC()
		incident.AssignedAt = &now
		log.Printf("DEBUG: Adding assignment - AssignedTo: %s, Method: %s",
			incident.AssignedTo, assigneeInfo.Method)
	}

	log.Printf("DEBUG: Final incident before creation - Title: %s, ServiceID: %s, AssignedTo: %s",
		incident.Title, incident.ServiceID, incident.AssignedTo)

	// Create incident atomically using the incident service
	createdIncident, err := h.incidentService.CreateIncident(incident)
	if err != nil {
		return nil, fmt.Errorf("failed to create incident: %w", err)
	}

	// Log success with all details
	log.Printf("SUCCESS: Created incident %s - ServiceID: %s, EscalationPolicyID: %s, GroupID: %s, AssignedTo: %s",
		createdIncident.ID, createdIncident.ServiceID, createdIncident.EscalationPolicyID,
		createdIncident.GroupID, createdIncident.AssignedTo)

	return createdIncident, nil
}

// Legacy functions removed - replaced by atomic transaction approach

// Check if alert matches routing conditions
func (h *WebhookHandler) matchesRoutingConditions(alert ProcessedAlert, conditions map[string]interface{}) bool {
	if len(conditions) == 0 {
		return true // No conditions = match all
	}

	// Check severity condition
	if severities, ok := conditions["severity"].([]interface{}); ok {
		matched := false
		for _, sev := range severities {
			if sevStr, ok := sev.(string); ok && sevStr == alert.Severity {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// Check alertname condition
	if alertnames, ok := conditions["alertname"].([]interface{}); ok {
		matched := false
		for _, name := range alertnames {
			if nameStr, ok := name.(string); ok {
				if nameStr == "*" || nameStr == alert.AlertName {
					matched = true
					break
				}
			}
		}
		if !matched {
			return false
		}
	}

	// Check label conditions
	if labelConditions, ok := conditions["labels"].(map[string]interface{}); ok {
		for key, expectedValue := range labelConditions {
			if actualValue, exists := alert.Labels[key]; !exists || actualValue != expectedValue {
				return false
			}
		}
	}

	return true
}

// Utility functions
func getStringFromMap(m map[string]interface{}, path string, defaultValue string) string {
	keys := strings.Split(path, ".")
	current := m

	for i, key := range keys {
		if i == len(keys)-1 {
			if val, ok := current[key]; ok {
				if str, ok := val.(string); ok {
					return str
				}
			}
		} else {
			if next, ok := current[key].(map[string]interface{}); ok {
				current = next
			} else {
				break
			}
		}
	}

	return defaultValue
}

func getMapFromMap(m map[string]interface{}, key string) map[string]interface{} {
	if val, ok := m[key].(map[string]interface{}); ok {
		return val
	}
	return make(map[string]interface{})
}

// Severity mapping functions
func mapDatadogSeverity(priority string) string {
	switch strings.ToLower(priority) {
	case "p1", "critical":
		return "critical"
	case "p2", "high":
		return "high"
	case "p3", "normal":
		return "warning"
	case "p4", "low":
		return "info"
	default:
		return "warning"
	}
}

func mapDatadogStatus(transition string) string {
	switch strings.ToLower(transition) {
	case "triggered", "alerting":
		return "firing"
	case "recovered", "ok":
		return "resolved"
	default:
		return "firing"
	}
}

func mapGrafanaSeverity(state string) string {
	switch strings.ToLower(state) {
	case "alerting":
		return "critical"
	case "pending":
		return "warning"
	case "ok":
		return "info"
	default:
		return "warning"
	}
}

func mapGrafanaStatus(state string) string {
	switch strings.ToLower(state) {
	case "alerting", "pending":
		return "firing"
	case "ok":
		return "resolved"
	default:
		return "firing"
	}
}

func mapAWSSeverity(state string) string {
	switch strings.ToUpper(state) {
	case "ALARM":
		return "critical"
	case "INSUFFICIENT_DATA":
		return "warning"
	case "OK":
		return "info"
	default:
		return "warning"
	}
}

func mapAWSStatus(state string) string {
	switch strings.ToUpper(state) {
	case "ALARM":
		return "firing"
	case "OK":
		return "resolved"
	default:
		return "firing"
	}
}
