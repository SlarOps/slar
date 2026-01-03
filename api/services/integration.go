package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/internal/config"
)

type IntegrationService struct {
	PG *sql.DB
}

func NewIntegrationService(pg *sql.DB) *IntegrationService {
	return &IntegrationService{PG: pg}
}

// ===========================
// INTEGRATION CRUD OPERATIONS
// ===========================

// CreateIntegration creates a new integration
// ReBAC: Requires OrganizationID for MANDATORY tenant isolation
func (s *IntegrationService) CreateIntegration(req db.CreateIntegrationRequest, createdBy string) (db.Integration, error) {
	integration := db.Integration{
		ID:             uuid.New().String(),
		Name:           req.Name,
		Type:           req.Type,
		Description:    req.Description,
		Config:         req.Config,
		IsActive:       true,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		CreatedBy:      createdBy,
		OrganizationID: req.OrganizationID, // ReBAC: MANDATORY tenant isolation
		ProjectID:      req.ProjectID,      // ReBAC: OPTIONAL project scoping
	}

	// Set defaults
	if req.HeartbeatInterval > 0 {
		integration.HeartbeatInterval = req.HeartbeatInterval
	} else {
		integration.HeartbeatInterval = 300 // 5 minutes default
	}

	if req.WebhookSecret != "" {
		integration.WebhookSecret = req.WebhookSecret
	}

	if integration.Config == nil {
		integration.Config = make(map[string]interface{})
	}

	// Convert config to JSON
	configJSON, err := json.Marshal(integration.Config)
	if err != nil {
		return integration, fmt.Errorf("failed to marshal config: %w", err)
	}

	// Generate webhook URL based on environment
	baseURL := config.App.WebhookAPIBaseURL
	if baseURL == "" {
		baseURL = "http://localhost:8080" // Default fallback
	}
	integration.WebhookURL = fmt.Sprintf("%s/webhook/%s/%s", baseURL, integration.Type, integration.ID)

	// Insert integration with webhook_url and ReBAC context
	err = s.PG.QueryRow(`
		INSERT INTO integrations (id, name, type, description, config, webhook_secret, webhook_url,
		                         is_active, heartbeat_interval, created_at, updated_at, created_by,
		                         organization_id, project_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id
	`, integration.ID, integration.Name, integration.Type, integration.Description,
		configJSON, integration.WebhookSecret, integration.WebhookURL, integration.IsActive,
		integration.HeartbeatInterval, integration.CreatedAt, integration.UpdatedAt,
		integration.CreatedBy, integration.OrganizationID, integration.ProjectID).Scan(&integration.ID)

	if err != nil {
		return integration, fmt.Errorf("failed to create integration: %w", err)
	}

	return integration, nil
}

// GetIntegration returns a specific integration by ID
func (s *IntegrationService) GetIntegration(integrationID string) (db.Integration, error) {
	var integration db.Integration
	var configJSON []byte
	var lastHeartbeat sql.NullTime
	var webhookURL sql.NullString

	err := s.PG.QueryRow(`
		SELECT i.id, i.name, i.type, i.description, i.config, i.webhook_url,
		       COALESCE(i.webhook_secret, '') as webhook_secret,
		       i.is_active, i.last_heartbeat, i.heartbeat_interval,
		       i.created_at, i.updated_at, COALESCE(i.created_by, '') as created_by,
		       get_integration_health_status(i.id) as health_status,
		       COALESCE(si_count.services_count, 0) as services_count
		FROM integrations i
		LEFT JOIN (
			SELECT integration_id, COUNT(*) as services_count
			FROM service_integrations 
			WHERE is_active = true
			GROUP BY integration_id
		) si_count ON i.id = si_count.integration_id
		WHERE i.id = $1
	`, integrationID).Scan(
		&integration.ID, &integration.Name, &integration.Type, &integration.Description,
		&configJSON, &webhookURL, &integration.WebhookSecret,
		&integration.IsActive, &lastHeartbeat, &integration.HeartbeatInterval,
		&integration.CreatedAt, &integration.UpdatedAt, &integration.CreatedBy,
		&integration.HealthStatus, &integration.ServicesCount,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return integration, fmt.Errorf("integration not found")
		}
		return integration, fmt.Errorf("failed to get integration: %w", err)
	}

	// Handle nullable webhook_url
	if webhookURL.Valid {
		integration.WebhookURL = webhookURL.String
	}

	// Parse JSON config
	if len(configJSON) > 0 {
		if err := json.Unmarshal(configJSON, &integration.Config); err != nil {
			integration.Config = make(map[string]interface{})
		}
	} else {
		integration.Config = make(map[string]interface{})
	}

	// Handle nullable last heartbeat
	if lastHeartbeat.Valid {
		integration.LastHeartbeat = &lastHeartbeat.Time
	}

	return integration, nil
}

