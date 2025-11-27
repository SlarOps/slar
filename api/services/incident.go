package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type IncidentService struct {
	PG                 *sql.DB
	Redis              *redis.Client
	FCMService         *FCMService
	NotificationWorker NotificationSender // Interface for sending notifications
}

// NotificationSender interface for sending incident notifications
type NotificationSender interface {
	SendIncidentAssignedNotification(userID, incidentID string) error
	SendIncidentEscalatedNotification(userID, incidentID string) error
	SendIncidentAcknowledgedNotification(userID, incidentID string) error
	SendIncidentResolvedNotification(userID, incidentID string) error
}

func NewIncidentService(pg *sql.DB, redis *redis.Client, fcmService *FCMService) *IncidentService {
	return &IncidentService{
		PG:         pg,
		Redis:      redis,
		FCMService: fcmService,
	}
}

// SetNotificationWorker sets the notification worker for sending incident notifications
func (s *IncidentService) SetNotificationWorker(notificationWorker NotificationSender) {
	s.NotificationWorker = notificationWorker
}

// LightweightNotificationSender implements NotificationSender for API server
// It only sends messages to PGMQ queue without processing them
type LightweightNotificationSender struct {
	PG *sql.DB
}

// NewLightweightNotificationSender creates a new lightweight notification sender
func NewLightweightNotificationSender(pg *sql.DB) *LightweightNotificationSender {
	return &LightweightNotificationSender{PG: pg}
}

// SendIncidentAssignedNotification sends incident assignment notification to queue
func (l *LightweightNotificationSender) SendIncidentAssignedNotification(userID, incidentID string) error {
	notification := map[string]interface{}{
		"type":        "assigned",
		"user_id":     userID,
		"incident_id": incidentID,
		"channels":    []string{"slack", "push"},
		"priority":    "high",
		"created_at":  time.Now(),
		"retry_count": 0,
	}

	notificationJSON, err := json.Marshal(notification)
	if err != nil {
		return fmt.Errorf("failed to marshal notification: %w", err)
	}

	_, err = l.PG.Exec(`SELECT pgmq.send($1, $2)`, "incident_notifications", string(notificationJSON))
	if err != nil {
		return fmt.Errorf("failed to send notification to queue: %w", err)
	}

	return nil
}

// SendIncidentEscalatedNotification sends incident escalation notification to queue
func (l *LightweightNotificationSender) SendIncidentEscalatedNotification(userID, incidentID string) error {
	notification := map[string]interface{}{
		"type":        "escalated",
		"user_id":     userID,
		"incident_id": incidentID,
		"channels":    []string{"slack", "push"},
		"priority":    "high",
		"created_at":  time.Now(),
		"retry_count": 0,
	}

	notificationJSON, err := json.Marshal(notification)
	if err != nil {
		return fmt.Errorf("failed to marshal notification: %w", err)
	}

	_, err = l.PG.Exec(`SELECT pgmq.send($1, $2)`, "incident_notifications", string(notificationJSON))
	if err != nil {
		return fmt.Errorf("failed to send notification to queue: %w", err)
	}

	return nil
}

// SendIncidentAcknowledgedNotification sends incident acknowledged notification to queue
func (l *LightweightNotificationSender) SendIncidentAcknowledgedNotification(userID, incidentID string) error {
	notification := map[string]interface{}{
		"type":        "acknowledged",
		"user_id":     userID,
		"incident_id": incidentID,
		"channels":    []string{"slack"},
		"priority":    "medium",
		"created_at":  time.Now(),
		"retry_count": 0,
	}

	notificationJSON, err := json.Marshal(notification)
	if err != nil {
		return fmt.Errorf("failed to marshal notification: %w", err)
	}

	_, err = l.PG.Exec(`SELECT pgmq.send($1, $2)`, "incident_notifications", string(notificationJSON))
	if err != nil {
		return fmt.Errorf("failed to send notification to queue: %w", err)
	}

	return nil
}

// SendIncidentResolvedNotification sends incident resolved notification to queue
func (l *LightweightNotificationSender) SendIncidentResolvedNotification(userID, incidentID string) error {
	notification := map[string]interface{}{
		"type":        "resolved",
		"user_id":     userID,
		"incident_id": incidentID,
		"channels":    []string{"slack"},
		"priority":    "medium",
		"created_at":  time.Now(),
		"retry_count": 0,
	}

	notificationJSON, err := json.Marshal(notification)
	if err != nil {
		return fmt.Errorf("failed to marshal notification: %w", err)
	}

	_, err = l.PG.Exec(`SELECT pgmq.send($1, $2)`, "incident_notifications", string(notificationJSON))
	if err != nil {
		return fmt.Errorf("failed to send notification to queue: %w", err)
	}

	return nil
}

