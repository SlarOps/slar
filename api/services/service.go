package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
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
		ID:          uuid.New().String(),
		GroupID:     groupID,
		Name:        req.Name,
		Description: req.Description,
		RoutingKey:  req.RoutingKey,
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		CreatedBy:   createdBy,
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

	// Insert service
	_, err := s.PG.Exec(`
		INSERT INTO services (id, group_id, name, description, routing_key, escalation_policy_id, 
						  is_active, created_at, updated_at, created_by, integrations, notification_settings)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, service.ID, service.GroupID, service.Name, service.Description, service.RoutingKey,
		req.EscalationPolicyID, service.IsActive, service.CreatedAt, service.UpdatedAt,
		service.CreatedBy, integrationsJSON, notificationJSON)

	if err != nil {
		return service, fmt.Errorf("failed to create service: %w", err)
	}

	// Set escalation policy ID if provided
	if req.EscalationPolicyID != nil {
		service.EscalationPolicyID = *req.EscalationPolicyID
	}

	return service, nil
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

	return service, nil
}

// GetGroupServices returns all services in a group
func (s *ServiceService) GetGroupServices(groupID string) ([]db.Service, error) {
	query := `
		SELECT s.id, s.group_id, s.name, s.description, s.routing_key, s.escalation_policy_id,
		       s.is_active, s.created_at, s.updated_at, COALESCE(s.created_by, '') as created_by,
		       COALESCE(s.integrations, '{}') as integrations,
		       COALESCE(s.notification_settings, '{}') as notification_settings
		FROM services s
		WHERE s.group_id = $1
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

	return service, nil
}

// DeleteService soft deletes a service
func (s *ServiceService) DeleteService(serviceID string) error {
	result, err := s.PG.Exec(`
		UPDATE services SET is_active = false, updated_at = $1 WHERE id = $2
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

	return service, nil
}

// ListAllServices returns all services across all groups (admin function)
func (s *ServiceService) ListAllServices(isActive *bool) ([]db.Service, error) {
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

		services = append(services, service)
	}

	return services, nil
}