// GetIntegrations returns all integrations with optional filtering
func (s *IntegrationService) GetIntegrations(integType string, activeOnly bool) ([]db.Integration, error) {
	query := `
		SELECT i.id, i.name, i.type, i.description, i.config, i.webhook_url,
		       COALESCE(i.webhook_secret, '') as webhook_secret,
		       i.is_active, i.last_heartbeat, i.heartbeat_interval,
		       i.created_at, i.updated_at, COALESCE(i.created_by, '') as created_by,
		       get_integration_health_status(i.id) as health_status,
		       COALESCE(si_count.services_count, 0) as services_count
		FROM integrations i
		LEFT JOIN (
			SELECT integration_id, COUNT(*) as services_count
			FROM service_integrations 
			WHERE is_active = true
			GROUP BY integration_id
		) si_count ON i.id = si_count.integration_id
		WHERE 1=1`

	args := []interface{}{}
	argIndex := 1

	if integType != "" {
		query += fmt.Sprintf(" AND i.type = $%d", argIndex)
		args = append(args, integType)
		argIndex++
	}

	if activeOnly {
		query += fmt.Sprintf(" AND i.is_active = $%d", argIndex)
		args = append(args, true)
		argIndex++
	}

	query += " ORDER BY i.created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		log.Println("failed to query integrations: %w", err)
		return nil, fmt.Errorf("failed to query integrations: %w", err)
	}
	defer rows.Close()

	var integrations []db.Integration
	for rows.Next() {
		var integration db.Integration
		var configJSON []byte
		var lastHeartbeat sql.NullTime
		var webhookURL sql.NullString

		err := rows.Scan(
			&integration.ID, &integration.Name, &integration.Type, &integration.Description,
			&configJSON, &webhookURL, &integration.WebhookSecret,
			&integration.IsActive, &lastHeartbeat, &integration.HeartbeatInterval,
			&integration.CreatedAt, &integration.UpdatedAt, &integration.CreatedBy,
			&integration.HealthStatus, &integration.ServicesCount,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan integration: %w", err)
		}

		// Handle nullable webhook_url
		if webhookURL.Valid {
			integration.WebhookURL = webhookURL.String
		}

		// Parse JSON config
		if len(configJSON) > 0 {
			if err := json.Unmarshal(configJSON, &integration.Config); err != nil {
				integration.Config = make(map[string]interface{})
			}
		} else {
			integration.Config = make(map[string]interface{})
		}

		// Handle nullable last heartbeat
		if lastHeartbeat.Valid {
			integration.LastHeartbeat = &lastHeartbeat.Time
		}

		integrations = append(integrations, integration)
	}

	return integrations, nil
}