// ListIncidents returns a paginated list of incidents with filters
func (s *IncidentService) ListIncidents(filters map[string]interface{}) ([]db.IncidentResponse, error) {
	query := `
		SELECT 
			i.id, i.title, i.description, i.status, i.urgency, i.priority,
			i.created_at, i.updated_at, i.assigned_to, i.assigned_at,
			i.acknowledged_by, i.acknowledged_at, i.resolved_by, i.resolved_at,
			i.source, i.integration_id, i.service_id, i.external_id, i.external_url,
			i.escalation_policy_id, i.current_escalation_level, i.last_escalated_at, 
			i.escalation_status, i.group_id, i.api_key_id, i.severity, i.incident_key, 
			i.alert_count, i.labels, i.custom_fields,
			u_assigned.name as assigned_to_name, u_assigned.email as assigned_to_email,
			u_acked.name as acknowledged_by_name, u_acked.email as acknowledged_by_email,
			u_resolved.name as resolved_by_name, u_resolved.email as resolved_by_email,
			g.name as group_name, s.name as service_name,
			ep.name as escalation_policy_name
		FROM incidents i
		LEFT JOIN users u_assigned ON i.assigned_to = u_assigned.id
		LEFT JOIN users u_acked ON i.acknowledged_by = u_acked.id
		LEFT JOIN users u_resolved ON i.resolved_by = u_resolved.id
		LEFT JOIN groups g ON i.group_id = g.id
		LEFT JOIN services s ON i.service_id = s.id
		LEFT JOIN escalation_policies ep ON i.escalation_policy_id = ep.id
		WHERE 1=1
	`

	args := []interface{}{}
	argIndex := 1
	hasSearch := false
	searchArgIndex := 0

	// Apply filters
	if search, ok := filters["search"].(string); ok && search != "" {
		hasSearch = true
		searchArgIndex = argIndex
		// Use full-text search if search_vector exists, fallback to ILIKE
		query += fmt.Sprintf(" AND (i.search_vector @@ plainto_tsquery('english', $%d) OR i.title ILIKE $%d OR i.description ILIKE $%d)", argIndex, argIndex+1, argIndex+2)
		searchPattern := "%" + search + "%"
		args = append(args, search, searchPattern, searchPattern)
		argIndex += 3
	}

	if status, ok := filters["status"].(string); ok && status != "" {
		query += fmt.Sprintf(" AND i.status = $%d", argIndex)
		args = append(args, status)
		argIndex++
	}

	if urgency, ok := filters["urgency"].(string); ok && urgency != "" {
		query += fmt.Sprintf(" AND i.urgency = $%d", argIndex)
		args = append(args, urgency)
		argIndex++
	}

	if severity, ok := filters["severity"].(string); ok && severity != "" {
		query += fmt.Sprintf(" AND i.severity = $%d", argIndex)
		args = append(args, severity)
		argIndex++
	}

	if assignedTo, ok := filters["assigned_to"].(string); ok && assignedTo != "" {
		if assignedTo == "unassigned" {
			query += " AND i.assigned_to IS NULL"
		} else {
			query += fmt.Sprintf(" AND i.assigned_to = $%d::uuid", argIndex)
			args = append(args, assignedTo)
			argIndex++
		}
	}

	if serviceID, ok := filters["service_id"].(string); ok && serviceID != "" {
		query += fmt.Sprintf(" AND i.service_id = $%d", argIndex)
		args = append(args, serviceID)
		argIndex++
	}

	if groupID, ok := filters["group_id"].(string); ok && groupID != "" {
		query += fmt.Sprintf(" AND i.group_id = $%d", argIndex)
		args = append(args, groupID)
		argIndex++
	}

	// Time range filter
	if timeRange, ok := filters["time_range"].(string); ok && timeRange != "" && timeRange != "all" {
		switch timeRange {
		case "last_24_hours":
			query += " AND i.created_at >= NOW() - INTERVAL '24 hours'"
		case "last_7_days":
			query += " AND i.created_at >= NOW() - INTERVAL '7 days'"
		case "last_30_days":
			query += " AND i.created_at >= NOW() - INTERVAL '30 days'"
		case "last_90_days":
			query += " AND i.created_at >= NOW() - INTERVAL '90 days'"
		}
	}

	// Sorting
	sortBy := "i.created_at DESC"

	// If search is used, prioritize by search ranking
	if hasSearch {
		sortBy = fmt.Sprintf("ts_rank(i.search_vector, plainto_tsquery('english', $%d)) DESC, i.created_at DESC", searchArgIndex)
	}

	// Allow manual sort override
	if sort, ok := filters["sort"].(string); ok && sort != "" {
		switch sort {
		case "created_at_desc":
			sortBy = "i.created_at DESC"
		case "created_at_asc":
			sortBy = "i.created_at ASC"
		case "updated_at_desc":
			sortBy = "i.updated_at DESC"
		case "urgency_desc":
			sortBy = "CASE WHEN i.urgency = 'high' THEN 1 ELSE 2 END, i.created_at DESC"
		case "status_asc":
			sortBy = "CASE WHEN i.status = 'triggered' THEN 1 WHEN i.status = 'acknowledged' THEN 2 ELSE 3 END, i.created_at DESC"
		case "relevance":
			if hasSearch {
				sortBy = fmt.Sprintf("ts_rank(i.search_vector, plainto_tsquery('english', $%d)) DESC, i.created_at DESC", searchArgIndex)
			}
		}
	}
	query += " ORDER BY " + sortBy

	// Pagination
	limit := 20
	if l, ok := filters["limit"].(int); ok && l > 0 && l <= 100 {
		limit = l
	}
	offset := 0
	if page, ok := filters["page"].(int); ok && page > 1 {
		offset = (page - 1) * limit
	}

	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, limit, offset)

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		log.Println("Error getting incidents:", err)
		return nil, fmt.Errorf("failed to query incidents: %w", err)
	}
	defer rows.Close()

	var incidents []db.IncidentResponse
	for rows.Next() {
		var incident db.IncidentResponse
		var assignedTo, assignedToName, assignedToEmail sql.NullString
		var assignedAt sql.NullTime
		var acknowledgedBy, acknowledgedByName, acknowledgedByEmail sql.NullString
		var acknowledgedAt sql.NullTime
		var resolvedBy, resolvedByName, resolvedByEmail sql.NullString
		var resolvedAt sql.NullTime
		var integrationID, serviceID, externalID, externalURL sql.NullString
		var escalationPolicyID, escalationPolicyName sql.NullString
		var lastEscalatedAt sql.NullTime
		var groupID, groupName, serviceName sql.NullString
		var apiKeyID, incidentKey sql.NullString
		var labels, customFields sql.NullString

		err := rows.Scan(
			&incident.ID, &incident.Title, &incident.Description, &incident.Status, &incident.Urgency, &incident.Priority,
			&incident.CreatedAt, &incident.UpdatedAt, &assignedTo, &assignedAt,
			&acknowledgedBy, &acknowledgedAt, &resolvedBy, &resolvedAt,
			&incident.Source, &integrationID, &serviceID, &externalID, &externalURL,
			&escalationPolicyID, &incident.CurrentEscalationLevel, &lastEscalatedAt,
			&incident.EscalationStatus, &groupID, &apiKeyID, &incident.Severity, &incidentKey,
			&incident.AlertCount, &labels, &customFields,
			&assignedToName, &assignedToEmail,
			&acknowledgedByName, &acknowledgedByEmail,
			&resolvedByName, &resolvedByEmail,
			&groupName, &serviceName, &escalationPolicyName,
		)
		if err != nil {
			continue
		}

		// Handle nullable fields
		if assignedTo.Valid {
			incident.AssignedTo = assignedTo.String
		}
		if assignedToName.Valid {
			incident.AssignedToName = assignedToName.String
		}
		if assignedToEmail.Valid {
			incident.AssignedToEmail = assignedToEmail.String
		}
		if assignedAt.Valid {
			incident.AssignedAt = &assignedAt.Time
		}
		if acknowledgedBy.Valid {
			incident.AcknowledgedBy = acknowledgedBy.String
		}
		if acknowledgedByName.Valid {
			incident.AcknowledgedByName = acknowledgedByName.String
		}
		if acknowledgedByEmail.Valid {
			incident.AcknowledgedByEmail = acknowledgedByEmail.String
		}
		if acknowledgedAt.Valid {
			incident.AcknowledgedAt = &acknowledgedAt.Time
		}
		if resolvedBy.Valid {
			incident.ResolvedBy = resolvedBy.String
		}
		if resolvedByName.Valid {
			incident.ResolvedByName = resolvedByName.String
		}
		if resolvedByEmail.Valid {
			incident.ResolvedByEmail = resolvedByEmail.String
		}
		if resolvedAt.Valid {
			incident.ResolvedAt = &resolvedAt.Time
		}
		if integrationID.Valid {
			incident.IntegrationID = integrationID.String
		}
		if serviceID.Valid {
			incident.ServiceID = serviceID.String
		}
		if serviceName.Valid {
			incident.ServiceName = serviceName.String
		}
		if externalID.Valid {
			incident.ExternalID = externalID.String
		}
		if externalURL.Valid {
			incident.ExternalURL = externalURL.String
		}
		if escalationPolicyID.Valid {
			incident.EscalationPolicyID = escalationPolicyID.String
		}
		if escalationPolicyName.Valid {
			incident.EscalationPolicyName = escalationPolicyName.String
		}
		if lastEscalatedAt.Valid {
			incident.LastEscalatedAt = &lastEscalatedAt.Time
		}
		if groupID.Valid {
			incident.GroupID = groupID.String
		}
		if groupName.Valid {
			incident.GroupName = groupName.String
		}
		if apiKeyID.Valid {
			incident.APIKeyID = apiKeyID.String
		}
		if incidentKey.Valid {
			incident.IncidentKey = incidentKey.String
		}

		// Parse JSON fields
		if labels.Valid && labels.String != "" {
			json.Unmarshal([]byte(labels.String), &incident.Labels)
		}
		if customFields.Valid && customFields.String != "" {
			json.Unmarshal([]byte(customFields.String), &incident.CustomFields)
		}

		incidents = append(incidents, incident)
	}

	return incidents, nil
}

