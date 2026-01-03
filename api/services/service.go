package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/internal/config"
)

type ServiceService struct {
	PG *sql.DB
}

func NewServiceService(pg *sql.DB) *ServiceService {
	return &ServiceService{PG: pg}
}

// CreateService creates a new service within a group
func (s *ServiceService) CreateService(groupID string, req db.CreateServiceRequest, createdBy string) (db.Service, error) {
	service := db.Service{
		ID:             uuid.New().String(),
		GroupID:        groupID,
		Name:           req.Name,
		Description:    req.Description,
		RoutingKey:     req.RoutingKey,
		IsActive:       true,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		CreatedBy:      createdBy,
		OrganizationID: req.OrganizationID,
		ProjectID:      req.ProjectID,
	}

	// Set default integration and notification settings
	if req.Integrations != nil {
		service.Integrations = req.Integrations
	} else {
		service.Integrations = make(map[string]interface{})
	}

	if req.NotificationSettings != nil {
		service.NotificationSettings = req.NotificationSettings
	} else {
		service.NotificationSettings = map[string]interface{}{
			"email": true,
			"fcm":   true,
			"sms":   false,
		}
	}

	// Convert maps to JSON
	integrationsJSON, _ := json.Marshal(service.Integrations)
	notificationJSON, _ := json.Marshal(service.NotificationSettings)

	// Insert service with organization_id and project_id
	_, err := s.PG.Exec(`
		INSERT INTO services (id, group_id, name, description, routing_key, escalation_policy_id,
						  is_active, created_at, updated_at, created_by, integrations, notification_settings,
						  organization_id, project_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`, service.ID, service.GroupID, service.Name, service.Description, service.RoutingKey,
		req.EscalationPolicyID, service.IsActive, service.CreatedAt, service.UpdatedAt,
		service.CreatedBy, integrationsJSON, notificationJSON,
		nullIfEmptyStr(service.OrganizationID), nullIfEmptyStr(service.ProjectID))

	if err != nil {
		return service, fmt.Errorf("failed to create service: %w", err)
	}

	// Set escalation policy ID if provided
	if req.EscalationPolicyID != nil {
		service.EscalationPolicyID = *req.EscalationPolicyID
	}

	// Populate computed webhook URLs
	s.populateWebhookURLs(&service)

	return service, nil
}

// nullIfEmptyStr returns nil if string is empty, otherwise returns the string
func nullIfEmptyStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// GetService returns a specific service by ID
func (s *ServiceService) GetService(serviceID string) (db.Service, error) {
	var service db.Service
	var integrationsJSON, notificationJSON []byte
	var escalationPolicyID sql.NullString

	err := s.PG.QueryRow(`
		SELECT s.id, s.group_id, s.name, s.description, s.routing_key, s.escalation_policy_id,
		       s.is_active, s.created_at, s.updated_at, COALESCE(s.created_by, '') as created_by,
		       COALESCE(s.integrations, '{}') as integrations,
		       COALESCE(s.notification_settings, '{}') as notification_settings,
		       g.name as group_name
		FROM services s
		LEFT JOIN groups g ON s.group_id = g.id
		WHERE s.id = $1
	`, serviceID).Scan(
		&service.ID, &service.GroupID, &service.Name, &service.Description,
		&service.RoutingKey, &escalationPolicyID, &service.IsActive,
		&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy,
		&integrationsJSON, &notificationJSON, &service.GroupName,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return service, fmt.Errorf("service not found")
		}
		return service, fmt.Errorf("failed to get service: %w", err)
	}

	// Parse JSON fields
	if len(integrationsJSON) > 0 {
		json.Unmarshal(integrationsJSON, &service.Integrations)
	}
	if len(notificationJSON) > 0 {
		json.Unmarshal(notificationJSON, &service.NotificationSettings)
	}

	// Handle nullable escalation rule ID
	if escalationPolicyID.Valid {
		service.EscalationPolicyID = escalationPolicyID.String
	}

	// Populate computed webhook URLs
	s.populateWebhookURLs(&service)

	return service, nil
}