// GetIntegrationsWithFilters retrieves integrations with ReBAC filtering
// ReBAC: MANDATORY Tenant Isolation with organization context
func (s *IntegrationService) GetIntegrationsWithFilters(filters map[string]interface{}) ([]db.Integration, error) {
	// ReBAC: Get user context
	currentUserID, hasCurrentUser := filters["current_user_id"].(string)
	if !hasCurrentUser || currentUserID == "" {
		return []db.Integration{}, nil
	}

	// ReBAC: Get organization context (MANDATORY for Tenant Isolation)
	currentOrgID, hasOrgContext := filters["current_org_id"].(string)
	if !hasOrgContext || currentOrgID == "" {
		log.Printf("WARNING: GetIntegrationsWithFilters called without organization context - returning empty")
		return []db.Integration{}, nil
	}

	// Base query with TENANT ISOLATION (MANDATORY)
	query := `
		SELECT i.id, i.name, i.type, i.description, i.config, i.webhook_url,
		       COALESCE(i.webhook_secret, '') as webhook_secret,
		       i.is_active, i.last_heartbeat, i.heartbeat_interval,
		       i.created_at, i.updated_at, COALESCE(i.created_by, '') as created_by,
		       COALESCE(i.organization_id::text, '') as organization_id,
		       COALESCE(i.project_id::text, '') as project_id,
		       get_integration_health_status(i.id) as health_status,
		       COALESCE(si_count.services_count, 0) as services_count
		FROM integrations i
		LEFT JOIN (
			SELECT integration_id, COUNT(*) as services_count
			FROM service_integrations
			WHERE is_active = true
			GROUP BY integration_id
		) si_count ON i.id = si_count.integration_id
		WHERE i.organization_id = $1`

	args := []interface{}{currentOrgID}
	argIndex := 2

	// PROJECT FILTER - Computed Scope (ReBAC)
	if projectID, ok := filters["project_id"].(string); ok && projectID != "" {
		// Specific project - strict filter
		query += fmt.Sprintf(" AND i.project_id = $%d", argIndex)
		args = append(args, projectID)
		argIndex++
	} else {
		// No project_id → Computed Scope
		// Return org-level integrations (project_id IS NULL) + integrations from accessible projects
		query += fmt.Sprintf(`
			AND (
				i.project_id IS NULL
				OR i.project_id IN (
					SELECT m.resource_id FROM memberships m
					WHERE m.user_id = $%d AND m.resource_type = 'project'
				)
			)
		`, argIndex)
		args = append(args, currentUserID)
		argIndex++
	}

	// Resource-specific filters
	if integType, ok := filters["type"].(string); ok && integType != "" {
		query += fmt.Sprintf(" AND i.type = $%d", argIndex)
		args = append(args, integType)
		argIndex++
	}

	if activeOnly, ok := filters["active_only"].(bool); ok && activeOnly {
		query += fmt.Sprintf(" AND i.is_active = $%d", argIndex)
		args = append(args, true)
		argIndex++
	}

	query += " ORDER BY i.created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		log.Printf("failed to query integrations with filters: %v", err)
		return nil, fmt.Errorf("failed to query integrations: %w", err)
	}
	defer rows.Close()

	var integrations []db.Integration
	for rows.Next() {
		var integration db.Integration
		var configJSON []byte
		var lastHeartbeat sql.NullTime
		var webhookURL sql.NullString

		err := rows.Scan(
			&integration.ID, &integration.Name, &integration.Type, &integration.Description,
			&configJSON, &webhookURL, &integration.WebhookSecret,
			&integration.IsActive, &lastHeartbeat, &integration.HeartbeatInterval,
			&integration.CreatedAt, &integration.UpdatedAt, &integration.CreatedBy,
			&integration.OrganizationID, &integration.ProjectID,
			&integration.HealthStatus, &integration.ServicesCount,
		)
		if err != nil {
			log.Printf("failed to scan integration: %v", err)
			continue
		}

		// Handle nullable webhook_url
		if webhookURL.Valid {
			integration.WebhookURL = webhookURL.String
		}

		// Parse JSON config
		if len(configJSON) > 0 {
			if err := json.Unmarshal(configJSON, &integration.Config); err != nil {
				integration.Config = make(map[string]interface{})
			}
		} else {
			integration.Config = make(map[string]interface{})
		}

		// Handle nullable last heartbeat
		if lastHeartbeat.Valid {
			integration.LastHeartbeat = &lastHeartbeat.Time
		}

		integrations = append(integrations, integration)
	}

	return integrations, nil
}