// GetIncident returns a single incident with full details
func (s *IncidentService) GetIncident(id string) (*db.IncidentResponse, error) {
	query := `
		SELECT 
			i.id, i.title, i.description, i.status, i.urgency, i.priority,
			i.created_at, i.updated_at, i.assigned_to, i.assigned_at,
			i.acknowledged_by, i.acknowledged_at, i.resolved_by, i.resolved_at,
			i.source, i.integration_id, i.service_id, i.external_id, i.external_url,
			i.escalation_policy_id, i.current_escalation_level, i.last_escalated_at, 
			i.escalation_status, i.group_id, i.api_key_id, i.severity, i.incident_key, 
			i.alert_count, i.labels, i.custom_fields,
			u_assigned.name as assigned_to_name, u_assigned.email as assigned_to_email,
			u_acked.name as acknowledged_by_name, u_acked.email as acknowledged_by_email,
			u_resolved.name as resolved_by_name, u_resolved.email as resolved_by_email,
			g.name as group_name, s.name as service_name,
			ep.name as escalation_policy_name
		FROM incidents i
		LEFT JOIN users u_assigned ON i.assigned_to = u_assigned.id
		LEFT JOIN users u_acked ON i.acknowledged_by = u_acked.id
		LEFT JOIN users u_resolved ON i.resolved_by = u_resolved.id
		LEFT JOIN groups g ON i.group_id = g.id
		LEFT JOIN services s ON i.service_id = s.id
		LEFT JOIN escalation_policies ep ON i.escalation_policy_id = ep.id
		WHERE i.id = $1
	`

	var incident db.IncidentResponse
	var assignedTo, assignedToName, assignedToEmail sql.NullString
	var assignedAt sql.NullTime
	var acknowledgedBy, acknowledgedByName, acknowledgedByEmail sql.NullString
	var acknowledgedAt sql.NullTime
	var resolvedBy, resolvedByName, resolvedByEmail sql.NullString
	var resolvedAt sql.NullTime
	var integrationID, serviceID, externalID, externalURL sql.NullString
	var escalationPolicyID, escalationPolicyName sql.NullString
	var lastEscalatedAt sql.NullTime
	var groupID, groupName, serviceName sql.NullString
	var apiKeyID, incidentKey sql.NullString
	var labels, customFields sql.NullString

	err := s.PG.QueryRow(query, id).Scan(
		&incident.ID, &incident.Title, &incident.Description, &incident.Status, &incident.Urgency, &incident.Priority,
		&incident.CreatedAt, &incident.UpdatedAt, &assignedTo, &assignedAt,
		&acknowledgedBy, &acknowledgedAt, &resolvedBy, &resolvedAt,
		&incident.Source, &integrationID, &serviceID, &externalID, &externalURL,
		&escalationPolicyID, &incident.CurrentEscalationLevel, &lastEscalatedAt,
		&incident.EscalationStatus, &groupID, &apiKeyID, &incident.Severity, &incidentKey,
		&incident.AlertCount, &labels, &customFields,
		&assignedToName, &assignedToEmail,
		&acknowledgedByName, &acknowledgedByEmail,
		&resolvedByName, &resolvedByEmail,
		&groupName, &serviceName, &escalationPolicyName,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("incident not found")
		}
		return nil, fmt.Errorf("failed to get incident: %w", err)
	}

	// Handle nullable fields
	if assignedTo.Valid {
		incident.AssignedTo = assignedTo.String
	}
	if assignedToName.Valid {
		incident.AssignedToName = assignedToName.String
	}
	if assignedToEmail.Valid {
		incident.AssignedToEmail = assignedToEmail.String
	}
	if assignedAt.Valid {
		incident.AssignedAt = &assignedAt.Time
	}
	if acknowledgedBy.Valid {
		incident.AcknowledgedBy = acknowledgedBy.String
	}
	if acknowledgedByName.Valid {
		incident.AcknowledgedByName = acknowledgedByName.String
	}
	if acknowledgedByEmail.Valid {
		incident.AcknowledgedByEmail = acknowledgedByEmail.String
	}
	if acknowledgedAt.Valid {
		incident.AcknowledgedAt = &acknowledgedAt.Time
	}
	if resolvedBy.Valid {
		incident.ResolvedBy = resolvedBy.String
	}
	if resolvedByName.Valid {
		incident.ResolvedByName = resolvedByName.String
	}
	if resolvedByEmail.Valid {
		incident.ResolvedByEmail = resolvedByEmail.String
	}
	if resolvedAt.Valid {
		incident.ResolvedAt = &resolvedAt.Time
	}
	if integrationID.Valid {
		incident.IntegrationID = integrationID.String
	}
	if serviceID.Valid {
		incident.ServiceID = serviceID.String
	}
	if serviceName.Valid {
		incident.ServiceName = serviceName.String
	}
	if externalID.Valid {
		incident.ExternalID = externalID.String
	}
	if externalURL.Valid {
		incident.ExternalURL = externalURL.String
	}
	if escalationPolicyID.Valid {
		incident.EscalationPolicyID = escalationPolicyID.String
	}
	if escalationPolicyName.Valid {
		incident.EscalationPolicyName = escalationPolicyName.String
	}
	if lastEscalatedAt.Valid {
		incident.LastEscalatedAt = &lastEscalatedAt.Time
	}
	if groupID.Valid {
		incident.GroupID = groupID.String
	}
	if groupName.Valid {
		incident.GroupName = groupName.String
	}
	if apiKeyID.Valid {
		incident.APIKeyID = apiKeyID.String
	}
	if incidentKey.Valid {
		incident.IncidentKey = incidentKey.String
	}

	// Parse JSON fields
	if labels.Valid && labels.String != "" {
		json.Unmarshal([]byte(labels.String), &incident.Labels)
	}
	if customFields.Valid && customFields.String != "" {
		json.Unmarshal([]byte(customFields.String), &incident.CustomFields)
	}

	// Get recent events
	events, err := s.GetIncidentEvents(id, 10)
	if err == nil {
		incident.RecentEvents = events
	}

	return &incident, nil
}