// GetGroupServices returns all active services in a group
func (s *ServiceService) GetGroupServices(groupID string) ([]db.Service, error) {
	query := `
		SELECT s.id, s.group_id, s.name, s.description, s.routing_key, s.escalation_policy_id,
		       s.is_active, s.created_at, s.updated_at, COALESCE(s.created_by, '') as created_by,
		       COALESCE(s.integrations, '{}') as integrations,
		       COALESCE(s.notification_settings, '{}') as notification_settings
		FROM services s
		WHERE s.group_id = $1 AND s.is_active = true
		ORDER BY s.name ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to get group services: %w", err)
	}
	defer rows.Close()

	var services []db.Service
	for rows.Next() {
		var service db.Service
		var integrationsJSON, notificationJSON []byte
		var escalationPolicyID sql.NullString

		err := rows.Scan(
			&service.ID, &service.GroupID, &service.Name, &service.Description,
			&service.RoutingKey, &escalationPolicyID, &service.IsActive,
			&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy,
			&integrationsJSON, &notificationJSON,
		)
		if err != nil {
			continue
		}

		// Parse JSON fields
		if len(integrationsJSON) > 0 {
			json.Unmarshal(integrationsJSON, &service.Integrations)
		}
		if len(notificationJSON) > 0 {
			json.Unmarshal(notificationJSON, &service.NotificationSettings)
		}

		// Handle nullable escalation rule ID
		if escalationPolicyID.Valid {
			service.EscalationPolicyID = escalationPolicyID.String
		}

		// Populate computed webhook URLs
		s.populateWebhookURLs(&service)

		services = append(services, service)
	}

	return services, nil
}

// UpdateService updates an existing service
func (s *ServiceService) UpdateService(serviceID string, req db.UpdateServiceRequest) (db.Service, error) {
	// Get current service
	service, err := s.GetService(serviceID)
	if err != nil {
		return service, err
	}

	// Update fields if provided
	if req.Name != nil {
		service.Name = *req.Name
	}
	if req.Description != nil {
		service.Description = *req.Description
	}
	if req.RoutingKey != nil {
		service.RoutingKey = *req.RoutingKey
	}
	if req.EscalationPolicyID != nil {
		service.EscalationPolicyID = *req.EscalationPolicyID
	}
	if req.IsActive != nil {
		service.IsActive = *req.IsActive
	}
	if req.Integrations != nil {
		service.Integrations = req.Integrations
	}
	if req.NotificationSettings != nil {
		service.NotificationSettings = req.NotificationSettings
	}

	service.UpdatedAt = time.Now()

	// Convert maps to JSON
	integrationsJSON, _ := json.Marshal(service.Integrations)
	notificationJSON, _ := json.Marshal(service.NotificationSettings)

	// Update the service
	_, err = s.PG.Exec(`
		UPDATE services 
		SET name = $2, description = $3, routing_key = $4, escalation_policy_id = $5,
		    is_active = $6, updated_at = $7, integrations = $8, notification_settings = $9
		WHERE id = $1
	`, serviceID, service.Name, service.Description, service.RoutingKey,
		service.EscalationPolicyID, service.IsActive, service.UpdatedAt,
		integrationsJSON, notificationJSON)

	if err != nil {
		return service, fmt.Errorf("failed to update service: %w", err)
	}

	// Populate computed webhook URLs
	s.populateWebhookURLs(&service)

	return service, nil
}

// DeleteService soft deletes a service
func (s *ServiceService) DeleteService(serviceID string) error {
	// Soft delete service and its integrations
	result, err := s.PG.Exec(`
		WITH deleted_service AS (
			UPDATE services SET is_active = false, updated_at = $1 WHERE id = $2 RETURNING id
		)
		UPDATE service_integrations SET is_active = false, updated_at = $1 
		WHERE service_id = $2 AND is_active = true
	`, time.Now(), serviceID)

	if err != nil {
		return fmt.Errorf("failed to delete service: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("service not found")
	}

	return nil
}

// GetServiceByRoutingKey returns a service by its routing key
func (s *ServiceService) GetServiceByRoutingKey(routingKey string) (db.Service, error) {
	var service db.Service
	var integrationsJSON, notificationJSON []byte
	var escalationPolicyID sql.NullString

	err := s.PG.QueryRow(`
		SELECT s.id, s.group_id, s.name, s.description, s.routing_key, s.escalation_policy_id,
		       s.is_active, s.created_at, s.updated_at, COALESCE(s.created_by, '') as created_by,
		       COALESCE(s.integrations, '{}') as integrations,
		       COALESCE(s.notification_settings, '{}') as notification_settings,
		       g.name as group_name
		FROM services s
		LEFT JOIN groups g ON s.group_id = g.id
		WHERE s.routing_key = $1 AND s.is_active = true
	`, routingKey).Scan(
		&service.ID, &service.GroupID, &service.Name, &service.Description,
		&service.RoutingKey, &escalationPolicyID, &service.IsActive,
		&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy,
		&integrationsJSON, &notificationJSON, &service.GroupName,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return service, fmt.Errorf("service not found")
		}
		return service, fmt.Errorf("failed to get service: %w", err)
	}

	// Parse JSON fields
	if len(integrationsJSON) > 0 {
		json.Unmarshal(integrationsJSON, &service.Integrations)
	}
	if len(notificationJSON) > 0 {
		json.Unmarshal(notificationJSON, &service.NotificationSettings)
	}

	// Handle nullable escalation rule ID
	if escalationPolicyID.Valid {
		service.EscalationPolicyID = escalationPolicyID.String
	}

	// Populate computed webhook URLs
	s.populateWebhookURLs(&service)

	return service, nil
}

// ListServices returns services with ReBAC filtering
// ReBAC: Explicit OR Inherited access pattern with MANDATORY Tenant Isolation
// IMPORTANT: All queries MUST be scoped to current organization (Context-Aware)
func (s *ServiceService) ListServices(filters map[string]interface{}) ([]db.Service, error) {
	// ReBAC: Get user context
	currentUserID, hasCurrentUser := filters["current_user_id"].(string)
	if !hasCurrentUser || currentUserID == "" {
		return []db.Service{}, nil
	}

	// ReBAC: Get organization context (MANDATORY for Tenant Isolation)
	currentOrgID, hasOrgContext := filters["current_org_id"].(string)
	if !hasOrgContext || currentOrgID == "" {
		// Log warning but return empty for safety
		fmt.Printf("WARNING: ListServices called without organization context - returning empty\n")
		return []db.Service{}, nil
	}

	// ReBAC: Explicit OR Inherited access with Tenant Isolation
	// $1 = currentUserID, $2 = currentOrgID
	query := `
		SELECT s.id, s.group_id, s.name, s.description, s.routing_key, s.escalation_policy_id,
		       s.is_active, s.created_at, s.updated_at, COALESCE(s.created_by, '') as created_by,
		       COALESCE(s.integrations, '{}') as integrations,
		       COALESCE(s.notification_settings, '{}') as notification_settings,
		       g.name as group_name
		FROM services s
		LEFT JOIN groups g ON s.group_id = g.id
		WHERE
			-- TENANT ISOLATION (MANDATORY): Only services in current organization
			s.organization_id = $2
			AND (
				-- Scope A: Direct group membership (user is member of the group that owns the service)
				EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.user_id = $1
					AND m.resource_type = 'group'
					AND m.resource_id = s.group_id
				)
				OR
				-- Scope B: Org-level services (services not tied to a specific group)
				(
					s.group_id IS NULL
					AND EXISTS (
						SELECT 1 FROM memberships m
						WHERE m.user_id = $1
						AND m.resource_type = 'org'
						AND m.resource_id = $2
					)
				)
				OR
				-- Scope C: Inherited access via project membership
				EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.user_id = $1
					AND m.resource_type = 'project'
					AND m.resource_id = s.project_id
				)
			)
	`
	args := []interface{}{currentUserID, currentOrgID}
	argIndex := 3

	// Apply resource-specific filters
	// Default to showing only active services unless explicitly set to false
	if isActive, ok := filters["is_active"].(bool); ok {
		query += fmt.Sprintf(" AND s.is_active = $%d", argIndex)
		args = append(args, isActive)
		argIndex++
	} else {
		// Default: only show active services
		query += " AND s.is_active = true"
	}

	if search, ok := filters["search"].(string); ok && search != "" {
		query += fmt.Sprintf(" AND (s.name ILIKE $%d OR s.description ILIKE $%d)", argIndex, argIndex+1)
		searchPattern := "%" + search + "%"
		args = append(args, searchPattern, searchPattern)
		argIndex += 2
	}

	if groupID, ok := filters["group_id"].(string); ok && groupID != "" {
		query += fmt.Sprintf(" AND s.group_id = $%d", argIndex)
		args = append(args, groupID)
		argIndex++
	}

	// ReBAC: Project-level filtering with Computed Scope
	if projectID, ok := filters["project_id"].(string); ok && projectID != "" {
		// Specific project filter - strict filtering
		query += fmt.Sprintf(" AND s.project_id = $%d", argIndex)
		args = append(args, projectID)
		argIndex++
	} else {
		// No project_id provided → Computed Scope (show everything user can see):
		// 1. Org-level services (project_id IS NULL)
		// 2. Services from projects user has access to (via memberships)
		query += fmt.Sprintf(`
			AND (
				s.project_id IS NULL
				OR s.project_id IN (
					SELECT m.resource_id FROM memberships m
					WHERE m.user_id = $%d
					AND m.resource_type = 'project'
				)
			)
		`, argIndex)
		args = append(args, currentUserID)
		argIndex++
	}

	query += " ORDER BY g.name, s.name"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list services: %w", err)
	}
	defer rows.Close()

	var services []db.Service
	for rows.Next() {
		var service db.Service
		var integrationsJSON, notificationJSON []byte
		var escalationPolicyID sql.NullString

		err := rows.Scan(
			&service.ID, &service.GroupID, &service.Name, &service.Description,
			&service.RoutingKey, &escalationPolicyID, &service.IsActive,
			&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy,
			&integrationsJSON, &notificationJSON, &service.GroupName,
		)
		if err != nil {
			continue
		}

		// Parse JSON fields
		if len(integrationsJSON) > 0 {
			json.Unmarshal(integrationsJSON, &service.Integrations)
		}
		if len(notificationJSON) > 0 {
			json.Unmarshal(notificationJSON, &service.NotificationSettings)
		}

		// Handle nullable escalation rule ID
		if escalationPolicyID.Valid {
			service.EscalationPolicyID = escalationPolicyID.String
		}

		// Populate computed webhook URLs
		s.populateWebhookURLs(&service)

		services = append(services, service)
	}

	return services, nil
}

// ListAllServices returns all services across all groups (admin function)
// DEPRECATED: Use ListServices with filters instead (requires ReBAC context)
func (s *ServiceService) ListAllServices(isActive *bool) ([]db.Service, error) {
	fmt.Printf("WARNING: ListAllServices is deprecated - use ListServices with ReBAC filters\n")
	query := `
		SELECT s.id, s.group_id, s.name, s.description, s.routing_key, s.escalation_policy_id,
		       s.is_active, s.created_at, s.updated_at, COALESCE(s.created_by, '') as created_by,
		       COALESCE(s.integrations, '{}') as integrations,
		       COALESCE(s.notification_settings, '{}') as notification_settings,
		       g.name as group_name
		FROM services s
		LEFT JOIN groups g ON s.group_id = g.id
		WHERE 1=1
	`
	args := []interface{}{}

	if isActive != nil {
		query += " AND s.is_active = $1"
		args = append(args, *isActive)
	}

	query += " ORDER BY g.name, s.name"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list services: %w", err)
	}
	defer rows.Close()

	var services []db.Service
	for rows.Next() {
		var service db.Service
		var integrationsJSON, notificationJSON []byte
		var escalationPolicyID sql.NullString

		err := rows.Scan(
			&service.ID, &service.GroupID, &service.Name, &service.Description,
			&service.RoutingKey, &escalationPolicyID, &service.IsActive,
			&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy,
			&integrationsJSON, &notificationJSON, &service.GroupName,
		)
		if err != nil {
			continue
		}

		// Parse JSON fields
		if len(integrationsJSON) > 0 {
			json.Unmarshal(integrationsJSON, &service.Integrations)
		}
		if len(notificationJSON) > 0 {
			json.Unmarshal(notificationJSON, &service.NotificationSettings)
		}

		// Handle nullable escalation rule ID
		if escalationPolicyID.Valid {
			service.EscalationPolicyID = escalationPolicyID.String
		}

		// Populate computed webhook URLs
		s.populateWebhookURLs(&service)

		services = append(services, service)
	}

	return services, nil
}

// populateWebhookURLs computes and sets the webhook URLs for a service
func (s *ServiceService) populateWebhookURLs(service *db.Service) {
	baseURL := config.App.WebhookAPIBaseURL
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}

	service.GenericWebhookURL = fmt.Sprintf("%s/webhook/generic/%s", baseURL, service.RoutingKey)
	service.PrometheusWebhookURL = fmt.Sprintf("%s/webhook/prometheus/%s", baseURL, service.RoutingKey)
}