// UpdateIntegration updates an existing integration
func (s *IntegrationService) UpdateIntegration(integrationID string, req db.UpdateIntegrationRequest) (db.Integration, error) {
	// Get current integration
	integration, err := s.GetIntegration(integrationID)
	if err != nil {
		return integration, err
	}

	// Update fields if provided
	if req.Name != nil {
		integration.Name = *req.Name
	}
	if req.Description != nil {
		integration.Description = *req.Description
	}
	if req.Config != nil {
		integration.Config = req.Config
	}
	if req.WebhookSecret != nil {
		integration.WebhookSecret = *req.WebhookSecret
	}
	if req.IsActive != nil {
		integration.IsActive = *req.IsActive
	}
	if req.HeartbeatInterval != nil {
		integration.HeartbeatInterval = *req.HeartbeatInterval
	}

	integration.UpdatedAt = time.Now()

	// Convert config to JSON
	configJSON, err := json.Marshal(integration.Config)
	if err != nil {
		return integration, fmt.Errorf("failed to marshal config: %w", err)
	}

	// Recalculate webhook URL to ensure it matches current configuration
	baseURL := config.App.WebhookAPIBaseURL
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	integration.WebhookURL = fmt.Sprintf("%s/webhook/%s/%s", baseURL, integration.Type, integration.ID)

	// Update the integration
	_, err = s.PG.Exec(`
		UPDATE integrations 
		SET name = $2, description = $3, config = $4, webhook_secret = $5,
		    is_active = $6, heartbeat_interval = $7, updated_at = $8,
		    webhook_url = $9
		WHERE id = $1
	`, integrationID, integration.Name, integration.Description, configJSON,
		integration.WebhookSecret, integration.IsActive, integration.HeartbeatInterval,
		integration.UpdatedAt, integration.WebhookURL)

	if err != nil {
		return integration, fmt.Errorf("failed to update integration: %w", err)
	}

	return integration, nil
}

// DeleteIntegration soft deletes an integration
func (s *IntegrationService) DeleteIntegration(integrationID string) error {
	// Check if integration has active service mappings (only count if service is also active)
	rows, err := s.PG.Query(`
		SELECT s.name 
		FROM service_integrations si
		JOIN services s ON si.service_id = s.id
		WHERE si.integration_id = $1 AND si.is_active = true AND s.is_active = true
	`, integrationID)
	if err != nil {
		return fmt.Errorf("failed to check service mappings: %w", err)
	}
	defer rows.Close()

	var activeServices []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue // Skip errors
		}
		activeServices = append(activeServices, name)
	}

	if len(activeServices) > 0 {
		// Return a special error format that the handler can parse
		// We use a structured JSON string as the error message for simplicity without custom error types yet
		// Format: {"error": "cannot delete...", "details": ["Service A", ...]}
		detailsJSON, _ := json.Marshal(activeServices)
		return fmt.Errorf(`{"error": "cannot delete integration: active service mappings exist", "details": %s}`, string(detailsJSON))
	}

	// Delete the integration (CASCADE will handle service_integrations)
	result, err := s.PG.Exec("DELETE FROM integrations WHERE id = $1", integrationID)
	if err != nil {
		return fmt.Errorf("failed to delete integration: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("integration not found")
	}

	return nil
}