// CreateIncident creates a new incident
func (s *IncidentService) CreateIncident(incident *db.Incident) (*db.Incident, error) {
	if incident.ID == "" {
		incident.ID = uuid.New().String()
	}
	// Remove manual timestamp setting - let database handle with DEFAULT NOW()

	// Set defaults
	if incident.Status == "" {
		incident.Status = db.IncidentStatusTriggered
	}
	if incident.Urgency == "" {
		incident.Urgency = db.IncidentUrgencyHigh
	}
	if incident.EscalationStatus == "" {
		incident.EscalationStatus = "none"
	}
	if incident.AlertCount == 0 {
		incident.AlertCount = 1
	}

	// Auto-assign to current on-call user if not assigned
	if incident.AssignedTo == "" {
		userService := NewUserService(s.PG, s.Redis)
		onCallUser, err := userService.GetCurrentOnCallUser()
		if err == nil {
			incident.AssignedTo = onCallUser.ID
			// Don't set AssignedAt here - let database handle it in the INSERT
		}
	}

	// Convert maps to JSON
	var labelsJSON, customFieldsJSON interface{}
	if incident.Labels != nil {
		labelsBytes, _ := json.Marshal(incident.Labels)
		labelsJSON = string(labelsBytes)
	}
	if incident.CustomFields != nil {
		customFieldsBytes, _ := json.Marshal(incident.CustomFields)
		customFieldsJSON = string(customFieldsBytes)
	}

	// Handle UUID fields properly - convert empty strings to NULL
	var assignedToParam, escalationPolicyIDParam, groupIDParam, integrationIDParam, serviceIDParam, apiKeyIDParam interface{}

	log.Printf("DEBUG: Incident UUID fields before processing - AssignedTo: '%s', EscalationPolicyID: '%s', GroupID: '%s', IntegrationID: '%s', ServiceID: '%s', APIKeyID: '%s'",
		incident.AssignedTo, incident.EscalationPolicyID, incident.GroupID, incident.IntegrationID, incident.ServiceID, incident.APIKeyID)

	if incident.AssignedTo != "" {
		assignedToParam = incident.AssignedTo
		log.Printf("DEBUG: Setting assignedToParam to: %s", incident.AssignedTo)
	}
	if incident.EscalationPolicyID != "" {
		escalationPolicyIDParam = incident.EscalationPolicyID
		log.Printf("DEBUG: Setting escalationPolicyIDParam to: %s", incident.EscalationPolicyID)
	}
	if incident.GroupID != "" {
		groupIDParam = incident.GroupID
		log.Printf("DEBUG: Setting groupIDParam to: %s", incident.GroupID)
	}
	if incident.IntegrationID != "" {
		integrationIDParam = incident.IntegrationID
		log.Printf("DEBUG: Setting integrationIDParam to: %s", incident.IntegrationID)
	}
	if incident.ServiceID != "" {
		serviceIDParam = incident.ServiceID
		log.Printf("DEBUG: Setting serviceIDParam to: %s", incident.ServiceID)
	}
	if incident.APIKeyID != "" {
		apiKeyIDParam = incident.APIKeyID
		log.Printf("DEBUG: Setting apiKeyIDParam to: %s", incident.APIKeyID)
	}

	if incident.CurrentEscalationLevel == 0 {
		incident.CurrentEscalationLevel = 1
	}

	log.Printf("DEBUG: Final params - assignedToParam: %v, escalationPolicyIDParam: %v, groupIDParam: %v, integrationIDParam: %v, serviceIDParam: %v, apiKeyIDParam: %v",
		assignedToParam, escalationPolicyIDParam, groupIDParam, integrationIDParam, serviceIDParam, apiKeyIDParam)

	_, err := s.PG.Exec(`
		INSERT INTO incidents (
			id, title, description, status, urgency, priority,
			assigned_to, source, integration_id, service_id, external_id, external_url,
			escalation_policy_id, current_escalation_level, escalation_status, group_id, api_key_id,
			severity, incident_key, alert_count, labels, custom_fields
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
		incident.ID, incident.Title, incident.Description, incident.Status, incident.Urgency, incident.Priority,
		assignedToParam, incident.Source, integrationIDParam, serviceIDParam, incident.ExternalID, incident.ExternalURL,
		escalationPolicyIDParam, incident.CurrentEscalationLevel, incident.EscalationStatus,
		groupIDParam, apiKeyIDParam, incident.Severity, incident.IncidentKey, incident.AlertCount,
		labelsJSON, customFieldsJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create incident: %w", err)
	}

	// Create triggered event
	s.createIncidentEvent(incident.ID, db.IncidentEventTriggered, map[string]interface{}{
		"source":   incident.Source,
		"severity": incident.Severity,
	}, "")

	// Create assignment event if incident was auto-assigned
	if incident.AssignedTo != "" && incident.AssignedAt != nil {
		eventData := map[string]interface{}{
			"assigned_to_id": incident.AssignedTo,
			"method":         "auto_assignment",
			"reason":         "escalation_policy",
		}

		// Get user name for display
		var userName string
		err = s.PG.QueryRow(`SELECT COALESCE(name, email, 'Unknown') FROM users WHERE id = $1`, incident.AssignedTo).Scan(&userName)
		if err == nil {
			eventData["assigned_to"] = userName
		} else {
			eventData["assigned_to"] = incident.AssignedTo // Fallback to ID if name lookup fails
		}

		s.createIncidentEvent(incident.ID, db.IncidentEventAssigned, eventData, "")
	}

	// Add to Redis queue for processing
	if s.Redis != nil {
		b, _ := json.Marshal(incident)
		s.Redis.RPush(context.Background(), "incidents:queue", b)
	}

	// Send incident assignment notification
	if s.NotificationWorker != nil && incident.AssignedTo != "" {
		go func() {
			err := s.NotificationWorker.SendIncidentAssignedNotification(incident.AssignedTo, incident.ID)
			if err != nil {
				log.Printf("⚠️  Failed to send incident assignment notification: %v", err)
			} else {
				log.Printf("✅ Sent incident assignment notification to user %s for incident %s", incident.AssignedTo, incident.ID)
			}
		}()
	}

	// Send FCM notification (convert to alert format for now)
	if s.FCMService != nil && incident.AssignedTo != "" {
		go func() {
			// Convert incident to alert format for FCM compatibility
			alert := &db.Alert{
				ID:          incident.ID,
				Title:       incident.Title,
				Description: incident.Description,
				Severity:    incident.Severity,
				Status:      "new", // Map incident status to alert status
				AssignedTo:  incident.AssignedTo,
				Source:      incident.Source,
			}
			if err := s.FCMService.SendAlertNotification(alert); err != nil {
				fmt.Printf("Failed to send FCM notification: %v\n", err)
			}
		}()
	}

	return incident, nil
}

// AcknowledgeIncident acknowledges an incident
func (s *IncidentService) AcknowledgeIncident(id, userID, note string) error {
	now := time.Now()
	_, err := s.PG.Exec(`
		UPDATE incidents
		SET status = $1, acknowledged_by = $2::uuid, acknowledged_at = $3, updated_at = $4
		WHERE id = $5 AND status = $6
	`, db.IncidentStatusAcknowledged, userID, now, now, id, db.IncidentStatusTriggered)

	if err != nil {
		return fmt.Errorf("failed to acknowledge incident: %w", err)
	}

	// Create acknowledged event
	eventData := map[string]interface{}{}
	if note != "" {
		eventData["note"] = note
	}
	s.createIncidentEvent(id, db.IncidentEventAcknowledged, eventData, userID)

	// Send notification about web acknowledgment to update Slack
	if s.NotificationWorker != nil {
		go func() {
			err := s.NotificationWorker.SendIncidentAcknowledgedNotification(userID, id)
			if err != nil {
				log.Printf("⚠️  Failed to send incident acknowledged notification: %v", err)
			} else {
				log.Printf("✅ Sent incident acknowledged notification for incident %s", id)
			}
		}()
	}

	return nil
}

// ResolveIncident resolves an incident
func (s *IncidentService) ResolveIncident(id, userID, note, resolution string) error {
	_, err := s.PG.Exec(`
		UPDATE incidents
		SET status = $1, resolved_by = $2::uuid, resolved_at = NOW() AT TIME ZONE 'UTC'
		WHERE id = $3 AND status != $1
	`, db.IncidentStatusResolved, userID, id)

	if err != nil {
		return fmt.Errorf("failed to resolve incident: %w", err)
	}

	// Create resolved event
	eventData := map[string]interface{}{}
	if note != "" {
		eventData["note"] = note
	}
	if resolution != "" {
		eventData["resolution"] = resolution
	}
	s.createIncidentEvent(id, db.IncidentEventResolved, eventData, userID)

	// Send notification about resolution to update Slack
	if s.NotificationWorker != nil {
		go func() {
			err := s.NotificationWorker.SendIncidentResolvedNotification(userID, id)
			if err != nil {
				log.Printf("⚠️  Failed to send incident resolved notification: %v", err)
			} else {
				log.Printf("✅ Sent incident resolved notification for incident %s", id)
			}
		}()
	}

	return nil
}

// AssignIncident assigns an incident to a user
func (s *IncidentService) AssignIncident(id, userID, assignedBy, note string) error {
	_, err := s.PG.Exec(`
		UPDATE incidents
		SET assigned_to = $1::uuid
		WHERE id = $2
	`, userID, id)

	if err != nil {
		return fmt.Errorf("failed to assign incident: %w", err)
	}

	// Create assigned event with user name resolution
	eventData := map[string]interface{}{
		"assigned_to_id": userID,
	}

	// Get user name for display
	var userName string
	err = s.PG.QueryRow(`SELECT COALESCE(name, email, 'Unknown') FROM users WHERE id = $1`, userID).Scan(&userName)
	if err == nil {
		eventData["assigned_to"] = userName
	} else {
		eventData["assigned_to"] = userID // Fallback to ID if name lookup fails
	}

	if note != "" {
		eventData["note"] = note
	}
	s.createIncidentEvent(id, db.IncidentEventAssigned, eventData, assignedBy)

	return nil
}

// GetIncidentEvents returns events for an incident
func (s *IncidentService) GetIncidentEvents(incidentID string, limit int) ([]db.IncidentEvent, error) {
	query := `
		SELECT ie.id, ie.incident_id, ie.event_type, ie.event_data, ie.created_at, ie.created_by,
			   u.name as created_by_name
		FROM incident_events ie
		LEFT JOIN users u ON ie.created_by = u.id
		WHERE ie.incident_id = $1
		ORDER BY ie.created_at DESC
		LIMIT $2
	`

	rows, err := s.PG.Query(query, incidentID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get incident events: %w", err)
	}
	defer rows.Close()

	var events []db.IncidentEvent
	for rows.Next() {
		var event db.IncidentEvent
		var eventDataJSON sql.NullString
		var createdBy, createdByName sql.NullString

		err := rows.Scan(
			&event.ID, &event.IncidentID, &event.EventType, &eventDataJSON,
			&event.CreatedAt, &createdBy, &createdByName,
		)
		if err != nil {
			continue
		}

		if createdBy.Valid {
			event.CreatedBy = createdBy.String
		}
		if createdByName.Valid {
			event.CreatedByName = createdByName.String
		}
		if eventDataJSON.Valid && eventDataJSON.String != "" {
			json.Unmarshal([]byte(eventDataJSON.String), &event.EventData)
		}

		events = append(events, event)
	}

	return events, nil
}

// createIncidentEvent creates an event for an incident
func (s *IncidentService) createIncidentEvent(incidentID, eventType string, eventData map[string]interface{}, createdBy string) error {
	eventDataJSON, _ := json.Marshal(eventData)

	var createdByParam interface{}
	if createdBy != "" {
		createdByParam = createdBy
	}

	_, err := s.PG.Exec(`
		INSERT INTO incident_events (incident_id, event_type, event_data, created_by)
		VALUES ($1, $2, $3, $4)
	`, incidentID, eventType, string(eventDataJSON), createdByParam)

	return err
}

// GetIncidentStats returns incident statistics
func (s *IncidentService) GetIncidentStats() (map[string]interface{}, error) {
	query := `
		SELECT 
			COUNT(*) as total,
			COUNT(CASE WHEN status = 'triggered' THEN 1 END) as triggered,
			COUNT(CASE WHEN status = 'acknowledged' THEN 1 END) as acknowledged,
			COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
			COUNT(CASE WHEN urgency = 'high' THEN 1 END) as high_urgency
		FROM incidents
		WHERE created_at >= NOW() - INTERVAL '30 days'
	`

	var total, triggered, acknowledged, resolved, highUrgency int
	err := s.PG.QueryRow(query).Scan(&total, &triggered, &acknowledged, &resolved, &highUrgency)
	if err != nil {
		return nil, fmt.Errorf("failed to get incident stats: %w", err)
	}

	return map[string]interface{}{
		"total":        total,
		"triggered":    triggered,
		"acknowledged": acknowledged,
		"resolved":     resolved,
		"high_urgency": highUrgency,
	}, nil
}

// GetAssigneeFromEscalationPolicy determines who should be assigned to an incident based on escalation policy
func (s *IncidentService) GetAssigneeFromEscalationPolicy(escalationPolicyID, groupID string) (string, error) {
	log.Printf("DEBUG: GetAssigneeFromEscalationPolicy called with escalationPolicyID='%s', groupID='%s'", escalationPolicyID, groupID)

	if escalationPolicyID == "" {
		log.Printf("DEBUG: escalationPolicyID is empty, returning no assignment")
		return "", nil // No escalation policy, no auto-assignment
	}

	// Get the first level of the escalation policy (level 1)
	query := `
		SELECT target_type, target_id
		FROM escalation_levels
		WHERE policy_id = $1 AND level_number = 1
		ORDER BY level_number ASC
		LIMIT 1
	`

	log.Printf("DEBUG: Querying escalation_levels table for policy_id='%s' and level_number=1", escalationPolicyID)

	var targetType, targetID string
	err := s.PG.QueryRow(query, escalationPolicyID).Scan(&targetType, &targetID)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("DEBUG: No escalation levels found for policy_id='%s'", escalationPolicyID)
			return "", nil // No escalation levels defined
		}
		log.Printf("DEBUG: Database error querying escalation levels: %v", err)
		return "", fmt.Errorf("failed to get escalation level: %w", err)
	}

	log.Printf("DEBUG: Found escalation level - target_type='%s', target_id='%s'", targetType, targetID)

	// Determine assignee based on target type
	switch targetType {
	case "user":
		// Direct user assignment
		log.Printf("DEBUG: Target type is 'user', returning target_id='%s'", targetID)
		return targetID, nil

	case "scheduler":
		// Find current on-call user for this scheduler
		log.Printf("DEBUG: Target type is 'scheduler', calling getCurrentOnCallUserFromScheduler with schedulerID='%s'", targetID)
		return s.getCurrentOnCallUserFromScheduler(targetID, groupID)

	case "current_schedule":
		// Find current on-call user for the group
		log.Printf("DEBUG: Target type is 'current_schedule', calling getCurrentOnCallUserFromGroup")
		return s.getCurrentOnCallUserFromGroup(groupID)

	case "group":
		// For group assignment, we could assign to group leader or current on-call
		// For now, let's assign to current on-call user in the group
		log.Printf("DEBUG: Target type is 'group', calling getCurrentOnCallUserFromGroup")
		return s.getCurrentOnCallUserFromGroup(groupID)

	default:
		// External or unknown target types don't have direct user assignment
		log.Printf("DEBUG: Unknown target type '%s', returning no assignment", targetType)
		return "", nil
	}
}

// getCurrentOnCallUserFromScheduler gets the current on-call user from a specific scheduler
// This uses the effective_shifts view which automatically handles schedule overrides
func (s *IncidentService) getCurrentOnCallUserFromScheduler(schedulerID, groupID string) (string, error) {
	log.Printf("DEBUG: getCurrentOnCallUserFromScheduler called with schedulerID='%s', groupID='%s'", schedulerID, groupID)

	query := `
		SELECT effective_user_id
		FROM effective_shifts
		WHERE scheduler_id = $1
		AND group_id = $2
		AND start_time <= NOW()
		AND end_time >= NOW()
		ORDER BY start_time ASC
		LIMIT 1
	`

	log.Printf("DEBUG: Querying effective_shifts view for current on-call user in scheduler")

	var userID string
	err := s.PG.QueryRow(query, schedulerID, groupID).Scan(&userID)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("DEBUG: No current on-call user found for scheduler '%s' in group '%s'", schedulerID, groupID)
			return "", nil // No one currently on-call for this scheduler
		}
		log.Printf("DEBUG: Database error querying effective_shifts: %v", err)
		return "", fmt.Errorf("failed to get current on-call user from scheduler: %w", err)
	}

	log.Printf("DEBUG: Found current on-call user (effective) '%s' for scheduler '%s'", userID, schedulerID)
	return userID, nil
}

// getCurrentOnCallUserFromGroup gets the current on-call user from the group
// This uses the effective_shifts view which automatically handles schedule overrides
func (s *IncidentService) getCurrentOnCallUserFromGroup(groupID string) (string, error) {
	log.Printf("DEBUG: getCurrentOnCallUserFromGroup called with groupID='%s'", groupID)

	query := `
		SELECT effective_user_id
		FROM effective_shifts
		WHERE group_id = $1
		AND start_time <= NOW()
		AND end_time >= NOW()
		ORDER BY start_time ASC
		LIMIT 1
	`

	log.Printf("DEBUG: Querying effective_shifts view for current on-call user in group")

	var userID string
	err := s.PG.QueryRow(query, groupID).Scan(&userID)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("DEBUG: No current on-call user found for group '%s'", groupID)
			return "", nil // No one currently on-call for this group
		}
		log.Printf("DEBUG: Database error querying effective_shifts: %v", err)
		return "", fmt.Errorf("failed to get current on-call user from group: %w", err)
	}

	log.Printf("DEBUG: Found current on-call user (effective) '%s' for group '%s'", userID, groupID)
	return userID, nil
}

// ManualEscalateIncident handles manual escalation triggered by user action
// Returns the new escalation level, assigned user ID, and any error
func (s *IncidentService) ManualEscalateIncident(incidentID, userID string) (*db.EscalationResult, error) {
	log.Printf("DEBUG: ManualEscalateIncident called for incident %s by user %s", incidentID, userID)

	// Get current incident state
	var incident struct {
		ID                     string
		Status                 string
		EscalationPolicyID     sql.NullString
		CurrentEscalationLevel int
		EscalationStatus       string
		GroupID                sql.NullString
	}

	query := `
		SELECT id, status, escalation_policy_id, current_escalation_level, 
		       escalation_status, group_id
		FROM incidents
		WHERE id = $1
	`
	err := s.PG.QueryRow(query, incidentID).Scan(
		&incident.ID, &incident.Status, &incident.EscalationPolicyID,
		&incident.CurrentEscalationLevel, &incident.EscalationStatus, &incident.GroupID,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("incident not found")
		}
		return nil, fmt.Errorf("failed to get incident: %w", err)
	}

	// Validate incident can be escalated
	if incident.Status == db.IncidentStatusResolved {
		return nil, fmt.Errorf("cannot escalate resolved incident")
	}

	if !incident.EscalationPolicyID.Valid || incident.EscalationPolicyID.String == "" {
		return nil, fmt.Errorf("incident has no escalation policy")
	}

	// Get escalation levels
	escalationLevels, err := s.getEscalationLevels(incident.EscalationPolicyID.String)
	if err != nil {
		return nil, fmt.Errorf("failed to get escalation levels: %w", err)
	}

	if len(escalationLevels) == 0 {
		return nil, fmt.Errorf("escalation policy has no levels defined")
	}

	// Determine next level
	nextLevel := incident.CurrentEscalationLevel + 1
	log.Printf("DEBUG: Current level %d, next level %d, total levels %d",
		incident.CurrentEscalationLevel, nextLevel, len(escalationLevels))

	// Check if there's a next level available
	var targetLevel *db.EscalationLevel
	for _, level := range escalationLevels {
		if level.LevelNumber == nextLevel {
			targetLevel = &level
			break
		}
	}

	if targetLevel == nil {
		return nil, fmt.Errorf("already at maximum escalation level (%d)", incident.CurrentEscalationLevel)
	}

	// Process escalation based on target type
	var assignedUserID string
	groupID := ""
	if incident.GroupID.Valid {
		groupID = incident.GroupID.String
	}

	switch targetLevel.TargetType {
	case "user":
		assignedUserID = targetLevel.TargetID
	case "scheduler":
		assignedUserID, err = s.getCurrentOnCallUserFromScheduler(targetLevel.TargetID, groupID)
		if err != nil {
			log.Printf("WARNING: Failed to get on-call user from scheduler: %v", err)
		}
	case "current_schedule", "group":
		targetGroupID := groupID
		if targetLevel.TargetType == "group" && targetLevel.TargetID != "" {
			targetGroupID = targetLevel.TargetID
		}
		assignedUserID, err = s.getCurrentOnCallUserFromGroup(targetGroupID)
		if err != nil {
			log.Printf("WARNING: Failed to get on-call user from group: %v", err)
		}
	case "external":
		// External escalation doesn't assign to a user
		log.Printf("DEBUG: External escalation to target %s", targetLevel.TargetID)
	default:
		log.Printf("WARNING: Unknown target type: %s", targetLevel.TargetType)
	}

	// Check if there are more levels after this one
	hasMoreLevels := false
	for _, level := range escalationLevels {
		if level.LevelNumber == nextLevel+1 {
			hasMoreLevels = true
			break
		}
	}

	// Determine new escalation status
	newStatus := "pending"
	if !hasMoreLevels {
		newStatus = "completed"
	}

	// Update incident in database - use UTC time consistent with worker
	updateQuery := `
		UPDATE incidents
		SET current_escalation_level = $1,
		    escalation_status = $2,
		    last_escalated_at = NOW() AT TIME ZONE 'UTC',
		    updated_at = NOW() AT TIME ZONE 'UTC'
	`
	args := []interface{}{nextLevel, newStatus}
	argIndex := 3

	// Also update assigned_to if we have a user
	if assignedUserID != "" {
		updateQuery += fmt.Sprintf(", assigned_to = $%d::uuid, assigned_at = NOW() AT TIME ZONE 'UTC'", argIndex)
		args = append(args, assignedUserID)
		argIndex++
	}

	updateQuery += fmt.Sprintf(" WHERE id = $%d", argIndex)
	args = append(args, incidentID)

	_, err = s.PG.Exec(updateQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to update incident: %w", err)
	}

	// Get assignee name for event
	var assignedToName string
	if assignedUserID != "" {
		s.PG.QueryRow(`SELECT COALESCE(name, email, 'Unknown') FROM users WHERE id = $1`, assignedUserID).Scan(&assignedToName)
	}

	// Create escalation event
	eventData := map[string]interface{}{
		"escalation_level": nextLevel,
		"target_type":      targetLevel.TargetType,
		"target_id":        targetLevel.TargetID,
		"reason":           "manual_escalation",
		"escalated_by":     userID,
	}
	if assignedUserID != "" {
		eventData["assigned_to_id"] = assignedUserID
		eventData["assigned_to"] = assignedToName
	}

	s.createIncidentEvent(incidentID, db.IncidentEventEscalated, eventData, userID)

	// Create escalation completion event if this was the last level
	if !hasMoreLevels {
		completionEventData := map[string]interface{}{
			"escalation_status": "completed",
			"final_level":       nextLevel,
			"reason":            "manual_escalation_completed",
		}
		if assignedUserID != "" {
			completionEventData["final_assignee"] = assignedToName
			completionEventData["final_assignee_id"] = assignedUserID
		}
		s.createIncidentEvent(incidentID, "escalation_completed", completionEventData, userID)
	}

	// Send notification to assigned user
	if s.NotificationWorker != nil && assignedUserID != "" {
		go func() {
			err := s.NotificationWorker.SendIncidentEscalatedNotification(assignedUserID, incidentID)
			if err != nil {
				log.Printf("⚠️  Failed to send escalation notification: %v", err)
			} else {
				log.Printf("✅ Sent escalation notification to user %s", assignedUserID)
			}
		}()
	}

	log.Printf("SUCCESS: Manually escalated incident %s to level %d (assigned to: %s, status: %s)",
		incidentID, nextLevel, assignedUserID, newStatus)

	return &db.EscalationResult{
		NewLevel:         nextLevel,
		AssignedUserID:   assignedUserID,
		AssignedToName:   assignedToName,
		EscalationStatus: newStatus,
		TargetType:       targetLevel.TargetType,
		HasMoreLevels:    hasMoreLevels,
	}, nil
}

// getEscalationLevels retrieves escalation levels for a policy
func (s *IncidentService) getEscalationLevels(policyID string) ([]db.EscalationLevel, error) {
	query := `
		SELECT id, policy_id, level_number, target_type, target_id, timeout_minutes
		FROM escalation_levels
		WHERE policy_id = $1
		ORDER BY level_number ASC
	`

	rows, err := s.PG.Query(query, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var levels []db.EscalationLevel
	for rows.Next() {
		var level db.EscalationLevel
		err := rows.Scan(
			&level.ID, &level.PolicyID, &level.LevelNumber,
			&level.TargetType, &level.TargetID, &level.TimeoutMinutes,
		)
		if err != nil {
			log.Printf("Error scanning escalation level: %v", err)
			continue
		}
		levels = append(levels, level)
	}

	return levels, nil
}

// FindIncidentByFingerprint finds an incident by fingerprint in labels
func (s *IncidentService) FindIncidentByFingerprint(fingerprint string) (*db.Incident, error) {
	log.Printf("DEBUG: Searching for incident with fingerprint: %s", fingerprint)

	query := `
		SELECT id, title, description, status, urgency, priority,
			   created_at, updated_at, assigned_to, assigned_at,
			   acknowledged_by, acknowledged_at, resolved_by, resolved_at,
			   source, integration_id, service_id, external_id, external_url,
			   escalation_policy_id, current_escalation_level, last_escalated_at,
			   escalation_status, group_id, api_key_id, severity, incident_key,
			   alert_count, labels, custom_fields
		FROM incidents
		WHERE labels->>'fingerprint' = $1
		AND status IN ('triggered', 'acknowledged')
		ORDER BY created_at DESC
		LIMIT 1
	`

	var incident db.Incident
	var assignedTo, acknowledgedBy, resolvedBy sql.NullString
	var assignedAt, acknowledgedAt, resolvedAt sql.NullTime
	var integrationID, serviceID, externalID, externalURL sql.NullString
	var escalationPolicyID sql.NullString
	var lastEscalatedAt sql.NullTime
	var groupID, apiKeyID, incidentKey sql.NullString
	var labels, customFields sql.NullString

	err := s.PG.QueryRow(query, fingerprint).Scan(
		&incident.ID, &incident.Title, &incident.Description, &incident.Status,
		&incident.Urgency, &incident.Priority, &incident.CreatedAt, &incident.UpdatedAt,
		&assignedTo, &assignedAt, &acknowledgedBy, &acknowledgedAt,
		&resolvedBy, &resolvedAt, &incident.Source, &integrationID, &serviceID,
		&externalID, &externalURL, &escalationPolicyID, &incident.CurrentEscalationLevel,
		&lastEscalatedAt, &incident.EscalationStatus, &groupID, &apiKeyID,
		&incident.Severity, &incidentKey, &incident.AlertCount, &labels, &customFields,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("DEBUG: No incident found with fingerprint: %s", fingerprint)
			return nil, nil
		}
		log.Printf("ERROR: Database error searching for fingerprint %s: %v", fingerprint, err)
		return nil, err
	}

	// Handle nullable fields
	if assignedTo.Valid {
		incident.AssignedTo = assignedTo.String
	}
	if assignedAt.Valid {
		incident.AssignedAt = &assignedAt.Time
	}
	if acknowledgedBy.Valid {
		incident.AcknowledgedBy = acknowledgedBy.String
	}
	if acknowledgedAt.Valid {
		incident.AcknowledgedAt = &acknowledgedAt.Time
	}
	if resolvedBy.Valid {
		incident.ResolvedBy = resolvedBy.String
	}
	if resolvedAt.Valid {
		incident.ResolvedAt = &resolvedAt.Time
	}
	if integrationID.Valid {
		incident.IntegrationID = integrationID.String
	}
	if serviceID.Valid {
		incident.ServiceID = serviceID.String
	}
	if externalID.Valid {
		incident.ExternalID = externalID.String
	}
	if externalURL.Valid {
		incident.ExternalURL = externalURL.String
	}
	if escalationPolicyID.Valid {
		incident.EscalationPolicyID = escalationPolicyID.String
	}
	if lastEscalatedAt.Valid {
		incident.LastEscalatedAt = &lastEscalatedAt.Time
	}
	if groupID.Valid {
		incident.GroupID = groupID.String
	}
	if apiKeyID.Valid {
		incident.APIKeyID = apiKeyID.String
	}
	if incidentKey.Valid {
		incident.IncidentKey = incidentKey.String
	}

	// Parse JSON fields
	if labels.Valid && labels.String != "" {
		if err := json.Unmarshal([]byte(labels.String), &incident.Labels); err != nil {
			log.Printf("WARNING: Failed to parse labels JSON: %v", err)
		}
	}
	if customFields.Valid && customFields.String != "" {
		if err := json.Unmarshal([]byte(customFields.String), &incident.CustomFields); err != nil {
			log.Printf("WARNING: Failed to parse custom_fields JSON: %v", err)
		}
	}

	log.Printf("DEBUG: Found incident %s with fingerprint %s", incident.ID, fingerprint)
	return &incident, nil
}