// UpdateHeartbeat updates the last heartbeat timestamp for an integration
func (s *IntegrationService) UpdateHeartbeat(integrationID string) error {
	result, err := s.PG.Exec("SELECT update_integration_heartbeat($1)", integrationID)
	if err != nil {
		return fmt.Errorf("failed to update heartbeat: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("integration not found or inactive")
	}

	return nil
}

// ===========================
// SERVICE INTEGRATION OPERATIONS
// ===========================

// CreateServiceIntegration creates a new service-integration mapping
func (s *IntegrationService) CreateServiceIntegration(req db.CreateServiceIntegrationRequest, createdBy string) (db.ServiceIntegration, error) {
	serviceIntegration := db.ServiceIntegration{
		ID:            uuid.New().String(),
		ServiceID:     req.ServiceID,
		IntegrationID: req.IntegrationID,
		IsActive:      true,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		CreatedBy:     createdBy,
	}

	// Set routing conditions
	if req.RoutingConditions != nil {
		serviceIntegration.RoutingConditions = req.RoutingConditions
	} else {
		serviceIntegration.RoutingConditions = make(map[string]interface{})
	}

	// Set priority
	if req.Priority > 0 {
		serviceIntegration.Priority = req.Priority
	} else {
		serviceIntegration.Priority = 100 // Default priority
	}

	// Convert routing conditions to JSON
	conditionsJSON, err := json.Marshal(serviceIntegration.RoutingConditions)
	if err != nil {
		return serviceIntegration, fmt.Errorf("failed to marshal routing conditions: %w", err)
	}

	// Insert service integration
	_, err = s.PG.Exec(`
		INSERT INTO service_integrations (id, service_id, integration_id, routing_conditions, 
		                                 priority, is_active, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, serviceIntegration.ID, serviceIntegration.ServiceID, serviceIntegration.IntegrationID,
		conditionsJSON, serviceIntegration.Priority, serviceIntegration.IsActive,
		serviceIntegration.CreatedAt, serviceIntegration.UpdatedAt, serviceIntegration.CreatedBy)

	if err != nil {
		log.Println("failed to create service integration: %w", err)
		return serviceIntegration, fmt.Errorf("failed to create service integration: %w", err)
	}

	return serviceIntegration, nil
}

// GetServiceIntegrations returns all service-integration mappings for a service
func (s *IntegrationService) GetServiceIntegrations(serviceID string) ([]db.ServiceIntegration, error) {
	rows, err := s.PG.Query(`
		SELECT si.id, si.service_id, si.integration_id, si.routing_conditions,
		       si.priority, si.is_active, si.created_at, si.updated_at,
		       COALESCE(si.created_by, '') as created_by,
		       s.name as service_name, i.name as integration_name, i.type as integration_type
		FROM service_integrations si
		JOIN services s ON si.service_id = s.id
		JOIN integrations i ON si.integration_id = i.id
		WHERE si.service_id = $1
		ORDER BY si.priority ASC, si.created_at DESC
	`, serviceID)

	if err != nil {
		return nil, fmt.Errorf("failed to query service integrations: %w", err)
	}
	defer rows.Close()

	var serviceIntegrations []db.ServiceIntegration
	for rows.Next() {
		var si db.ServiceIntegration
		var conditionsJSON []byte

		err := rows.Scan(
			&si.ID, &si.ServiceID, &si.IntegrationID, &conditionsJSON,
			&si.Priority, &si.IsActive, &si.CreatedAt, &si.UpdatedAt, &si.CreatedBy,
			&si.ServiceName, &si.IntegrationName, &si.IntegrationType,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan service integration: %w", err)
		}

		// Parse JSON routing conditions
		if len(conditionsJSON) > 0 {
			if err := json.Unmarshal(conditionsJSON, &si.RoutingConditions); err != nil {
				si.RoutingConditions = make(map[string]interface{})
			}
		} else {
			si.RoutingConditions = make(map[string]interface{})
		}

		serviceIntegrations = append(serviceIntegrations, si)
	}

	return serviceIntegrations, nil
}

// GetIntegrationServices returns all services linked to an integration
func (s *IntegrationService) GetIntegrationServices(integrationID string) ([]db.ServiceIntegration, error) {
	rows, err := s.PG.Query(`
		SELECT si.id, si.service_id, si.integration_id, si.routing_conditions,
		       si.priority, si.is_active, si.created_at, si.updated_at,
		       COALESCE(si.created_by, '') as created_by,
		       s.name as service_name, i.name as integration_name, i.type as integration_type
		FROM service_integrations si
		JOIN services s ON si.service_id = s.id
		JOIN integrations i ON si.integration_id = i.id
		WHERE si.integration_id = $1 AND si.is_active = true
		ORDER BY si.priority ASC, si.created_at DESC
	`, integrationID)

	if err != nil {
		return nil, fmt.Errorf("failed to query integration services: %w", err)
	}
	defer rows.Close()

	var serviceIntegrations []db.ServiceIntegration
	for rows.Next() {
		var si db.ServiceIntegration
		var conditionsJSON []byte

		err := rows.Scan(
			&si.ID, &si.ServiceID, &si.IntegrationID, &conditionsJSON,
			&si.Priority, &si.IsActive, &si.CreatedAt, &si.UpdatedAt, &si.CreatedBy,
			&si.ServiceName, &si.IntegrationName, &si.IntegrationType,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan service integration: %w", err)
		}

		// Parse JSON routing conditions
		if len(conditionsJSON) > 0 {
			if err := json.Unmarshal(conditionsJSON, &si.RoutingConditions); err != nil {
				si.RoutingConditions = make(map[string]interface{})
			}
		} else {
			si.RoutingConditions = make(map[string]interface{})
		}

		serviceIntegrations = append(serviceIntegrations, si)
	}

	return serviceIntegrations, nil
}

// UpdateServiceIntegration updates a service-integration mapping
func (s *IntegrationService) UpdateServiceIntegration(serviceIntegrationID string, req db.UpdateServiceIntegrationRequest) (db.ServiceIntegration, error) {
	// Get current service integration
	var si db.ServiceIntegration
	var conditionsJSON []byte

	err := s.PG.QueryRow(`
		SELECT si.id, si.service_id, si.integration_id, si.routing_conditions,
		       si.priority, si.is_active, si.created_at, si.updated_at,
		       COALESCE(si.created_by, '') as created_by
		FROM service_integrations si
		WHERE si.id = $1
	`, serviceIntegrationID).Scan(
		&si.ID, &si.ServiceID, &si.IntegrationID, &conditionsJSON,
		&si.Priority, &si.IsActive, &si.CreatedAt, &si.UpdatedAt, &si.CreatedBy,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return si, fmt.Errorf("service integration not found")
		}
		return si, fmt.Errorf("failed to get service integration: %w", err)
	}

	// Parse current routing conditions
	if len(conditionsJSON) > 0 {
		json.Unmarshal(conditionsJSON, &si.RoutingConditions)
	} else {
		si.RoutingConditions = make(map[string]interface{})
	}

	// Update fields if provided
	if req.RoutingConditions != nil {
		si.RoutingConditions = req.RoutingConditions
	}
	if req.Priority != nil {
		si.Priority = *req.Priority
	}
	if req.IsActive != nil {
		si.IsActive = *req.IsActive
	}

	si.UpdatedAt = time.Now()

	// Convert routing conditions to JSON
	updatedConditionsJSON, err := json.Marshal(si.RoutingConditions)
	if err != nil {
		return si, fmt.Errorf("failed to marshal routing conditions: %w", err)
	}

	// Update the service integration
	_, err = s.PG.Exec(`
		UPDATE service_integrations 
		SET routing_conditions = $2, priority = $3, is_active = $4, updated_at = $5
		WHERE id = $1
	`, serviceIntegrationID, updatedConditionsJSON, si.Priority, si.IsActive, si.UpdatedAt)

	if err != nil {
		return si, fmt.Errorf("failed to update service integration: %w", err)
	}

	return si, nil
}

// DeleteServiceIntegration deletes a service-integration mapping
func (s *IntegrationService) DeleteServiceIntegration(serviceIntegrationID string) error {
	result, err := s.PG.Exec("DELETE FROM service_integrations WHERE id = $1", serviceIntegrationID)
	if err != nil {
		return fmt.Errorf("failed to delete service integration: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("service integration not found")
	}

	return nil
}
